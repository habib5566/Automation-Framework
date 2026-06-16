"""The intentionally-vulnerable demo web application.

This is the single target every weblab attack module runs against -- the web
analogue of passlab's ``hashing.py`` contract. It is built on ``http.server``
+ ``sqlite3`` (stdlib only) and exposes exactly one injectable surface per
technique. Each handler is deliberately insecure; the docstring on each route
names the flaw.

NEVER expose this server on a non-loopback interface. It exists to be attacked.
"""
from __future__ import annotations

import ipaddress
import json
import urllib.request
from http import cookies
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from . import advanced_routes, constants, ssti_engine, weak_random, xml_util
from .pg_sim import PgSim
from .sim_shell import simulate_shell
from .weak_random import WeakTokenIssuer


class _Config:
    """Object exposed to the SSTI template engine (its ``secret`` is the prize)."""

    def __init__(self) -> None:
        self.app = "demo-store"
        self.version = "1.0"
        self.secret = constants.SSTI_CONFIG_SECRET


class VulnState:
    """Mutable server state shared across worker threads."""

    def __init__(self, db, sandbox) -> None:
        self.db = db
        self.sandbox = sandbox
        self.sessions = dict(constants.PRESET_SESSIONS)
        self.config = _Config()
        # --- WEB-300 advanced state ---
        self.collected: list = []          # OOB exfil collector (XXE/persistent-XSS)
        self.uploads: dict = {}            # filename -> content (file upload)
        self.profile: dict = {"name": "alice"}   # prototype-pollution target
        self.proto: dict = {}              # the shared "prototype"
        self.feedback: list = []           # persistent-XSS store
        self.tokens = WeakTokenIssuer()    # predictable reset tokens
        self.session_counter = 1           # predictable session ids
        self.pg = PgSim(sandbox)           # simulated PostgreSQL
        # Pre-register the admin's predictable session for the hijacking demo.
        self.sessions[weak_random.session_for(1)] = "admin"


