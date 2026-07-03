"""Multi-hop A2A token chain, the two-agent version.

Chain proven:
  Intake Service Client -> Atlas Triage -> Atlas Resolution -> Atlas Fulfillment

  STEP 1        service client mints T1 from Triage's CAS (client_credentials, resource=Triage)
  STEP 2-3      Triage exchanges T1 -> id-jag -> A2A token for Resolution   (act: Triage <- service)
  STEP 4-5      Resolution exchanges THAT token -> id-jag -> FINAL token for Fulfillment
                (act: Resolution <- Triage <- service)  <-- TWO agent workload principals as actors

The final token (issued for Fulfillment) is the proof the user asked for: its `act`
claim nests BOTH Triage and Resolution as ai_agent actors.

Requires (Okta Console): Atlas Fulfillment registered as an A2A resource
(FUL_URL below, protecting CAS FUL_CAS) with Atlas Resolution added as a
caller/delegation. Until then STEP 4 returns 'subject_token invalid'.

Run (set these for your own tenant first, see docs/OKTA_SETUP.md):
    OKTA_DOMAIN=... DEVOPS_AGENT_ID=... FULFILLMENT_AGENT_ID=... \\
    TRIAGE_CAS_ID=... RESOLUTION_CAS_ID=... FULFILLMENT_CAS_ID=... \\
    ./.venv/bin/python scripts/a2a_chain.py
"""
from __future__ import annotations

import json
import os
import pathlib
import time
import uuid

import httpx
from jose import jwt

REPO = pathlib.Path(__file__).resolve().parents[1]
ENV = dict(
    l.strip().split("=", 1)
    for l in (REPO / ".secrets" / ".env").read_text().splitlines()
    if l.strip() and not l.startswith("#") and "=" in l
)

DOM = f"https://{os.environ.get('OKTA_DOMAIN', 'your-org.oktapreview.com')}"
SVC = ENV["INTAKE_SERVICE_CLIENT_ID"]
SEC = ENV["INTAKE_SERVICE_SECRET"]
TRI = ENV["INTAKE_AGENT_ID"]                                      # Atlas Triage (caller 1)
RES = os.environ.get("DEVOPS_AGENT_ID", "<devops-agent-id>")      # Atlas Resolution (callee 1 / caller 2)
FUL = os.environ.get("FULFILLMENT_AGENT_ID", "<fulfillment-agent-id>")  # Atlas Fulfillment (callee 2)

TRIAGE_CAS, TRIAGE_URL = os.environ.get("TRIAGE_CAS_ID", "<triage-cas-id>"), "https://atlas.acme.example/triage"
RES_CAS, RES_URL = os.environ.get("RESOLUTION_CAS_ID", "<resolution-cas-id>"), "https://atlas.acme.example/resolution"
FUL_CAS, FUL_URL = os.environ.get("FULFILLMENT_CAS_ID", "<fulfillment-cas-id>"), "https://atlas.acme.example/fulfillment"

TRI_JWK = json.loads((REPO / ".secrets" / f"{TRI}.private.jwk.json").read_text())
RES_JWK = json.loads((REPO / ".secrets" / f"{RES}.private.jwk.json").read_text())

ORG_TOKEN = f"{DOM}/oauth2/v1/token"
TE = "urn:ietf:params:oauth:grant-type:token-exchange"
JB = "urn:ietf:params:oauth:grant-type:jwt-bearer"
AT = "urn:ietf:params:oauth:token-type:access_token"
IJ = "urn:ietf:params:oauth:token-type:id-jag"
CA = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"


def agent_jwt(agent_id: str, jwk: dict, aud: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": agent_id, "sub": agent_id, "aud": aud, "iat": now, "exp": now + 120, "jti": str(uuid.uuid4())},
        jwk, algorithm="RS256", headers={"kid": jwk["kid"], "typ": "JWT"},
    )


def hop(subject_token: str, actor_id: str, actor_jwk: dict, target_cas: str, target_url: str, label: str):
    """One agent-to-agent hop: token-exchange -> id-jag, then jwt-bearer redeem."""
    issuer = f"{DOM}/oauth2/{target_cas}"
    r = httpx.post(ORG_TOKEN, data={
        "grant_type": TE, "subject_token": subject_token, "subject_token_type": AT,
        "requested_token_type": IJ, "audience": issuer, "resource": target_url,
        "client_assertion_type": CA, "client_assertion": agent_jwt(actor_id, actor_jwk, ORG_TOKEN),
        "scope": "agent.invoke",
    })
    idjag = r.json().get("access_token")
    print(f"   [{label}] id-jag: {r.status_code} {'ok' if idjag else r.text[:220]}")
    if not idjag:
        return None
    tok_ep = f"{issuer}/v1/token"
    r2 = httpx.post(tok_ep, data={
        "grant_type": JB, "assertion": idjag,
        "client_assertion_type": CA, "client_assertion": agent_jwt(actor_id, actor_jwk, tok_ep),
    })
    tok = r2.json().get("access_token")
    print(f"   [{label}] A2A token: {r2.status_code} {'ok' if tok else r2.text[:220]}")
    return tok


def main() -> None:
    print("STEP 1: Intake Service client mints T1 from Triage's CAS")
    r1 = httpx.post(f"{DOM}/oauth2/{TRIAGE_CAS}/v1/token", data={
        "grant_type": "client_credentials", "scope": "agent.invoke",
        "resource": TRIAGE_URL, "client_id": SVC, "client_secret": SEC,
    })
    t1 = r1.json().get("access_token")
    print(f"   T1: {r1.status_code} {'ok' if t1 else r1.text[:220]}")
    if not t1:
        return

    print("STEP 2-3: Atlas Triage  ->  Atlas Resolution")
    t_res = hop(t1, TRI, TRI_JWK, RES_CAS, RES_URL, "Triage->Resolution")
    if not t_res:
        return

    print("STEP 4-5: Atlas Resolution  ->  Atlas Fulfillment")
    t_ful = hop(t_res, RES, RES_JWK, FUL_CAS, FUL_URL, "Resolution->Fulfillment")
    if not t_ful:
        return

    c = jwt.get_unverified_claims(t_ful)
    print("\n===== FINAL A2A TOKEN, issued for Atlas Fulfillment =====")
    for k in ("sub", "act", "aud", "scp", "cid", "iss"):
        if k in c:
            print(f"   {k}: {json.dumps(c[k])}")
    agents = []
    node = c.get("act")
    while isinstance(node, dict):
        if node.get("sub_profile") == "ai_agent" and node.get("sub"):
            agents.append(node["sub"])
        node = node.get("act")
    print(f"\n   >>> agent workload principals in the act chain: {agents}")
    print(f"   >>> expected: ['{RES}' (Resolution), '{TRI}' (Triage)]")


if __name__ == "__main__":
    main()
