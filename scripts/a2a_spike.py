"""Milestone 0 GATE: prove machine-context A2A token exchange in the live tenant.

Flow (no user anywhere):
  1. Atlas Triage Agent obtains its own access token (client_credentials + JWK).
  2. That token is exchanged at the Atlas Resolution Agent's A2A CAS for a
     resource-scoped token. We then decode it and assert the `act` claim is
     present (the chain of custody) with aud=resource and scope=ticket:file.

Run AFTER scripts/okta_a2a.py has created the CAS + a2a-server + delegation-link.
Required env: OKTA_DOMAIN, A2A_CAS_ISSUER, A2A_AUDIENCE, A2A_SCOPE (default ticket:file).

Usage:
    A2A_CAS_ISSUER=https://your-org.oktapreview.com/oauth2/<cas-id> \
    A2A_AUDIENCE=https://atlas-resolution.agents.acme.example \
    ./.venv/bin/python scripts/a2a_spike.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "orchestrator"))

from jose import jwt  # noqa: E402
from okta.a2a_exchange import get_agent_access_token, exchange_for_agent_resource  # noqa: E402

OKTA_DOMAIN = os.environ.get("OKTA_DOMAIN", "your-org.oktapreview.com")
TRIAGE_WLP = os.environ.get("INTAKE_AGENT_ID", "<intake-agent-id>")
CAS_ISSUER = os.environ["A2A_CAS_ISSUER"].rstrip("/")
AUDIENCE = os.environ["A2A_AUDIENCE"]
SCOPE = os.environ.get("A2A_SCOPE", "ticket:file")

SECRETS = Path(__file__).resolve().parents[1] / ".secrets"
ORG_TOKEN = f"https://{OKTA_DOMAIN}/oauth2/v1/token"
CAS_TOKEN = f"{CAS_ISSUER}/v1/token"


def load_jwk(wlp: str) -> dict:
    return json.loads((SECRETS / f"{wlp}.private.jwk.json").read_text())


def main() -> int:
    jwk = load_jwk(TRIAGE_WLP)

    print("STEP 1, Atlas Triage obtains its own access token (client_credentials)")
    print(f"  endpoint: {ORG_TOKEN}")
    step1 = get_agent_access_token(TRIAGE_WLP, jwk, ORG_TOKEN, scope=SCOPE)
    print(f"  status: {step1.get('_status')}")
    subject = step1.get("access_token")
    if not subject:
        # try the CAS as the issuer of the subject token instead of the Org AS
        print(f"  Org AS did not issue an access token: {json.dumps({k:v for k,v in step1.items() if k!='_status'})[:300]}")
        print("  retrying client_credentials at the CAS issuer...")
        step1 = get_agent_access_token(TRIAGE_WLP, jwk, CAS_TOKEN, scope=SCOPE)
        print(f"  status: {step1.get('_status')}")
        subject = step1.get("access_token")
    if not subject:
        print("\nGATE RESULT: NO-GO at step 1 (delegating agent could not obtain an access token).")
        print(f"  detail: {json.dumps({k:v for k,v in step1.items() if k!='_status'})[:400]}")
        return 1
    print("  ✓ got subject access token")

    print("\nSTEP 2, token-exchange at the Atlas Resolution A2A CAS")
    print(f"  endpoint: {CAS_TOKEN}  audience: {AUDIENCE}  scope: {SCOPE}")
    step2 = exchange_for_agent_resource(subject, TRIAGE_WLP, jwk, CAS_TOKEN, AUDIENCE, SCOPE)
    print(f"  status: {step2.get('_status')}")
    issued = step2.get("access_token")
    if not issued:
        print("\nGATE RESULT: NO-GO at step 2 (exchange failed).")
        print(f"  detail: {json.dumps({k:v for k,v in step2.items() if k!='_status'})[:400]}")
        return 1

    claims = jwt.get_unverified_claims(issued)
    print("\nISSUED TOKEN CLAIMS:")
    for k in ("sub", "act", "aud", "scp", "cid", "client_id"):
        if k in claims:
            print(f"  {k}: {claims[k]}")

    has_act = "act" in claims
    print("\nGATE RESULT:", "GO ✓, machine-context A2A works and the token carries an act chain of custody."
          if has_act else "PARTIAL, exchange succeeded but no act claim present (review).")
    return 0 if has_act else 2


if __name__ == "__main__":
    raise SystemExit(main())
