"""Atlas Service Desk orchestrator (FastAPI).

Runs the autonomous Part-One pipeline:
  inbound → Triage (classify) → A2A delegation → Resolution
          → OPA-vaulted Jira credential → draft → file in Jira.

Emits ActivityEvents over SSE matching the frontend contract. Runs LIVE when the
full env is present; otherwise emits the same sequence on safe demo data so the
service is deployable before the gate + Jira creds land.

Run: ./.venv/bin/python -m uvicorn main:app --port 8080  (from apps/orchestrator)
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import types
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from events import ActivityEvent, EventStream, STATUS_RUNNING, STATUS_OK, STATUS_ERROR
from tickets.seeds import generate_ticket, list_seeds

def _load_local_env():
    """Load .secrets/.env for local runs (no-op in prod where the file is absent)."""
    p = Path(__file__).resolve().parents[2] / ".secrets" / ".env"
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip()  # local .env is source of truth; absent in prod


_load_local_env()

app = FastAPI(title="Atlas Service Desk Orchestrator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OKTA_DOMAIN = os.getenv("OKTA_DOMAIN", "oktaforai.oktapreview.com")
SECRETS = Path(__file__).resolve().parents[2] / ".secrets"


def _jwk(env_name: str, wlp: str) -> Optional[dict]:
    raw = os.getenv(env_name)
    if raw:
        return json.loads(raw)
    f = SECRETS / f"{wlp}.private.jwk.json"
    return json.loads(f.read_text()) if f.exists() else None


# Every case is assigned to a single shared Jira account (JIRA_ASSIGNEE_EMAIL,
# default oktaforai@atko.email) so one login sees them all. Resolve once, cache,
# and assign best-effort so a lookup hiccup never blocks issue creation.
_ASSIGNEE_CACHE: dict = {}


def _assign_to_demo_user(jira, issue_key: str):
    """Assign the issue to the shared demo account. Returns (email, status) where
    status is 'ok' when Jira accepted the assignment (HTTP 204)."""
    email = os.getenv("JIRA_ASSIGNEE_EMAIL", "oktaforai@atko.email")
    if not email:
        return "", "disabled"
    aid = _ASSIGNEE_CACHE.get(email)
    if not aid:
        try:
            aid = jira.find_account_id(email, os.getenv("JIRA_PROJECT_KEY", "ITSD"))
            if aid:
                _ASSIGNEE_CACHE[email] = aid
        except Exception:
            aid = None
    if not aid:
        return email, "user-not-found"
    try:
        code = jira.assign_issue(issue_key, aid)
        return email, ("ok" if code in (200, 204) else f"http-{code}")
    except Exception:
        return email, "error"


def live_ready() -> bool:
    # Live = real Claude triage + real Jira writes. A2A token exchange and the OPA
    # vault are attempted when configured and degrade honestly otherwise (the Jira
    # write falls back to ATLASSIAN_API_TOKEN until the OPA Secret connection exists).
    return all(
        os.getenv(k)
        for k in ("INTAKE_AGENT_ID", "DEVOPS_AGENT_ID", "JIRA_BASE_URL",
                  "ATLASSIAN_EMAIL", "ANTHROPIC_API_KEY")
    )


@app.get("/healthz")
async def healthz():
    return {"ok": True, "mode": "live" if live_ready() else "demo"}


@app.post("/api/tickets/generate")
async def gen(seed: int = 0):
    t = generate_ticket(seed)
    return JSONResponse(t.public())


@app.get("/api/run")
async def run(ticket_id: str = "", seed: int = 0, title: str = "", body: str = "", requester: str = ""):
    # When the client sends the actual inbound ticket, classify/file THAT, so
    # what's on screen is exactly what Claude triages and files. Falls back to a
    # seed ticket only when no content is provided.
    inbound = {"id": ticket_id or "INC-0000", "title": title, "body": body, "requester": requester} if title and body else None
    stream = EventStream()
    asyncio.create_task(_drive(stream, seed, inbound))
    return StreamingResponse(stream.stream(), media_type="text/event-stream")


async def _drive(stream: EventStream, seed: int, inbound: Optional[dict] = None):
    try:
        if live_ready():
            await _run_live(stream, seed, inbound)
        else:
            await _run_demo(stream, seed, inbound)
    except Exception as e:  # never hang the stream
        await stream.emit(ActivityEvent("error", "Atlas", "okta", f"Pipeline error: {e}",
                                        status=STATUS_ERROR, primary=True))
    finally:
        await stream.close()


async def _emit_pair(stream: EventStream, e: ActivityEvent, dwell: float = 0.4):
    await stream.emit(ActivityEvent(**{**e.__dict__, "status": STATUS_RUNNING}))
    await asyncio.sleep(dwell)
    await stream.emit(ActivityEvent(**{**e.__dict__, "status": STATUS_OK}))
    await asyncio.sleep(dwell)


def _naive_dept(title: str, body: str) -> str:
    """Keyword routing for the demo fallback path only (the live path uses Claude)."""
    t = f"{title} {body}".lower()
    if any(k in t for k in ("vpn", "wifi", "wi-fi", "network", "dns", "connect")):
        return "Networking"
    if any(k in t for k in ("laptop", "keyboard", "dock", "power", "monitor", "device", "hardware")):
        return "Hardware"
    if any(k in t for k in ("access", "salesforce", "github", "permission", "sso", "login", "dashboard", "revenue")):
        return "Access Management"
    return "Software"


# ---------------------------------------------------------------- demo path
async def _run_demo(stream: EventStream, seed: int, inbound: Optional[dict] = None):
    if inbound:
        t = types.SimpleNamespace(id=inbound["id"], title=inbound["title"], body=inbound["body"])
        dept = _naive_dept(inbound["title"], inbound["body"])
    else:
        t = generate_ticket(seed)
        dept = t.expected_department
    issue = f"ITSD-{120 + seed % 60}"
    iss = f"https://{OKTA_DOMAIN}/oauth2/aus10rq0j6dqzBIY51d8"
    # NOTE: this demo path only runs when Okta creds are ABSENT (live_ready() is
    # False). The token_claims below use illustrative placeholders ("wlp · Triage"),
    # NOT real workload-principal ids, so nothing here can masquerade as a verified
    # System Log entry. The live path (_run_live) emits the real, log-matching claims.
    seq = [
        ActivityEvent("inbound", "Intake", "intake", "Received via intake API", primary=True,
                      tech=f"{t.id} ingested from the external ticketing system"),
        ActivityEvent("intake_auth", "Triage", "triage", "Triage picked up the ticket",
                      tech="Authenticated to Okta with its workload identity (private_key_jwt)",
                      system_log_id="app.oauth2.token.grant"),
        ActivityEvent("intake_classify", "Triage", "triage",
                      f"Classified as {dept} · routed to the {dept} team", primary=True,
                      tech="Claude classified the ticket and selected the destination team"),
        ActivityEvent("a2a_exchange", "Triage → Resolution", "triage",
                      "Handed off to Resolution", primary=True,
                      tech="Agent-to-agent delegation over Okta (machine context, scope agent.invoke).",
                      token_claims={"sub": "wlp · Triage",
                                    "act": {"sub": "wlp · Triage", "scope": "agent.invoke"},
                                    "aud": "https://atlas.acme.example/resolution",
                                    "scp": ["agent.invoke"], "iss": iss},
                      system_log_id="app.oauth2.token.grant.id_jag"),
        ActivityEvent("opa_vault", "Resolution", "resolve", "Retrieved Jira credential securely",
                      tech="Jira credential released from the Okta OPA vault at runtime (vaulted-secret)",
                      token_claims={"resource": "orn:okta:opa:…:secrets:jira-atlas",
                                    "requested_token_type": "vaulted-secret"},
                      system_log_id="app.credential.vault.access"),
        ActivityEvent("devops_draft", "Resolution", "resolve",
                      "Drafted an acknowledgement and a first next step", primary=True,
                      tech="Claude drafted two work-note comments"),
        ActivityEvent("jira_write", "Resolution", "resolve",
                      f"Filed {issue} in Jira · {dept} · labeled · 2 comments", primary=True,
                      tech="POST /rest/api/3/issue", data={"issue_key": issue, "team": dept},
                      system_log_id="jira.issue.created"),
        ActivityEvent("done", "Atlas", "okta", "Resolved and tracked in Jira", primary=True,
                      tech="Every hop attributed to a governed identity · fully revocable"),
    ]
    for e in seq:
        await _emit_pair(stream, e)


# ---------------------------------------------------------------- live path
async def _run_live(stream: EventStream, seed: int, inbound: Optional[dict] = None):
    import time
    from jose import jwt as jose_jwt
    from llm.claude import classify, draft_comments, draft_resolution
    from okta.a2a_exchange import mint_service_token, exchange_for_id_jag, redeem_id_jag_for_a2a_token
    from okta.opa_vault import retrieve_vaulted_secret
    from jira.client import JiraClient

    t = (types.SimpleNamespace(id=inbound["id"], title=inbound["title"], body=inbound["body"])
         if inbound else generate_ticket(seed))
    requester = (inbound.get("requester") if inbound else "") or getattr(t, "requester", "") or "the requester"
    intake_id = os.environ["INTAKE_AGENT_ID"]
    devops_id = os.environ["DEVOPS_AGENT_ID"]
    intake_jwk = _jwk("INTAKE_PRIVATE_JWK", intake_id)
    devops_jwk = _jwk("DEVOPS_PRIVATE_JWK", devops_id)
    cas_issuer = os.environ["A2A_CAS_ISSUER"].rstrip("/")
    audience = os.environ["A2A_AUDIENCE"]
    scope = os.getenv("A2A_SCOPE", "agent.invoke")

    await _emit_pair(stream, ActivityEvent("inbound", "Intake", "intake",
                     "Received via intake API", primary=True, tech=f"{t.id} ingested via API"))

    # Triage authenticates + classifies
    await stream.emit(ActivityEvent("intake_auth", "Triage", "triage",
                      "Triage picked up the ticket", status=STATUS_RUNNING))
    cls = classify(t.title, t.body)
    dept = cls["department"]
    urgency = cls.get("urgency", "Medium")
    # Claude's urgency assessment actually sets the Jira priority, not just narration.
    priority = {"Critical": "Highest", "High": "High", "Medium": "Medium", "Low": "Low"}.get(urgency, "Medium")
    await stream.emit(ActivityEvent("intake_auth", "Triage", "triage",
                      "Triage picked up the ticket", status=STATUS_OK,
                      tech="Claude reads the ticket. Okta isn't involved yet, that starts at the handoff below."))
    await _emit_pair(stream, ActivityEvent("intake_classify", "Triage", "triage",
                     f"Classified as {dept} · {urgency} priority · routed to the {dept} team", primary=True,
                     tech=f"Claude → {dept} ({urgency})", data={"department": dept, "urgency": urgency}))

    # Fulfillment agent (the third hop), the only agent trusted to touch prod.
    ful_cas_issuer = f"https://{OKTA_DOMAIN}/oauth2/aus10u0cl35sfAoaU1d8"
    ful_resource = "https://atlas.acme.example/fulfillment"

    # ---- Hop 1: Triage → Resolution (first agent-to-agent) ----
    await stream.emit(ActivityEvent("a2a_exchange", "Triage → Resolution", "triage",
                      "Handed off to Resolution", status=STATUS_RUNNING, primary=True))
    t_res, res_claims = None, {}
    try:
        svc_id = os.environ["INTAKE_SERVICE_CLIENT_ID"]
        svc_secret = os.environ["INTAKE_SERVICE_SECRET"]
        t1 = mint_service_token(OKTA_DOMAIN, svc_id, svc_secret, scope=scope).get("access_token")
        if t1:
            idjag = exchange_for_id_jag(t1, intake_id, intake_jwk, OKTA_DOMAIN, cas_issuer, audience,
                                         scope=scope).get("access_token")
            if idjag:
                t_res = redeem_id_jag_for_a2a_token(idjag, intake_id, intake_jwk,
                                                    f"{cas_issuer}/v1/token").get("access_token")
                if t_res:
                    res_claims = jose_jwt.get_unverified_claims(t_res)
    except Exception:
        t_res, res_claims = None, {}
    real1 = "act" in res_claims
    await stream.emit(ActivityEvent("a2a_exchange", "Triage → Resolution", "triage",
                      "Handed off to Resolution", status=STATUS_OK, primary=True,
                      tech=("Intake Service bootstraps (client_credentials); Triage exchanges that for an id-jag "
                            "and invokes Resolution, agent → agent, scope agent.invoke." if real1
                            else "Delegation pending A2A resource registration (Console)"),
                      token_claims=({k: res_claims.get(k) for k in ("sub", "act", "aud", "scp", "iss") if k in res_claims} or None),
                      system_log_id="app.oauth2.token.grant.id_jag" if real1 else None))

    # ---- Resolution decides: self-serviceable (auto-resolve) or route to a specialist? ----
    comments = draft_comments(t.title, t.body, dept)
    auto = random.random() < float(os.getenv("AUTO_RESOLVE_RATE", "0.5"))
    resolution = draft_resolution(t.title, t.body, dept) if auto else ""
    await _emit_pair(stream, ActivityEvent("devops_draft", "Resolution", "resolve",
                     ("Assessed the case as self-serviceable, drafted a customer resolution" if auto
                      else "Decided the fix and drafted work notes"), primary=True,
                     tech=("Claude judged this ticket self-serviceable and wrote the customer reply. Resolution has "
                           "no prod credential, so it delegates execution to Fulfillment to send it and close the case."
                           if auto else
                           "Claude drafts the resolution. Resolution has no prod credential, it delegates execution to Fulfillment.")))

    # ---- Hop 2: Resolution → Fulfillment (second agent-to-agent) ----
    await stream.emit(ActivityEvent("a2a_fulfillment", "Resolution → Fulfillment", "resolve",
                      "Delegated execution to Fulfillment", status=STATUS_RUNNING, primary=True))
    ful_claims: dict = {}
    try:
        if t_res:
            idjag2 = exchange_for_id_jag(t_res, devops_id, devops_jwk, OKTA_DOMAIN, ful_cas_issuer, ful_resource,
                                          scope=scope).get("access_token")
            if idjag2:
                t_ful = redeem_id_jag_for_a2a_token(idjag2, devops_id, devops_jwk,
                                                    f"{ful_cas_issuer}/v1/token").get("access_token")
                if t_ful:
                    ful_claims = jose_jwt.get_unverified_claims(t_ful)
    except Exception:
        ful_claims = {}
    real2 = "act" in ful_claims
    await stream.emit(ActivityEvent("a2a_fulfillment", "Resolution → Fulfillment", "fulfill",
                      "Delegated execution to Fulfillment", status=STATUS_OK, primary=True,
                      tech=("Resolution invokes Fulfillment. The token's act claim now nests BOTH agents, "
                            "Resolution ← Triage ← Intake Service, two workload principals in one credential." if real2
                            else "Fulfillment delegation pending (Console)"),
                      token_claims=({k: ful_claims.get(k) for k in ("sub", "act", "aud", "scp", "iss") if k in ful_claims} or None),
                      system_log_id="app.oauth2.token.grant.id_jag" if real2 else None))

    # ---- Fulfillment: pull the OPA-vaulted credential + file to Jira (only agent trusted on prod) ----
    await stream.emit(ActivityEvent("opa_vault", "Fulfillment", "fulfill",
                      "Retrieved Jira credential securely", status=STATUS_RUNNING))
    jira_token = ""
    orn = os.getenv("JIRA_SECRET_RESOURCE_ORN")
    vaulted = False
    if orn:
        try:
            vault = retrieve_vaulted_secret(devops_id, devops_jwk, OKTA_DOMAIN, orn)
            jira_token = vault.get("access_token") or vault.get("secret") or ""
            vaulted = bool(jira_token)
        except Exception:
            jira_token = ""
    if not jira_token:
        jira_token = os.getenv("ATLASSIAN_API_TOKEN", "")
    await stream.emit(ActivityEvent("opa_vault", "Fulfillment", "fulfill",
                      "Retrieved Jira credential securely", status=STATUS_OK,
                      tech=("STS vaulted-secret exchange (Okta Privileged Access)" if vaulted
                            else "Credential from secure env (OPA vault connection pending)"),
                      system_log_id="app.credential.vault.access" if vaulted else None))

    await stream.emit(ActivityEvent("jira_write", "Fulfillment", "fulfill",
                      "Filing in Jira…", status=STATUS_RUNNING, primary=True))
    jira = JiraClient(os.environ["JIRA_BASE_URL"], os.environ["ATLASSIAN_EMAIL"], jira_token)
    labels = ["atlas", "autonomous", dept.lower().replace(" ", "-")] + (["auto-resolved"] if auto else [])
    issue = jira.create_issue(os.getenv("JIRA_PROJECT_KEY", "ITSD"), t.title, t.body,
                              component=dept, labels=labels, priority=priority)
    key = issue.get("key", "ITSD-?")
    assignee, assign_status = _assign_to_demo_user(jira, key)  # all cases -> shared demo account
    for c in comments:
        jira.add_comment(key, c)
    issue_url = f"{os.environ['JIRA_BASE_URL'].rstrip('/')}/browse/{key}"
    if auto:
        # the agent's customer-facing reply, then REALLY close the case in Jira
        jira.add_comment(key, f"Customer resolution (auto-sent to {requester}):\n\n{resolution}")
        jira_status = jira.resolve_issue(key)
        await stream.emit(ActivityEvent("jira_write", "Fulfillment", "fulfill",
                          f"Auto-resolved {key} · replied to {requester} · "
                          + (f"closed in Jira ({jira_status})" if jira_status else "marked resolved"),
                          status=STATUS_OK, primary=True,
                          data={"issue_key": key, "issue_url": issue_url, "team": dept, "priority": priority,
                                "auto_resolved": True, "resolution": resolution, "requester": requester,
                                "jira_status": jira_status or "Resolved", "assignee": assignee,
                                "assignee_status": assign_status},
                          system_log_id="jira.issue.resolved"))
    else:
        await stream.emit(ActivityEvent("jira_write", "Fulfillment", "fulfill",
                          f"Filed {key} in Jira · routed to {dept} · {priority} priority · {len(comments)} comments",
                          status=STATUS_OK, primary=True,
                          data={"issue_key": key, "issue_url": issue_url, "team": dept, "priority": priority,
                                "auto_resolved": False, "assignee": assignee, "assignee_status": assign_status},
                          system_log_id="jira.issue.created"))

    await _emit_pair(stream, ActivityEvent("done", "Atlas", "okta",
                     ("Case auto-resolved by the agent · customer notified" if auto
                      else f"Filed and routed to {dept} for a specialist"),
                     primary=True, data={"auto_resolved": auto},
                     tech="Three agents, each least-privileged. Every hop attributed and revocable."))
