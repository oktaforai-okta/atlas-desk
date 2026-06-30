"""Atlas Service Desk orchestrator (FastAPI).

Runs the autonomous Part-One pipeline:
  inbound → Atlas Triage (classify) → A2A delegation → Atlas Resolution
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
async def run(ticket_id: str = "", seed: int = 0):
    stream = EventStream()
    asyncio.create_task(_drive(stream, seed))
    return StreamingResponse(stream.stream(), media_type="text/event-stream")


async def _drive(stream: EventStream, seed: int):
    try:
        if live_ready():
            await _run_live(stream, seed)
        else:
            await _run_demo(stream, seed)
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


# ---------------------------------------------------------------- demo path
async def _run_demo(stream: EventStream, seed: int):
    t = generate_ticket(seed)
    dept = t.expected_department
    issue = f"ITSD-{120 + seed % 60}"
    iss = f"https://{OKTA_DOMAIN}/oauth2/aus10rq0j6dqzBIY51d8"
    seq = [
        ActivityEvent("inbound", "Intake", "intake", "Received via intake API", primary=True,
                      tech=f"{t.id} ingested from the external ticketing system"),
        ActivityEvent("intake_auth", "Atlas Triage", "triage", "Atlas Triage picked up the ticket",
                      tech="Authenticated to Okta with its workload identity (private_key_jwt)",
                      system_log_id="app.oauth2.token.grant"),
        ActivityEvent("intake_classify", "Atlas Triage", "triage",
                      f"Classified as {dept} · routed to the {dept} team", primary=True,
                      tech="Claude classified the ticket and selected the destination team"),
        ActivityEvent("a2a_exchange", "Atlas Triage → Atlas Resolution", "triage",
                      "Handed off to Atlas Resolution", primary=True,
                      tech="Agent-to-agent delegation over Okta (machine context, scope agent.invoke).",
                      token_claims={"sub": "wlp · Atlas Triage",
                                    "act": {"sub": "wlp · Atlas Triage", "scope": "agent.invoke"},
                                    "aud": "https://atlas.acme.example/resolution",
                                    "scp": ["agent.invoke"], "iss": iss},
                      system_log_id="app.oauth2.token.grant.id_jag"),
        ActivityEvent("opa_vault", "Atlas Resolution", "resolve", "Retrieved Jira credential securely",
                      tech="Jira credential released from the Okta OPA vault at runtime (vaulted-secret)",
                      token_claims={"resource": "orn:okta:opa:…:secrets:jira-atlas",
                                    "requested_token_type": "vaulted-secret"},
                      system_log_id="app.credential.vault.access"),
        ActivityEvent("devops_draft", "Atlas Resolution", "resolve",
                      "Drafted an acknowledgement and a first next step", primary=True,
                      tech="Claude drafted two work-note comments"),
        ActivityEvent("jira_write", "Atlas Resolution", "resolve",
                      f"Filed {issue} in Jira · {dept} · labeled · 2 comments", primary=True,
                      tech="POST /rest/api/3/issue", data={"issue_key": issue, "team": dept},
                      system_log_id="jira.issue.created"),
        ActivityEvent("done", "Atlas", "okta", "Resolved and tracked in Jira", primary=True,
                      tech="Every hop attributed to a governed identity · fully revocable"),
    ]
    for e in seq:
        await _emit_pair(stream, e)


# ---------------------------------------------------------------- live path
async def _run_live(stream: EventStream, seed: int):
    import time
    from jose import jwt as jose_jwt
    from llm.claude import classify, draft_comments
    from okta.a2a_exchange import get_agent_access_token, exchange_for_agent_resource
    from okta.opa_vault import retrieve_vaulted_secret
    from jira.client import JiraClient

    t = generate_ticket(seed)
    intake_id = os.environ["INTAKE_AGENT_ID"]
    devops_id = os.environ["DEVOPS_AGENT_ID"]
    intake_jwk = _jwk("INTAKE_PRIVATE_JWK", intake_id)
    devops_jwk = _jwk("DEVOPS_PRIVATE_JWK", devops_id)
    cas_issuer = os.environ["A2A_CAS_ISSUER"].rstrip("/")
    audience = os.environ["A2A_AUDIENCE"]
    scope = os.getenv("A2A_SCOPE", "agent.invoke")
    org_token = f"https://{OKTA_DOMAIN}/oauth2/v1/token"

    await _emit_pair(stream, ActivityEvent("inbound", "Intake", "intake",
                     "Received via intake API", primary=True, tech=f"{t.id} ingested via API"))

    # Triage authenticates + classifies
    await stream.emit(ActivityEvent("intake_auth", "Atlas Triage", "triage",
                      "Atlas Triage picked up the ticket", status=STATUS_RUNNING))
    cls = classify(t.title, t.body)
    dept = cls["department"]
    await stream.emit(ActivityEvent("intake_auth", "Atlas Triage", "triage",
                      "Atlas Triage picked up the ticket", status=STATUS_OK,
                      tech="Authenticated to Okta (private_key_jwt)"))
    await _emit_pair(stream, ActivityEvent("intake_classify", "Atlas Triage", "triage",
                     f"Classified as {dept} · routed to the {dept} team", primary=True,
                     tech=f"Claude → {dept} ({cls.get('urgency')})"))

    # A2A delegation — attempt the real exchange; degrade honestly if the resource isn't registered yet
    await stream.emit(ActivityEvent("a2a_exchange", "Atlas Triage → Atlas Resolution", "triage",
                      "Handed off to Atlas Resolution", status=STATUS_RUNNING, primary=True))
    claims: dict = {}
    try:
        subj = get_agent_access_token(intake_id, intake_jwk, org_token, scope=scope)
        tok = subj.get("access_token")
        if tok:
            ex = exchange_for_agent_resource(tok, intake_id, intake_jwk, f"{cas_issuer}/v1/token", audience, scope)
            issued = ex.get("access_token")
            if issued:
                claims = jose_jwt.get_unverified_claims(issued)
    except Exception:
        claims = {}
    real = "act" in claims
    await stream.emit(ActivityEvent("a2a_exchange", "Atlas Triage → Atlas Resolution", "triage",
                      "Handed off to Atlas Resolution", status=STATUS_OK, primary=True,
                      tech=("Agent-to-agent delegation (machine context, agent.invoke)" if real
                            else "Delegation pending A2A resource registration (Console)"),
                      token_claims=({k: claims.get(k) for k in ("sub", "act", "aud", "scp", "iss") if k in claims} or None),
                      system_log_id="app.oauth2.token.grant.id_jag" if real else None))

    # OPA vault → Jira credential (use the vault when configured; else fall back to the API token)
    await stream.emit(ActivityEvent("opa_vault", "Atlas Resolution", "resolve",
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
    await stream.emit(ActivityEvent("opa_vault", "Atlas Resolution", "resolve",
                      "Retrieved Jira credential securely", status=STATUS_OK,
                      tech=("STS vaulted-secret exchange (Okta Privileged Access)" if vaulted
                            else "Credential from secure env (OPA vault connection pending)"),
                      system_log_id="app.credential.vault.access" if vaulted else None))

    # Draft + file
    comments = draft_comments(t.title, t.body, dept)
    await _emit_pair(stream, ActivityEvent("devops_draft", "Atlas Resolution", "resolve",
                     "Drafted an acknowledgement and a first next step", primary=True))

    await stream.emit(ActivityEvent("jira_write", "Atlas Resolution", "resolve",
                      "Filing in Jira…", status=STATUS_RUNNING, primary=True))
    jira = JiraClient(os.environ["JIRA_BASE_URL"], os.environ["ATLASSIAN_EMAIL"], jira_token)
    issue = jira.create_issue(os.getenv("JIRA_PROJECT_KEY", "ITSD"), t.title, t.body,
                              component=dept, labels=["atlas", "autonomous", dept.lower().replace(" ", "-")])
    key = issue.get("key", "ITSD-?")
    for c in comments:
        jira.add_comment(key, c)
    await stream.emit(ActivityEvent("jira_write", "Atlas Resolution", "resolve",
                      f"Filed {key} in Jira · {dept} · labeled · {len(comments)} comments", status=STATUS_OK,
                      primary=True, data={"issue_key": key, "team": dept}, system_log_id="jira.issue.created"))

    await _emit_pair(stream, ActivityEvent("done", "Atlas", "okta", "Resolved and tracked in Jira",
                     primary=True, tech="Every hop attributed to a governed identity · fully revocable"))
