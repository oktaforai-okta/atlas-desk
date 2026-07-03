"""Wire the Atlas A2A flow for your own tenant.

Creates (idempotent):
  - Atlas Resolution A2A Custom AS (audience = RESOURCE_URL), scope `agent.invoke`
  - access policy (clients = [Atlas Triage wlp]) + rule (CC + jwt-bearer + token-exchange)
  - a2a-server registration on Atlas Resolution, linked to the CAS
  - delegation-link: Atlas Triage -> Atlas Resolution

Prints A2A_CAS_ISSUER + A2A_AUDIENCE for the spike.

Run (set these for your own tenant first, see docs/OKTA_SETUP.md):
    OKTA_SSWS_TOKEN=... OKTA_DOMAIN=... ORG_ID=... \\
    INTAKE_AGENT_ID=... DEVOPS_AGENT_ID=... \\
    ./.venv/bin/python scripts/okta_a2a.py
"""
from __future__ import annotations

import json
import os
import httpx

TOKEN = os.environ["OKTA_SSWS_TOKEN"].strip()
DOM = f"https://{os.environ.get('OKTA_DOMAIN', 'your-org.oktapreview.com')}"
ORG_ID = os.environ.get("ORG_ID", "<org-id>")
TRIAGE = os.environ.get("INTAKE_AGENT_ID", "<intake-agent-id>")      # Atlas Triage Agent (delegator)
RESOLUTION = os.environ.get("DEVOPS_AGENT_ID", "<devops-agent-id>")  # Atlas Resolution Agent (resource)
RESOURCE_URL = "https://atlas.acme.example/resolution"
SCOPE = "agent.invoke"

H = {"Authorization": f"SSWS {TOKEN}", "Accept": "application/json", "Content-Type": "application/json"}
c = httpx.Client(timeout=30, headers=H)


def log(step, r):
    print(f"  [{r.status_code}] {step}: {r.text[:160].strip()}")


def find_as(name):
    r = c.get(f"{DOM}/api/v1/authorizationServers?q={name}")
    for a in (r.json() if r.status_code == 200 else []):
        if a.get("name") == name:
            return a
    return None


def ensure_cas():
    name = "Atlas Resolution A2A"
    a = find_as(name)
    if a:
        print(f"  CAS exists: {a['id']}")
        return a["id"]
    r = c.post(f"{DOM}/api/v1/authorizationServers", json={
        "name": name,
        "description": "A2A Custom AS for the Atlas Resolution Agent (agent.invoke redemption).",
        "audiences": [RESOURCE_URL],
    })
    log("create CAS", r)
    return r.json()["id"]


def ensure_scope(aus):
    r = c.get(f"{DOM}/api/v1/authorizationServers/{aus}/scopes")
    if any(s.get("name") == SCOPE for s in (r.json() if r.status_code == 200 else [])):
        print("  scope exists"); return
    r = c.post(f"{DOM}/api/v1/authorizationServers/{aus}/scopes",
               json={"name": SCOPE, "description": "Invoke the agent", "consent": "IMPLICIT"})
    log("create scope", r)


def ensure_policy_rule(aus):
    pols = c.get(f"{DOM}/api/v1/authorizationServers/{aus}/policies").json()
    pol = next((p for p in pols if p.get("name") == "Atlas A2A Policy"), None)
    if not pol:
        r = c.post(f"{DOM}/api/v1/authorizationServers/{aus}/policies", json={
            "type": "OAUTH_AUTHORIZATION_POLICY",
            "name": "Atlas A2A Policy",
            "description": "Allow CC (service client) and jwt-bearer/token-exchange (agent redemption)",
            "priority": 1,
            "conditions": {"clients": {"include": [TRIAGE]}},
        })
        log("create policy", r); pol = r.json()
    pid = pol["id"]
    rules = c.get(f"{DOM}/api/v1/authorizationServers/{aus}/policies/{pid}/rules").json()
    if any(rl.get("name") == "Allow agent redemption" for rl in rules):
        print("  rule exists"); return
    r = c.post(f"{DOM}/api/v1/authorizationServers/{aus}/policies/{pid}/rules", json={
        "type": "RESOURCE_ACCESS",
        "name": "Allow agent redemption",
        "priority": 1,
        "conditions": {
            "people": {"users": {"include": [], "exclude": []},
                       "groups": {"include": ["EVERYONE"], "exclude": []}},
            "grantTypes": {"include": [
                "client_credentials",
                "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "urn:ietf:params:oauth:grant-type:token-exchange",
            ]},
            "scopes": {"include": ["*"]},
        },
        "actions": {"token": {"accessTokenLifetimeMinutes": 60,
                              "refreshTokenLifetimeMinutes": 129600,
                              "refreshTokenWindowMinutes": 10080}},
    })
    log("create rule", r)


def ensure_a2a_server(aus_issuer):
    base = f"{DOM}/resource-servers/api/v1/a2a-servers/{RESOLUTION}"
    g = c.get(base)
    if g.status_code != 200:
        r = c.post(base, json={"resourceUrl": RESOURCE_URL})
        log("register a2a-server", r)
    else:
        print("  a2a-server exists")
    # link the CAS (try known body variants)
    link = f"{base}/authorization-servers"
    cur = c.get(link)
    if cur.status_code == 200 and cur.json().get("data"):
        print("  a2a-server already linked to a CAS"); return
    for body in ({"issuer": aus_issuer}, {"orn": f"orn:okta:idp:{ORG_ID}:authorization_servers:{AUS_ID}"}, {"id": AUS_ID}):
        r = c.post(link, json=body)
        log(f"link CAS {list(body)[0]}", r)
        if r.status_code in (200, 201, 202):
            return


def ensure_delegation():
    flt = f"to.resourceOrn eq \"orn:okta:directory:{ORG_ID}:workload-principals:ai-agents:{RESOLUTION}\""
    g = c.get(f"{DOM}/workload-principals/api/v1/delegation-links", params={"filter": flt})
    if g.status_code == 200 and g.json().get("data"):
        print("  delegation-link exists"); return
    r = c.post(f"{DOM}/workload-principals/api/v1/delegation-links", json={
        "from": {"clientOrn": f"orn:okta:directory:{ORG_ID}:workload-principals:ai-agents:{TRIAGE}",
                 "tokenType": "ACCESS_TOKEN", "type": "OKTA_AUTHORIZATION_SERVER"},
        "to": {"authorizationServerOrn": f"orn:okta:idp:{ORG_ID}:authorization_servers:{AUS_ID}",
               "resourceOrn": f"orn:okta:directory:{ORG_ID}:workload-principals:ai-agents:{RESOLUTION}"},
    })
    log("create delegation-link", r)


AUS_ID = ""

if __name__ == "__main__":
    print("=== Atlas A2A wiring ===")
    AUS_ID = ensure_cas()
    issuer = f"{DOM}/oauth2/{AUS_ID}"
    ensure_scope(AUS_ID)
    ensure_policy_rule(AUS_ID)
    ensure_a2a_server(issuer)
    ensure_delegation()
    print("\n=== spike env ===")
    print(f"export A2A_CAS_ISSUER={issuer}")
    print(f"export A2A_AUDIENCE={RESOURCE_URL}")
    print(f"export A2A_SCOPE={SCOPE}")
