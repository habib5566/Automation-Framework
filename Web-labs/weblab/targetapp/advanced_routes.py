"""The WEB-300 vulnerable endpoints, dispatched from the main handler.

Each route is a deliberately-insecure surface for one advanced technique. They
operate on the live request handler (``h``) via its helpers (``_send``,
``_query``, ``_session_user``, ``state`` ...), keeping ``app.py`` focused on the
WEB-200 routes. Every dangerous effect (file read/write, "command execution",
SSRF) is jailed to the sandbox / simulated shell / loopback.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
from urllib.parse import urlparse

from . import constants, deserialize_sim, php_compat, ssti_engine, weak_random, ws_server, xml_util
from .sim_shell import simulate_shell


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _json_body(h) -> dict:
    try:
        data = json.loads(h._body_bytes().decode("utf-8", "replace") or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


class _AdvConfig:
    def __init__(self) -> None:
        self.app = "api-gateway"
        self.version = "2.0"
        self.secret = constants.FLAGS["advanced_ssti"]


_ADV_CONFIG = _AdvConfig()
_DOLLAR_RE = re.compile(r"\$\{(.*?)\}", re.S)


def _render_dollar(template: str, context: dict) -> str:
    def _sub(match):
        try:
            return str(ssti_engine.safe_eval(match.group(1), context))
        except ssti_engine.RCEBlocked as exc:
            return f"[lab-sandbox blocked RCE escalation: {exc}]"
        except Exception as exc:  # noqa: BLE001
            return f"[template error: {type(exc).__name__}]"
    return _DOLLAR_RE.sub(_sub, template)


def _resolves_loopback(host: str) -> bool:
    """Resolve the many loopback encodings an SSRF filter-bypass uses."""
    host = host.strip().strip("[]")
    if not host:
        return False
    if host.lower() in ("localhost", "localhost.localdomain"):
        return True
    if host in ("::1", "::", "0:0:0:0:0:0:0:1"):
        return True
    if re.fullmatch(r"\d+", host):  # decimal integer form, e.g. 2130706433
        try:
            return ipaddress.ip_address(int(host)).is_loopback
        except ValueError:
            return False
    if host.lower().startswith("0x"):  # hex form
        try:
            return ipaddress.ip_address(int(host, 16)).is_loopback
        except ValueError:
            return False
    try:  # dotted forms incl. octal / shorthand (127.1, 0177.0.0.1)
        return ipaddress.ip_address(socket.inet_aton(host)).is_loopback
    except OSError:
        pass
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


_EXEC_EXTS = {"php", "phtml", "php3", "php4", "php5", "php7", "phar", "pht"}


def _is_executable_upload(name: str) -> bool:
    base = name.split("\x00")[0].split("/")[-1].lower()
    return any(part in _EXEC_EXTS for part in base.split(".")[1:])


def _merge(target: dict, src: dict, proto: dict) -> None:
    """The unsafe recursive merge behind prototype pollution."""
    if not isinstance(src, dict):
        return
    for key, value in src.items():
        if key in ("__proto__", "constructor", "prototype"):
            if isinstance(value, dict):
                _merge(proto, value, proto)  # writes the SHARED prototype
            continue
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _merge(target[key], value, proto)
        else:
            target[key] = value


# --------------------------------------------------------------------------- #
# GET routes
# --------------------------------------------------------------------------- #
def _profile(h):
    prof, proto = h.state.profile, h.state.proto
    is_admin = prof.get("isAdmin", proto.get("isAdmin", False))
    out = {"name": prof.get("name", "alice"), "role": "admin" if is_admin else "user"}
    if is_admin:
        out["flag"] = constants.FLAGS["prototype_pollution"]
    h._send_json(200, out)


def _proxy(h):
    url = h._query().get("url", "")
    low = url.lower()
    if "127.0.0.1" in low or "localhost" in low:  # naive string blocklist
        return h._send_json(403, {"error": "blocked: internal host denied"})
    host = urlparse(url).hostname or ""
    if _resolves_loopback(host):  # the bypass reaches the internal service
        return h._send_json(200, {
            "internal": "admin-metadata", "url": url,
            "flag": constants.FLAGS["advanced_ssrf"]})
    return h._send_json(403, {"error": "blocked: external host (lab jail)"})


def _check_user(h):
    username = h._query().get("username", "")
    sql = f"SELECT 1 FROM users WHERE username='{username}' LIMIT 1"
    try:
        row = h.state.db.execute(sql).fetchone()
    except Exception:  # noqa: BLE001 - blind: errors collapse to "no"
        row = None
    h._send_json(200, {"exists": bool(row)})  # boolean-only feedback


def _uploads(h, name):
    content = h.state.uploads.get(name)
    if content is None:
        return h._send(404, "<p>404 not found</p>")
    if _is_executable_upload(name):  # the server "runs" the uploaded webshell
        cmd = h._query().get("cmd", "id")
        return h._send(200, f"<pre>{simulate_shell(cmd, h.state.sandbox)}</pre>")
    h._send(200, content, "text/plain")


def _dom(h):
    html = (
        "<!doctype html><html><body><div id='out'></div>\n<script>\n"
        f"// flag: {constants.FLAGS['dom_xss']}\n"
        "// vulnerable sink: untrusted location.hash written via innerHTML\n"
        "var data = decodeURIComponent(location.hash.substring(1));\n"
        "document.getElementById('out').innerHTML = data;\n"
        "</script></body></html>"
    )
    h._send(200, html)


def _tpl(h):
    name = h._query().get("name", "Guest")
    out = _render_dollar(f"Hello {name}!", {"config": _ADV_CONFIG, "app": _ADV_CONFIG.app})
    h._send(200, f"<p>{out}</p>")


def _filter(h):
    q = h._query().get("q", "")
    blocked = {".", " "}
    if any(c in blocked for c in q):
        return h._send(403, "<p>blocked character detected</p>")
    context = {"config": _ADV_CONFIG, "data": {"secret": constants.FLAGS["char_restriction_bypass"]}}
    h._send(200, f"<p>{_render_dollar(q, context)}</p>")


def _admin(h):
    if h._session_user() != "admin":
        return h._send_json(403, {"error": "admin only"})
    h._send_json(200, {"area": "admin", "flag": constants.ADMIN_AREA_FLAG})


def _collected(h):
    h._send_json(200, {"collected": h.state.collected})


def _api_redirect(h):
    url = h._query().get("url", "")
    # BUG: regex has no end-anchor ($), so trusted.demo.evil.com slips through.
    if not re.match(r"^https?://([a-z0-9-]+\.)?trusted\.demo", url):
        return h._send_json(400, {"error": "untrusted redirect target"})
    h._send_json(200, {"redirect": url, "flag": constants.FLAGS["regex_bypass"]})


def _pg_search(h):
    q = h._query().get("q", "")
    sql = f"SELECT name FROM products WHERE name ILIKE '%{q}%'"
    try:
        result = h.state.pg.execute(sql)
    except Exception as exc:  # noqa: BLE001
        return h._send_json(200, {"error": str(exc)})
    h._send_json(200, result)


# --------------------------------------------------------------------------- #
# POST routes
# --------------------------------------------------------------------------- #
def _profile_merge(h):
    _merge(h.state.profile, _json_body(h), h.state.proto)
    h._send_json(200, {"status": "merged"})


def _api_import(h):
    blob = h._body_bytes().decode("utf-8", "replace")
    try:
        result = deserialize_sim.deserialize(blob, h.state.sandbox)
    except deserialize_sim.DeserializationError as exc:
        return h._send_json(400, {"error": str(exc)})
    h._send_json(200, result)


_EXPECTED_API_TOKEN = "s3cret-signing-token"


def _php_login(h):
    token = _json_body(h).get("token")
    if php_compat.php_loose_equals(token, _EXPECTED_API_TOKEN):
        return h._send_json(200, {"status": "authenticated",
                                  "flag": constants.FLAGS["php_type_juggling"]})
    h._send_json(403, {"status": "denied"})


def _php_hash_login(h):
    password = str(_json_body(h).get("password", ""))
    stored = php_compat.md5_hex(constants.MAGIC_HASH_PLAINTEXT)
    if php_compat.php_loose_equals(php_compat.md5_hex(password), stored):
        return h._send_json(200, {"status": "authenticated",
                                  "flag": constants.FLAGS["magic_hashes"]})
    h._send_json(403, {"status": "denied"})


def _password_reset(h):
    username = _json_body(h).get("username", "guest")
    counter, _token = h.state.tokens.issue(username)
    h._send_json(200, {"status": "sent", "reference": counter})  # token NOT returned


def _password_reset_confirm(h):
    data = _json_body(h)
    if h.state.tokens.valid_for(data.get("username", ""), data.get("token", "")):
        return h._send_json(200, {"status": "reset", "flag": constants.FLAGS["weak_tokens"]})
    h._send_json(403, {"error": "invalid token"})


def _login_weak(h):
    username = _json_body(h).get("username", "guest")
    h.state.session_counter += 1
    sid = weak_random.session_for(h.state.session_counter)
    h.state.sessions[sid] = username
    h._send_json(200, {"username": username, "session_reference": h.state.session_counter},
                 extra={"Set-Cookie": f"{constants.SESSION_COOKIE}={sid}; Path=/"})


def _upload(h):
    data = _json_body(h)
    filename = data.get("filename", "")
    if filename.lower().endswith(".php"):  # naive extension filter
        return h._send_json(400, {"error": "php files are not allowed"})
    if data.get("content_type", "").lower() in ("application/x-php", "application/php", "text/x-php"):
        return h._send_json(400, {"error": "php content-type blocked"})
    h.state.uploads[filename] = data.get("content", "")
    h._send_json(200, {"stored": filename, "url": f"/uploads/{filename}"})


def _xxe_oob(h):
    try:
        content = xml_util.parse_xxe(h._body_bytes(), h.state.sandbox)
    except Exception as exc:  # noqa: BLE001
        return h._send(400, f"<p>XML error: {exc}</p>")
    if content:  # blind: deliver out-of-band instead of echoing
        h.state.collected.append({"channel": "xxe-oob", "data": content})
    h._send(200, "<p>document accepted for processing</p>")


def _feedback(h):
    message = _json_body(h).get("message") or h._form().get("message", "")
    h.state.feedback.append(message)
    # simulate the admin bot opening new feedback in its browser.
    if "<script" in message.lower() and "cookie" in message.lower():
        h.state.collected.append({
            "channel": "persistent-xss",
            "data": f"admin_session=admin-sid; {constants.FLAGS['persistent_xss']}"})
    h._send_json(200, {"status": "received"})


def _collect(h):
    data = h._query().get("data")
    if data is None and h.command == "POST":
        data = h._body_bytes().decode("utf-8", "replace")
    h.state.collected.append({"channel": "collect", "data": data})
    h._send(200, "ok")


# --------------------------------------------------------------------------- #
# WebSocket (OS command injection, black box)
# --------------------------------------------------------------------------- #
def handle_websocket(h) -> bool:
    if h.headers.get("Upgrade", "").lower() != "websocket":
        return False
    key = h.headers.get("Sec-WebSocket-Key", "")
    h.send_response(101)
    h.send_header("Upgrade", "websocket")
    h.send_header("Connection", "Upgrade")
    h.send_header("Sec-WebSocket-Accept", ws_server.accept_key(key))
    h.end_headers()
    while True:
        frame = ws_server.read_frame(h.rfile)
        if frame is None:
            break
        _opcode, payload = frame
        try:
            msg = json.loads(payload.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            msg = {"host": payload.decode("utf-8", "replace")}
        host = msg.get("host", "127.0.0.1")
        output = simulate_shell(f"ping -c1 {host}", h.state.sandbox)  # VULN: concatenated
        h.wfile.write(ws_server.encode_text_frame(json.dumps({"output": output})))
        h.wfile.flush()
    return True


# --------------------------------------------------------------------------- #
# dispatch
# --------------------------------------------------------------------------- #
_GET = {
    "/api/profile": _profile, "/proxy": _proxy, "/api/check-user": _check_user,
    "/dom": _dom, "/tpl": _tpl, "/filter": _filter, "/admin": _admin,
    "/collected": _collected, "/collect": _collect, "/api/redirect": _api_redirect,
    "/pg/search": _pg_search,
}
_POST = {
    "/api/profile/merge": _profile_merge, "/api/import": _api_import,
    "/php/login": _php_login, "/php/hash-login": _php_hash_login,
    "/api/password-reset": _password_reset,
    "/api/password-reset/confirm": _password_reset_confirm,
    "/api/login-weak": _login_weak, "/upload": _upload, "/xxe-oob": _xxe_oob,
    "/feedback": _feedback, "/collect": _collect,
}


def dispatch_get(h, path) -> bool:
    if path in _GET:
        _GET[path](h)
        return True
    if path.startswith("/uploads/"):
        _uploads(h, path[len("/uploads/"):])
        return True
    return False


def dispatch_post(h, path) -> bool:
    if path in _POST:
        _POST[path](h)
        return True
    return False
