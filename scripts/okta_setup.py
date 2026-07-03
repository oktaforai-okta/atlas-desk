"""Idempotent Okta foundation setup for Atlas Service Desk.

Phase 1 scope: ensure agents have an active JWK credential, an owner, and are ACTIVE.

Run (set these for your own tenant first, see docs/OKTA_SETUP.md):
    OKTA_SSWS_TOKEN=... OKTA_DOMAIN=... OWNER_USER_ID=... \\
    INTAKE_AGENT_ID=... DEVOPS_AGENT_ID=... \\
    ./.venv/bin/python scripts/okta_setup.py

Writes private JWKs to .secrets/<agent>.private.jwk.json (gitignored).
Reads/writes are logged with HTTP status. Safe to re-run.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric import rsa

OKTA_DOMAIN = os.environ.get("OKTA_DOMAIN", "your-org.oktapreview.com")
TOKEN = os.environ["OKTA_SSWS_TOKEN"].strip()
OWNER_USER_ID = os.environ.get("OWNER_USER_ID", "<owner-user-id>")
BASE = f"https://{OKTA_DOMAIN}/workload-principals/api/v1/ai-agents"

AGENTS = {
    "Resolution/Fulfillment Agent": os.environ.get("DEVOPS_AGENT_ID", "<devops-agent-id>"),
    "Intake/Triage Agent": os.environ.get("INTAKE_AGENT_ID", "<intake-agent-id>"),
}

SECRETS = Path(__file__).resolve().parents[1] / ".secrets"
SECRETS.mkdir(exist_ok=True)

H = {"Authorization": f"SSWS {TOKEN}", "Accept": "application/json", "Content-Type": "application/json"}
client = httpx.Client(timeout=30, headers=H)


def log(step: str, r: httpx.Response):
    body = r.text[:300].replace("\n", " ")
    print(f"  [{r.status_code}] {step}: {body}")


def b64url_uint(n: int) -> str:
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def gen_jwk():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = key.public_key().public_numbers()
    kid = str(uuid.uuid4())
    public = {"kty": "RSA", "e": b64url_uint(pub.e), "n": b64url_uint(pub.n),
              "kid": kid, "alg": "RS256", "use": "sig"}
    p = key.private_numbers()
    private = {**public, "d": b64url_uint(p.d), "p": b64url_uint(p.p), "q": b64url_uint(p.q),
               "dp": b64url_uint(p.dmp1), "dq": b64url_uint(p.dmq1), "qi": b64url_uint(p.iqmp)}
    return public, private


def ensure_credential(name: str, agent_id: str):
    jwks_url = f"{BASE}/{agent_id}/credentials/jwks"
    existing = client.get(jwks_url)
    keys = existing.json().get("data", []) if existing.status_code == 200 else []
    if keys:
        print(f"  credential already present ({len(keys)} key(s)); statuses: {[k.get('status') for k in keys]}")
        return keys[0]
    public, private = gen_jwk()
    (SECRETS / f"{agent_id}.private.jwk.json").write_text(json.dumps(private, indent=2))
    r = client.post(jwks_url, json=public)
    log("register jwk", r)
    # WLP API may be 202-async; re-GET to find the created key.
    for _ in range(8):
        time.sleep(1)
        g = client.get(jwks_url)
        data = g.json().get("data", []) if g.status_code == 200 else []
        if data:
            key = data[0]
            print(f"  key landed: id={key.get('id')} status={key.get('status')}")
            # activate if inactive, using the key's own lifecycle link if present
            if key.get("status") != "ACTIVE":
                links = key.get("_links", {})
                act = links.get("activate", {}).get("href") if isinstance(links.get("activate"), dict) else None
                act = act or f"{jwks_url}/{key.get('id')}/lifecycle/activate"
                ra = client.post(act)
                log("activate credential", ra)
            return key
    print("  WARN: key did not appear after registration")
    return None


def ensure_owner(name: str, agent_id: str):
    owners_url = f"{BASE}/{agent_id}/owners"
    g = client.get(owners_url)
    if g.status_code == 200 and g.json().get("data"):
        print(f"  owner(s) already assigned")
        return
    # Try documented shapes; log whichever the API accepts.
    for payload in ({"id": OWNER_USER_ID}, {"value": OWNER_USER_ID}, {"userId": OWNER_USER_ID}):
        r = client.post(owners_url, json=payload)
        log(f"assign owner {list(payload)[0]}", r)
        if r.status_code in (200, 201, 202, 204):
            return


def ensure_active(name: str, agent_id: str):
    r = client.post(f"{BASE}/{agent_id}/lifecycle/activate")
    log("activate agent", r)


def main():
    for name, agent_id in AGENTS.items():
        print(f"\n=== {name} ({agent_id}) ===")
        ensure_credential(name, agent_id)
        ensure_owner(name, agent_id)
        ensure_active(name, agent_id)
    print("\n=== final status ===")
    g = client.get(f"{BASE}?limit=100")
    for a in g.json().get("data", []):
        if a["id"] in AGENTS.values():
            print(f"  {a['profile']['name']:24} {a['id']} -> {a['status']}")


if __name__ == "__main__":
    main()