def _is_loopback(host: str) -> bool:
    if not host:
        return False
    if host.lower() in ("localhost", "localhost.localdomain", "ip6-localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def make_handler(state: VulnState):
    """Build a request-handler class bound to ``state``."""

    class Handler(BaseHTTPRequestHandler):
        server_version = "DemoStore/1.0"

        # -- helpers ---------------------------------------------------------
        def log_message(self, *args) -> None:  # silence default logging
            return

        def _send(self, status, body, content_type="text/html", extra=None):
            if isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _send_json(self, status, obj, extra=None):
            self._send(status, json.dumps(obj), "application/json", extra)

        def _query(self):
            return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

        def _body_bytes(self):
            length = int(self.headers.get("Content-Length", 0) or 0)
            return self.rfile.read(length) if length else b""

        def _form(self):
            return {
                k: v[0]
                for k, v in parse_qs(self._body_bytes().decode("utf-8", "replace")).items()
            }

        def _session_user(self):
            raw = self.headers.get("Cookie")
            if not raw:
                return None
            jar = cookies.SimpleCookie()
            try:
                jar.load(raw)
            except cookies.CookieError:
                return None
            morsel = jar.get(constants.SESSION_COOKIE)
            if not morsel:
                return None
            return state.sessions.get(morsel.value)

        # -- routing ---------------------------------------------------------
        def do_GET(self):  # noqa: N802
            path = urlparse(self.path).path
            if path == "/ws" and advanced_routes.handle_websocket(self):
                return
            routes = {
                "/": self.index,
                "/search": self.search,
                "/greet": self.greet,
                "/comments": self.comments_get,
                "/api/userinfo": self.userinfo,
                "/download": self.download,
                "/render": self.render,
                "/fetch": self.fetch,
                "/ping": self.ping,
                "/internal/metadata": self.internal_metadata,
            }
            if path in routes:
                return routes[path]()
            if path.startswith("/api/orders/"):
                return self.order_by_id(path.rsplit("/", 1)[-1])
            if advanced_routes.dispatch_get(self, path):
                return
            return self._send(404, "<h1>404 Not Found</h1>")

        def do_POST(self):  # noqa: N802
            path = urlparse(self.path).path
            routes = {
                "/login": self.login,
                "/comments": self.comments_post,
                "/account/email": self.change_email,
                "/xml": self.xml,
            }
            if path in routes:
                return routes[path]()
            if advanced_routes.dispatch_post(self, path):
                return
            return self._send(404, "<h1>404 Not Found</h1>")

        def do_OPTIONS(self):  # noqa: N802 - CORS preflight, reflects Origin
            origin = self.headers.get("Origin", "*")
            self._send(
                204,
                "",
                extra={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
            )

        # -- routes ----------------------------------------------------------
        def index(self):
            self._send(
                200,
                "<h1>Demo Store</h1><ul>"
                "<li>/search?q= (SQLi)</li><li>/login (SQLi auth bypass)</li>"
                "<li>/greet?name= (reflected XSS)</li><li>/comments (stored XSS)</li>"
                "<li>/account/email (CSRF)</li><li>/api/userinfo (CORS)</li>"
                "<li>/download?file= (traversal)</li><li>/xml (XXE)</li>"
                "<li>/render?name= (SSTI)</li><li>/fetch?url= (SSRF)</li>"
                "<li>/ping?host= (command injection)</li>"
                "<li>/api/orders/&lt;id&gt; (IDOR)</li></ul>",
            )

        def search(self):
            """VULN SQLi: query string concatenated straight into SQL."""
            q = self._query().get("q", "")
            sql = (
                "SELECT id, username, email FROM users "
                f"WHERE username LIKE '%{q}%'"
            )
            try:
                rows = state.db.execute(sql).fetchall()
            except Exception as exc:  # noqa: BLE001 - error-based SQLi leaks this
                return self._send(200, f"<p>SQL error: {exc}</p>")
            items = "".join(
                f"<div class='user'>{r[0]} | {r[1]} | {r[2]}</div>" for r in rows
            )
            return self._send(200, f"<h2>Results</h2>{items or '<p>no results</p>'}")

        def login(self):
            """VULN SQLi: auth check via unparameterised string concatenation."""
            form = self._form()
            u, p = form.get("username", ""), form.get("password", "")
            sql = (
                "SELECT id, username, role FROM users "
                f"WHERE username='{u}' AND password='{p}'"
            )
            try:
                row = state.db.execute(sql).fetchone()
            except Exception as exc:  # noqa: BLE001
                return self._send(200, f"<p>SQL error: {exc}</p>")
            if not row:
                return self._send(401, "<p>Invalid credentials</p>")
            sid = f"{row[1]}-sid"
            state.sessions[sid] = row[1]
            cookie = f"{constants.SESSION_COOKIE}={sid}; Path=/"
            return self._send(
                200,
                f"<p>Welcome {row[1]} (role={row[2]})</p>",
                extra={"Set-Cookie": cookie},
            )

        def greet(self):
            """VULN reflected XSS: name echoed without escaping."""
            name = self._query().get("name", "Guest")
            return self._send(200, f"<h1>Hello, {name}!</h1>")

        def comments_get(self):
            """VULN stored XSS: comment bodies rendered without escaping."""
            rows = state.db.execute("SELECT author, body FROM comments").fetchall()
            items = "".join(
                f"<div class='comment'><b>{r[0]}</b>: {r[1]}</div>" for r in rows
            )
            return self._send(200, f"<h2>Comments</h2>{items}")

        def comments_post(self):
            form = self._form()
            author = form.get("author", "anon")
            body = form.get("body", "")
            state.db.execute(
                "INSERT INTO comments (author, body) VALUES (?, ?)", (author, body)
            )
            state.db.commit()
            return self._send(200, "<p>comment stored</p>")

        def change_email(self):
            """VULN CSRF: state change with no anti-CSRF token, simple content type."""
            user = self._session_user()
            if not user:
                return self._send(401, "<p>login required</p>")
            email = self._form().get("email", "")
            state.db.execute(
                "UPDATE users SET email=? WHERE username=?", (email, user)
            )
            state.db.commit()
            return self._send_json(
                200,
                {"status": "updated", "user": user, "email": email,
                 "flag": constants.FLAGS["csrf"]},
            )

        def userinfo(self):
            """VULN CORS: reflects Origin into ACAO with credentials allowed."""
            user = self._session_user()
            origin = self.headers.get("Origin", "*")
            headers = {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
            }
            if not user:
                return self._send_json(401, {"error": "login required"}, headers)
            row = state.db.execute(
                "SELECT username, email, role, secret FROM users WHERE username=?",
                (user,),
            ).fetchone()
            return self._send_json(
                200,
                {"username": row[0], "email": row[1], "role": row[2],
                 "secret": row[3], "flag": constants.FLAGS["cors"]},
                headers,
            )

        def download(self):
            """VULN directory traversal: file path joined without sanitisation."""
            rel = self._query().get("file", "")
            try:
                path = state.sandbox.resolve_public(rel)
            except PermissionError:
                return self._send(403, "<p>403 forbidden</p>")
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    return self._send(200, fh.read(), "text/plain")
            except (OSError, IsADirectoryError):
                return self._send(404, "<p>404 file not found</p>")

        def xml(self):
            """VULN XXE: SAX parser with external general entities enabled."""
            try:
                content = xml_util.parse_xxe(self._body_bytes(), state.sandbox)
            except Exception as exc:  # noqa: BLE001
                return self._send(400, f"<p>XML error: {exc}</p>")
            return self._send(200, f"<p>Parsed note: {content}</p>")

        def render(self):
            """VULN SSTI: user input rendered as a template, not data."""
            name = self._query().get("name", "Guest")
            template = f"Hello {name}!"
            out = ssti_engine.render(
                template, {"config": state.config, "app": state.config.app}
            )
            return self._send(200, f"<p>{out}</p>")

        def fetch(self):
            """VULN SSRF: server fetches a user-supplied URL (jailed to loopback)."""
            url = self._query().get("url", "")
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return self._send(400, "<p>unsupported scheme</p>")
            if not _is_loopback(parsed.hostname or ""):
                return self._send(
                    403, "<p>SSRF blocked: only internal hosts (lab safety)</p>"
                )
            try:
                req = urllib.request.Request(
                    url, headers={constants.INTERNAL_FETCH_HEADER: "1"}
                )
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = resp.read().decode("utf-8", "replace")
            except Exception as exc:  # noqa: BLE001
                return self._send(502, f"<p>fetch error: {exc}</p>")
            return self._send(200, data, "text/plain")

        def internal_metadata(self):
            """Internal service: only answers requests coming via the SSRF sink."""
            if self.headers.get(constants.INTERNAL_FETCH_HEADER) != "1":
                return self._send_json(
                    403, {"error": "internal endpoint - direct access denied"}
                )
            return self._send_json(200, constants.INTERNAL_METADATA)

        def ping(self):
            """VULN command injection: host concatenated into a shell command."""
            host = self._query().get("host", "127.0.0.1")
            output = simulate_shell(f"ping -c1 {host}", state.sandbox)
            return self._send(200, f"<pre>{output}</pre>")

        def order_by_id(self, raw_id):
            """VULN IDOR: any logged-in user can read any order by id."""
            if not self._session_user():
                return self._send_json(401, {"error": "login required"})
            try:
                oid = int(raw_id)
            except ValueError:
                return self._send_json(400, {"error": "bad id"})
            row = state.db.execute(
                "SELECT id, user_id, item, total, private_note FROM orders WHERE id=?",
                (oid,),
            ).fetchone()
            if not row:
                return self._send_json(404, {"error": "no such order"})
            return self._send_json(
                200,
                {"id": row[0], "user_id": row[1], "item": row[2],
                 "total": row[3], "private_note": row[4]},
            )

    Handler.state = state  # expose to advanced_routes via self.state
    return Handler
