"""Planted secrets ("flags") and seed data for the vulnerable demo app.

Centralising these here means the vulnerable app, the attack modules, and the
tests all agree on exactly what a successful exploit should recover. Each flag
is the proof that one vulnerability class was exploited end-to-end.
"""
from __future__ import annotations

#: The proof-of-exploitation string each technique should recover.
FLAGS = {
    "sqli": "FLAG{sqli_union_dumped_admin_secret}",
    "db_enum": "FLAG{sqli_union_dumped_admin_secret}",  # same surface, via enumeration
    "idor": "FLAG{idor_read_bobs_private_order}",
    "traversal": "FLAG{directory_traversal_etc_passwd}",
    "xxe": "FLAG{xxe_external_entity_file_read}",
    "ssti": "FLAG{ssti_rendered_config_secret}",
    "ssrf": "FLAG{ssrf_reached_internal_metadata}",
    "command_injection": "FLAG{command_injection_shell_breakout}",
    "cors": "FLAG{cors_cross_origin_credentialed_read}",
    "csrf": "FLAG{csrf_forged_state_change}",
    "xss": "FLAG{xss_unescaped_reflection}",
    # --- WEB-300 advanced ---
    "prototype_pollution": "FLAG{js_prototype_pollution_privesc}",
    "advanced_ssrf": "FLAG{advanced_ssrf_filter_bypass}",
    "blind_sqli": "FLAG{blind_sqli_boolean_time_extraction}",
    "data_exfiltration": "FLAG{oob_data_exfiltration_chain}",
    "file_upload": "FLAG{file_upload_filter_bypass_webshell}",
    "php_type_juggling": "FLAG{php_loose_comparison_auth_bypass}",
    "magic_hashes": "FLAG{php_magic_hash_auth_bypass}",
    "dotnet_deserialization": "FLAG{insecure_deserialization_rce}",
    "postgresql_rce": "FLAG{postgres_udf_copy_to_program_rce}",
    "udf_reverse_shell": "FLAG{postgres_udf_reverse_shell}",
    "postgresql_large_objects": "FLAG{postgres_large_object_file_write}",
    "dom_xss": "FLAG{dom_based_xss_sink}",
    "advanced_ssti": "FLAG{advanced_ssti_rce}",
    "weak_tokens": "FLAG{weak_random_token_predicted}",
    "session_hijacking": "FLAG{session_hijack_admin_takeover}",
    "websocket_cmdi": "FLAG{websocket_os_command_injection}",
    "regex_bypass": "FLAG{regex_anchor_bypass}",
    "char_restriction_bypass": "FLAG{character_restriction_bypass}",
    "advanced_xxe": "FLAG{xxe_oob_parameter_entity_exfil}",
    "persistent_xss": "FLAG{persistent_xss_admin_session_theft}",
}

#: Single-row secrets table used by blind SQLi / data exfiltration (recovered
#: character-by-character with no direct output).
APP_SECRETS = {
    "blind_flag": FLAGS["blind_sqli"],
    "exfil_data": FLAGS["data_exfiltration"],
}

#: PHP magic-hash demo: the server stores md5(MAGIC_HASH_PLAINTEXT) -- which is a
#: "0e..."-style hash -- and compares with PHP loose '=='. ANY plaintext whose
#: md5 is also "0e<digits>" loose-equals it, so authentication is bypassable.
MAGIC_HASH_PLAINTEXT = "240610708"           # md5 -> 0e462097431906509019562988736854
MAGIC_HASH_ATTACK_PLAINTEXTS = ["QNKCDZO", "240610708", "aabg7XSs", "0e1137126905"]

#: The reset/session-token PRNG is seeded from a small, guessable space so the
#: weak-token / session-hijacking modules can predict it.
WEAK_TOKEN_MODULUS = 100000

#: Admin-only landing reached via session hijacking / prototype pollution.
ADMIN_AREA_FLAG = FLAGS["session_hijacking"]

#: Seed users. ``admin.secret`` is the SQLi/DB-enum prize.
USERS = [
    # id, username, password, email,            role,    secret
    (1, "admin", "S3cr3tAdminPw!", "admin@demo.lab", "admin", FLAGS["sqli"]),
    (2, "alice", "alicepass",      "alice@demo.lab", "user",  "alice-personal-note"),
    (3, "bob",   "bobpass",        "bob@demo.lab",   "user",  "bob-personal-note"),
]

#: Seed orders. Order 2 belongs to bob and carries the IDOR prize; alice's
#: session can read it only because the endpoint forgets to check ownership.
ORDERS = [
    # id, user_id, item,            total,  private_note
    (1, 2, "Mechanical Keyboard", 129.00, "ship to alice's home address"),
    (2, 3, "External SSD 2TB",    199.00, FLAGS["idor"]),
    (3, 2, "USB-C Hub",            39.00, "gift - no receipt"),
]

#: The "internal" metadata document reachable only via SSRF (think cloud
#: metadata at 169.254.169.254 -- here it's a loopback-only service).
INTERNAL_METADATA = {
    "service": "demo-metadata",
    "iam_token": FLAGS["ssrf"],
    "note": "this endpoint should never be reachable from the outside",
}

#: Object exposed to the SSTI template engine; its ``secret`` attribute is the
#: SSTI prize, reachable via ``{{ config.secret }}``.
SSTI_CONFIG_SECRET = FLAGS["ssti"]

#: Default session: the demo "logged-in" user the CSRF/CORS/IDOR demos act as.
DEFAULT_SESSION_USER = "alice"

#: Cookie name carrying the session id.
SESSION_COOKIE = "session"

#: Pre-registered sessions so the CSRF/CORS/IDOR demos have an authenticated
#: "victim" without scripting a login first (a real /login also mints one).
#: A module simulating the victim's browser sends ``Cookie: session=alice-sid``.
PRESET_SESSIONS = {"alice-sid": "alice", "admin-sid": "admin"}
VICTIM_SESSION = "alice-sid"

#: Header the SSRF /fetch sink adds to its server-side request; the internal
#: metadata endpoint only answers requests carrying it, so the secret is
#: reachable ONLY via SSRF, never by a direct external GET.
INTERNAL_FETCH_HEADER = "X-Internal-Fetch"
