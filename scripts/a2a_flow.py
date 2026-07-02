"""Machine-context A2A token exchange, the VERIFIED 3-step flow.

Recipe confirmed byte-for-byte against Bala Ganaparthi's O4AA-A2A-TokenInspector
reference repo (github.com/BalaGanaparthi/O4AA-A2A-TokenInspector) and his live
working tenant (bala-secures-ai.oktapreview.com, ProGearSales -> ProGearInventory).

Chain we are proving:  Intake Service Client -> Atlas Triage -> Atlas Resolution

  STEP 1  Service client mints T1 from the CALLER's (Triage's) auth server
          grant=client_credentials, scope=agent.invoke, resource=<triage resourceUrl>
          => T1.aud = Triage's A2A resourceUrl

  STEP 2  Atlas Triage exchanges T1 at the ORG AS for an id-jag targeting Resolution
          grant=token-exchange, subject_token=T1, requested_token_type=id-jag,
          audience=<Resolution CAS issuer>, resource=<Resolution resourceUrl>,
          client_assertion=JWT signed by Triage (iss=sub=Triage wlp, aud=ORG /token)

  STEP 3  Atlas Triage redeems the id-jag at Resolution's CAS for the A2A token
          grant=jwt-bearer, assertion=id-jag,
          client_assertion=JWT signed by Triage (aud=Resolution CAS /token)
          => access_token carries nested `act`: { Resolution -> Triage -> ServiceClient }

BLOCKER (as of 2026-07-01): STEP 2 returns "'subject_token' is invalid" until
Atlas Triage is registered as an A2A RESOURCE in the Okta Console (dual
citizenship). It is Console-only (POST/PUT a2a-servers = 405). Atlas Resolution
is already registered; Bala's caller ProGearSales is too. Once Triage is
registered (URL https://atlas.acme.example/triage, protecting CAS = the Triage
CAS below) and the Intake Service client is added as a Delegation/caller on
Triage, this script should print a real A2A token with the act chain.

Run:  ./.venv/bin/python scripts/a2a_flow.py
"""
from __future__ import annotations

import json
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

DOM = "https://oktaforai.oktapreview.com"
SVC = ENV["INTAKE_SERVICE_CLIENT_ID"]        # 0oa10s89mqikXzZo41d8
SEC = ENV["INTAKE_SERVICE_SECRET"]
TRI = ENV["INTAKE_AGENT_ID"]                 # wlp10qjmsgdQROgxE1d8  (Atlas Triage, caller)
RES_CAS = "aus10rq0j6dqzBIY51d8"             # Atlas Resolution CAS (target)
RES_URL = "https://atlas.acme.example/resolution"

# Caller-side CAS created via API 2026-06-30 (aud = triage-resource).
TRIAGE_CAS = "aus10sd70du8BMzlL1d8"          # "Atlas Triage A2A"
# After Triage is registered as an A2A resource in the Console, set this to the
# resourceUrl you registered (recommended: https://atlas.acme.example/triage).
TRIAGE_RESOURCE = "https://atlas.acme.example/triage"

JWK = json.loads((REPO / ".secrets" / f"{TRI}.private.jwk.json").read_text())

TCAS_TOKEN = f"{DOM}/oauth2/{TRIAGE_CAS}/v1/token"
ORG_TOKEN = f"{DOM}/oauth2/v1/token"
RES_TOKEN = f"{DOM}/oauth2/{RES_CAS}/v1/token"
RES_ISSUER = f"{DOM}/oauth2/{RES_CAS}"

TE = "urn:ietf:params:oauth:grant-type:token-exchange"
JB = "urn:ietf:params:oauth:grant-type:jwt-bearer"
AT = "urn:ietf:params:oauth:token-type:access_token"
IJ = "urn:ietf:params:oauth:token-type:id-jag"
CA = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"


def triage_jwt(aud: str) -> str:
    """Client assertion signed by Atlas Triage (iss=sub=Triage wlp)."""
    now = int(time.time())
    return jwt.encode(
        {"iss": TRI, "sub": TRI, "aud": aud, "iat": now, "exp": now + 120, "jti": str(uuid.uuid4())},
        JWK, algorithm="RS256", headers={"kid": JWK["kid"], "typ": "JWT"},
    )


def main() -> None:
    print("STEP 1: service client mints T1 from Triage CAS (resource=%s)" % TRIAGE_RESOURCE)
    r1 = httpx.post(TCAS_TOKEN, data={
        "grant_type": "client_credentials", "scope": "agent.invoke",
        "resource": TRIAGE_RESOURCE, "client_id": SVC, "client_secret": SEC,
    })
    t1 = r1.json().get("access_token")
    print("   ", r1.status_code, ("ok aud=" + jwt.get_unverified_claims(t1)["aud"] if t1 else r1.text[:240]))
    if not t1:
        return

    print("STEP 2: Triage exchanges T1 at ORG AS -> id-jag (audience=Resolution CAS)")
    r2 = httpx.post(ORG_TOKEN, data={
        "grant_type": TE, "subject_token": t1, "subject_token_type": AT,
        "requested_token_type": IJ, "audience": RES_ISSUER, "resource": RES_URL,
        "client_assertion_type": CA, "client_assertion": triage_jwt(ORG_TOKEN),
        "scope": "agent.invoke",
    })
    idjag = r2.json().get("access_token")
    print("   ", r2.status_code, ("id-jag ok" if idjag else r2.text[:300]))
    if not idjag:
        return

    print("STEP 3: Triage redeems id-jag at Resolution CAS -> A2A token")
    r3 = httpx.post(RES_TOKEN, data={
        "grant_type": JB, "assertion": idjag,
        "client_assertion_type": CA, "client_assertion": triage_jwt(RES_TOKEN),
    })
    a2a = r3.json().get("access_token")
    print("   ", r3.status_code, ("A2A TOKEN" if a2a else r3.text[:300]))
    if a2a:
        c = jwt.get_unverified_claims(a2a)
        print("\n===== REAL A2A TOKEN - CHAIN OF CUSTODY =====")
        for k in ("sub", "act", "aud", "scp", "cid", "iss", "exp"):
            if k in c:
                print(f"   {k}: {json.dumps(c[k])}")


if __name__ == "__main__":
    main()
