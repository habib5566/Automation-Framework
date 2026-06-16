# Deliberately vulnerable sample (Python) -- AUTHORIZED security-education lab.
# Each numbered comment marks a PLANTED, well-known weakness for the SAST module
# (weblab/source_analysis.py) to detect. Do NOT run this; it is a scan target.
import os
import pickle
import subprocess
import hashlib

import yaml

API_PASSWORD = "S3cr3t-Hardcoded-Pa55w0rd!"   # [VULN] hardcoded secret/credential


def login(conn, username):
    cursor = conn.cursor()
    # [VULN] SQL built by f-string concatenation -> SQL injection
    cursor.execute(f"SELECT * FROM users WHERE name = '{username}'")
    return cursor.fetchone()


def search(conn, term):
    cursor = conn.cursor()
    # [VULN] SQL built by % / + concatenation -> SQL injection
    cursor.execute("SELECT * FROM docs WHERE body LIKE '%" + term + "%'")
    return cursor.fetchall()


def ping(host):
    # [VULN] os.system / shell=True on user input -> command injection
    os.system("ping -c 1 " + host)
    subprocess.call("nslookup " + host, shell=True)


def load_session(blob):
    # [VULN] pickle.loads on untrusted data -> insecure deserialization / RCE
    return pickle.loads(blob)


def parse_config(text):
    # [VULN] yaml.load without SafeLoader -> arbitrary object construction
    return yaml.load(text)


def calculate(expr):
    # [VULN] eval / exec on input -> code injection
    result = eval(expr)
    exec("audit = %r" % result)
    return result


def store_password(pw):
    # [VULN] md5 used for password hashing -> weak/broken hash
    return hashlib.md5(pw.encode()).hexdigest()
