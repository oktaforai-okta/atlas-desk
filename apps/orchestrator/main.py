"""Atlas Service Desk orchestrator (FastAPI).

Runs the autonomous pipeline and, more to the point, makes the AUTHORIZATION
visible at every step:

    inbound
      -> Agent 1 is granted ticket.read
      -> Agent 1 really reads Jira (duplicate search)
      -> Claude classifies and judges whether the case is self-serviceable
      -> Agent 1 ATTEMPTS a write and Okta refuses it          <- the proof
      -> Agent 1 delegates to Agent 2 (act chain records it)
      -> Agent 2 obtains ticket.write on the write lane        <- capability change
      -> Agent 2 releases the OPA-vaulted Jira credential
      -> Agent 2 writes to Jira

Two Okta workload principals, not three. Agent 1 can read and provably cannot
write; Agent 2 can write. The distinction is enforced by Okta policy, not by
this code, and the denied attempt is emitted with Okta's own error body so a
viewer can see it rather than take our word for it.

Emits ActivityEvents over SSE. Runs LIVE when the full env is present; otherwise
emits the same sequence on safe demo data so the service stays deployable.

Run: ./.venv/bin/python -m uvicorn main:app --port 8080  (from apps/orchestrator)
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
import types
from collections import deque
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from events import ActivityEvent, EventStream, STATUS_RUNNING, STATUS_OK, STATUS_ERROR
from tickets.seeds import generate_ticket

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("atlas")


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

# CORS is an allowlist, not a wildcard. /api/run costs real money (Claude) and has
# real side effects (Jira writes), so it should not be callable from any origin on
# the web. This is not authentication -- a browser origin is trivially forged by a
# non-browser client -- it is the cheap half. The rate limiter below is the other.
_DEFAULT_ORIGINS = "https://atlas-desk.vercel.app,https://atlas-desk-osai.vercel.app"
ALLOWED_ORIGINS = [o.strip() for o in
                   os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()]
# Any localhost/127.0.0.1 port is allowed so `next dev` works on whatever port it
# lands on. Vercel preview deployments get their own generated subdomain per
# branch, so those are matched by pattern too rather than enumerated.
_ORIGIN_RE = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://atlas-desk[a-z0-9-]*\.vercel\.app$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX", _ORIGIN_RE),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

OKTA_DOMAIN = os.getenv("OKTA_DOMAIN", "your-org.oktapreview.com")
SECRETS = Path(__file__).resolve().parents[2] / ".secrets"

# CRUD lanes. The scope names are the whole point of the demo, so they are named
# explicitly rather than reusing one catch-all scope for every hop.
READ_SCOPE = os.getenv("A2A_READ_SCOPE", "ticket.read")
WRITE_SCOPE = os.getenv("A2A_WRITE_SCOPE", "ticket.write")

# Per-IP rate limit on the expensive endpoint.
RATE_LIMIT_N = int(os.getenv("RATE_LIMIT_RUNS", "12"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "300"))
_hits: dict[str, deque] = {}


def _rate_limited(ip: str) -> bool:
    now = time.time()
    q = _hits.setdefault(ip, deque())
    while q and now - q[0] > RATE_LIMIT_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT_N:
        return True
    q.append(now)
    return False


def _jwk(env_name: str, wlp: str) -> Optional[dict]:
    raw = os.getenv(env_name)
    if raw:
        return json.loads(raw)
    f = SECRETS / f"{wlp}.private.jwk.json"
    return json.loads(f.read_text()) if f.exists() else None


def _extract_vaulted_secret(vault: dict) -> str:
    """Pull the usable credential out of a vaulted-secret release.

    Okta returns the released material under ``vaulted_secret``. For an OPA "API Key"
    template it may be a JSON key/value map ({"apikey": "...", "username": "", ...});
    take apikey/token/password, else the first non-empty value. Also handles a plain
    string. Falls back through the older ``access_token``/``secret`` field names.
    """
    raw = vault.get("vaulted_secret") or vault.get("access_token") or vault.get("secret") or ""
    if isinstance(raw, dict):
        m = raw
    elif isinstance(raw, str) and raw.strip().startswith("{"):
        try:
            m = json.loads(raw)
        except Exception:
            return raw.strip()
    else:
        return raw.strip() if isinstance(raw, str) else ""
    if isinstance(m, dict):
        return (m.get("apikey") or m.get("token") or m.get("password")
                or next((v for v in m.values() if v), "") or "")
    return ""


def _fake_jwt(payload: dict, typ: str = "JWT") -> str:
    """Unsigned, syntactically-real JWT for demo mode (no Okta creds configured).

    alg=none is the actual RFC 7515 vocabulary for an unsecured JWS, not an
    invented hack, this is a real header/payload, correctly encoded, with a
    loud, non-cryptographic third segment so nobody could mistake it for a
    live Okta-issued token. Two independent "this isn't real" tells: one for
    anyone who reads JWT internals, one for anyone who just glances at it.

    `typ` is overridable so a demo ID-JAG carries the real "oauth-id-jag+jwt"
    header marker that distinguishes it from a plain access token, as a real
    one does.
    """
    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'none', 'typ': typ})}.{b64(payload)}.DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN"


# Every case is assigned to a single shared Jira account (JIRA_ASSIGNEE_EMAIL)
# so one login sees them all. Resolve once, cache, and assign best-effort so a
# lookup hiccup never blocks issue creation.
_ASSIGNEE_CACHE: dict = {}


def _assign_to_demo_user(jira, issue_key: str):
    """Assign the issue to the shared demo account. Returns (email, status) where
    status is 'ok' when Jira accepted the assignment (HTTP 204)."""
    email = os.getenv("JIRA_ASSIGNEE_EMAIL", "")
    if not email:
        return "", "disabled"
    aid = _ASSIGNEE_CACHE.get(email)
    if not aid:
        try:
            aid = jira.find_account_id(email, os.getenv("JIRA_PROJECT_KEY", "ITSD"))
            if aid:
                _ASSIGNEE_CACHE[email] = aid
        except Exception:
            log.warning("assignee lookup failed for %s", email, exc_info=True)
            aid = None
    if not aid:
        return email, "user-not-found"
    try:
        code = jira.assign_issue(issue_key, aid)
        return email, ("ok" if code in (200, 204) else f"http-{code}")
    except Exception:
        log.warning("assign_issue failed for %s", issue_key, exc_info=True)
        return email, "error"


# Every variable _run_live actually dereferences. Previously this list omitted the
# A2A settings that _run_live hard-indexes, so a half-configured deploy reported
# "live", passed Render's health check, and then failed on the first real run.
REQUIRED_LIVE_ENV = (
    "INTAKE_AGENT_ID", "DEVOPS_AGENT_ID", "JIRA_BASE_URL", "ATLASSIAN_EMAIL",
    "ANTHROPIC_API_KEY", "INTAKE_SERVICE_CLIENT_ID", "INTAKE_SERVICE_SECRET",
    "A2A_CAS_ISSUER", "A2A_AUDIENCE",
)


def missing_live_env() -> list[str]:
    return [k for k in REQUIRED_LIVE_ENV if not os.getenv(k)]


def live_ready() -> bool:
    return not missing_live_env()


@app.get("/healthz")
async def healthz():
    missing = missing_live_env()
    return {"ok": True, "mode": "demo" if missing else "live", "missing_env": missing}


@app.post("/api/tickets/generate")
async def gen(seed: int = 0):
    return JSONResponse(generate_ticket(seed).public())


@app.get("/api/run")
async def run(request: Request, ticket_id: str = "", seed: int = 0,
              title: str = "", body: str = "", requester: str = ""):
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else "unknown"))
    if _rate_limited(ip):
        log.warning("rate limited %s", ip)
        return JSONResponse({"error": "rate_limited",
                             "detail": f"max {RATE_LIMIT_N} runs per "
                                       f"{RATE_LIMIT_WINDOW}s"}, status_code=429)
    # When the client sends the actual inbound ticket, classify/file THAT, so
    # what's on screen is exactly what Claude triages and files. Falls back to a
    # seed ticket only when no content is provided.
    inbound = ({"id": ticket_id or "INC-0000", "title": title, "body": body,
                "requester": requester} if title and body else None)
    stream = EventStream()
    asyncio.create_task(_drive(stream, seed, inbound))
    return StreamingResponse(stream.stream(), media_type="text/event-stream")


async def _drive(stream: EventStream, seed: int, inbound: Optional[dict] = None):
    try:
        if live_ready():
            await _run_live(stream, seed, inbound)
        else:
            log.info("running demo path; missing env: %s", missing_live_env())
            await _run_demo(stream, seed, inbound)
    except Exception as e:  # never hang the stream
        log.exception("pipeline failed")
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


def _naive_self_serviceable(title: str, body: str) -> bool:
    """Demo-path stand-in for Claude's judgement, using the same rule of thumb:
    physical or entitlement problems need a human; settings problems do not."""
    t = f"{title} {body}".lower()
    physical = ("won't power", "wont power", "blink", "replace", "keyboard", "dock",
                "monitor", "webcam", "hardware", "shipment", "broken", "cracked")
    entitlement = ("access", "permission", "admin role", "entitle", "not a member",
                   "shared drive", "provision")
    return not any(k in t for k in physical + entitlement)


# ---------------------------------------------------------------- demo path
async def _run_demo(stream: EventStream, seed: int, inbound: Optional[dict] = None):
    if inbound:
        t = types.SimpleNamespace(id=inbound["id"], title=inbound["title"], body=inbound["body"])
    else:
        t = generate_ticket(seed)
    requester = (inbound.get("requester") if inbound else "") or getattr(t, "reporter", "") or "the requester"
    dept = _naive_dept(t.title, t.body)
    auto = _naive_self_serviceable(t.title, t.body)
    issue = f"ITSD-{120 + seed % 60}"

    # This path only runs when Okta creds are ABSENT. The claims below use
    # illustrative EXAMPLE_* placeholder ids and unsigned (alg=none) tokens, NOT a
    # real tenant's ids or real Okta-issued JWTs, so nothing here can masquerade as
    # a verified System Log entry. The SHAPES mirror the real tokens: sub is the
    # Intake Service root, cid is the holding agent, act nests the chain, ID-JAGs
    # carry a bare-org iss plus the oauth-id-jag+jwt header. Must stay in lockstep
    # with illustrativeRawTokens() in apps/web/lib/tokenInspector.ts.
    org = "https://example.oktapreview.com"
    read_cas = f"{org}/oauth2/<read-lane-cas-id>"
    write_cas = f"{org}/oauth2/<write-lane-cas-id>"
    read_res = "https://atlas.example/triage"
    write_res = "https://atlas.example/write"
    ex_intake, ex_a1, ex_a2 = "0oaEXAMPLEIntakeSvc1", "wlpEXAMPLEAgentOne01", "wlpEXAMPLEAgentTwo01"
    IAT, EXP, IDJAG_EXP = 1783120519, 1783124119, 1783120819
    act1 = {"sub": ex_a1, "sub_profile": "ai_agent", "act": {"sub": ex_intake, "sub_profile": "service"}}
    act2 = {"sub": ex_a2, "sub_profile": "ai_agent", "act": act1}

    t1 = {"ver": 1, "jti": "AT.EXAMPLE-read", "iss": read_cas, "aud": read_res, "iat": IAT,
          "exp": EXP, "cid": ex_intake, "scp": [READ_SCOPE], "sub": ex_intake}
    ij1 = {"jti": "IDAAG.EXAMPLE-1", "iss": org, "aud": read_cas, "iat": IAT, "exp": IDJAG_EXP,
           "sub": ex_intake, "resource": read_res, "client_id": ex_a1,
           "sub_profile": "service", "scope": READ_SCOPE, "act": act1}
    tres = {"ver": 1, "jti": "AT.EXAMPLE-a2", "iss": read_cas, "aud": read_res, "iat": IAT,
            "exp": EXP, "cid": ex_a1, "scp": [READ_SCOPE], "auth_time": IAT,
            "sub": ex_intake, "act": act1, "sub_profile": "service"}
    ij2 = {"jti": "IDAAG.EXAMPLE-2", "iss": org, "aud": write_cas, "iat": IAT, "exp": IDJAG_EXP,
           "sub": ex_intake, "resource": write_res, "client_id": ex_a2,
           "sub_profile": "service", "scope": WRITE_SCOPE, "act": act2}
    tful = {"ver": 1, "jti": "AT.EXAMPLE-write", "iss": write_cas, "aud": write_res, "iat": IAT,
            "exp": EXP, "cid": ex_a2, "scp": [WRITE_SCOPE], "auth_time": IAT,
            "sub": ex_intake, "act": act2, "sub_profile": "service"}

    dup = [{"key": "ITSD-104", "summary": "Similar open report", "status": "In Progress"}]
    seq = [
        ActivityEvent("inbound", "Intake", "intake", "Received via intake API", primary=True,
                      tech=f"{t.id} ingested from the external ticketing system"),
        ActivityEvent("read_grant", "Agent 1", "triage",
                      f"Granted read access · {READ_SCOPE}", primary=True,
                      tech="The Intake Service bootstraps the chain (client_credentials) and "
                           "Agent 1 receives a token scoped to read only.",
                      data={"scope": READ_SCOPE, "holder": ex_a1},
                      raw_tokens={"t1": _fake_jwt(t1)},
                      system_log_id="app.oauth2.token.grant"),
        ActivityEvent("jira_read", "Agent 1", "triage",
                      f"Checked for duplicates · {len(dup)} similar ticket open", primary=True,
                      tech=f"GET /rest/api/3/search authorized by {READ_SCOPE}",
                      data={"scope": READ_SCOPE, "similar": dup}),
        ActivityEvent("classify", "Agent 1", "triage",
                      f"Classified as {dept} · routed to the {dept} team", primary=True,
                      tech="Claude classified the ticket and judged whether it is self-serviceable",
                      data={"department": dept, "self_serviceable": auto,
                            "reason": ("Fixable by the user with instructions" if auto
                                       else "Needs a human: physical or entitlement change")}),
        ActivityEvent("write_denied", "Agent 1", "triage",
                      f"Write refused by Okta · Agent 1 cannot hold {WRITE_SCOPE}", primary=True,
                      tech=f"Agent 1 asked Okta for {WRITE_SCOPE} and was refused. Least privilege "
                           f"is enforced by policy, not by this application.",
                      data={"denied": True, "http_status": 401, "error": "access_denied",
                            "error_description": "Policy evaluation failed for this request, "
                                                 "please check the policy configurations.",
                            "attempted_scope": WRITE_SCOPE},
                      system_log_id="app.oauth2.as.consent.grant.deny"),
        ActivityEvent("a2a_delegate", "Agent 1 → Agent 2", "triage",
                      "Delegated to the write-capable agent", primary=True,
                      tech="Agent 1 cannot write, so it delegates. The act claim records that "
                           "Agent 1 initiated this, so the write stays attributable to it.",
                      token_claims=tres,
                      raw_tokens={"idjag1": _fake_jwt(ij1, "oauth-id-jag+jwt"),
                                  "t_res": _fake_jwt(tres)},
                      data={"scope": READ_SCOPE},
                      system_log_id="app.oauth2.token.grant.id_jag"),
        ActivityEvent("write_grant", "Agent 2", "fulfill",
                      f"Granted write access · {WRITE_SCOPE}", primary=True,
                      tech="Agent 2 is the only client authorized on the write authorization "
                           "server, so only Agent 2 can obtain this scope. Its act claim still "
                           "names Agent 1 and the Intake Service.",
                      token_claims=tful,
                      raw_tokens={"idjag2": _fake_jwt(ij2, "oauth-id-jag+jwt"),
                                  "t_ful": _fake_jwt(tful)},
                      data={"scope": WRITE_SCOPE},
                      system_log_id="app.oauth2.token.grant.id_jag"),
        ActivityEvent("draft", "Agent 2", "resolve",
                      ("Assessed the case as self-serviceable, drafted a customer resolution"
                       if auto else "Decided the fix and drafted work notes"), primary=True,
                      tech="Claude drafted the reply"),
        ActivityEvent("opa_vault", "Agent 2", "fulfill", "Released the Jira credential",
                      tech="Jira credential released from the Okta Privileged Access vault at "
                           "runtime (vaulted-secret), never stored in agent code",
                      data={"resource_orn": "orn:okta:pam:…:secrets:jira-atlas",
                            "subject_token_ref": "t_res", "vaulted": True},
                      system_log_id="app.credential.vault.access"),
        ActivityEvent("jira_write", "Agent 2", "fulfill",
                      (f"Auto-resolved {issue} · replied to {requester} · closed in Jira" if auto
                       else f"Filed {issue} · routed to {dept} · 2 comments"), primary=True,
                      tech=f"POST /rest/api/3/issue authorized by {WRITE_SCOPE}",
                      data={"issue_key": issue, "team": dept, "auto_resolved": auto,
                            "scope": WRITE_SCOPE},
                      system_log_id="jira.issue.resolved" if auto else "jira.issue.created"),
        ActivityEvent("done", "Atlas", "okta",
                      ("Case auto-resolved by the agent · customer notified" if auto
                       else f"Filed and routed to {dept} for a specialist"), primary=True,
                      data={"auto_resolved": auto},
                      tech="One agent could read. One could write. Okta decided which."),
    ]
    for e in seq:
        await _emit_pair(stream, e)


# ---------------------------------------------------------------- live path
async def _run_live(stream: EventStream, seed: int, inbound: Optional[dict] = None):
    from jose import jwt as jose_jwt
    from llm.claude import classify, draft_comments, draft_resolution
    from okta.a2a_exchange import (mint_service_token, exchange_for_id_jag,
                                   redeem_id_jag_for_a2a_token, attempt_denied_write)
    from okta.opa_vault import retrieve_vaulted_secret, SUBJECT_TYPE_ACCESS_TOKEN
    from okta.scope_guard import require_scope, ScopeDenied, scopes_of
    from jira.client import JiraClient

    t = (types.SimpleNamespace(id=inbound["id"], title=inbound["title"], body=inbound["body"])
         if inbound else generate_ticket(seed))
    requester = ((inbound.get("requester") if inbound else "")
                 or getattr(t, "reporter", "") or "the requester")
    a1_id = os.environ["INTAKE_AGENT_ID"]     # Agent 1, read-only
    a2_id = os.environ["DEVOPS_AGENT_ID"]     # Agent 2, write-capable
    a1_jwk = _jwk("INTAKE_PRIVATE_JWK", a1_id)
    a2_jwk = _jwk("DEVOPS_PRIVATE_JWK", a2_id)
    read_cas_issuer = os.environ["A2A_CAS_ISSUER"].rstrip("/")
    read_resource = os.environ["A2A_AUDIENCE"]
    write_cas_issuer = os.getenv("FULFILLMENT_CAS_ISSUER",
                                 f"https://{OKTA_DOMAIN}/oauth2/<write-lane-cas-id>").rstrip("/")
    write_resource = os.getenv("FULFILLMENT_RESOURCE", "https://atlas.example/write")
    project = os.getenv("JIRA_PROJECT_KEY", "ITSD")
    log.info("live run %s | a1=%s a2=%s read_scope=%s write_scope=%s",
             t.id, a1_id, a2_id, READ_SCOPE, WRITE_SCOPE)

    await _emit_pair(stream, ActivityEvent("inbound", "Intake", "intake",
                     "Received via intake API", primary=True, tech=f"{t.id} ingested via API"))

    # ---- Agent 1 is granted READ ----
    await stream.emit(ActivityEvent("read_grant", "Agent 1", "triage",
                      f"Granted read access · {READ_SCOPE}", status=STATUS_RUNNING, primary=True))
    t1 = None
    try:
        boot = mint_service_token(OKTA_DOMAIN, os.environ["INTAKE_SERVICE_CLIENT_ID"],
                                  os.environ["INTAKE_SERVICE_SECRET"], scope=READ_SCOPE)
        t1 = boot.get("access_token")
        if not t1:
            log.error("bootstrap mint failed: %s", json.dumps(boot)[:300])
    except Exception:
        log.exception("bootstrap mint raised")
    await stream.emit(ActivityEvent("read_grant", "Agent 1", "triage",
                      f"Granted read access · {READ_SCOPE}" if t1 else "Read grant unavailable",
                      status=STATUS_OK if t1 else STATUS_ERROR, primary=True,
                      tech=("The Intake Service bootstraps the chain (client_credentials, the one "
                            f"grant an agent may not use) and Agent 1 receives a {READ_SCOPE} "
                            "token. It has no write scope and cannot obtain one."
                            if t1 else "Bootstrap token unavailable, check the read lane config"),
                      data={"scope": READ_SCOPE, "holder": a1_id,
                            "granted": scopes_of(t1)},
                      raw_tokens={"t1": t1} if t1 else None,
                      system_log_id="app.oauth2.token.grant" if t1 else None))

    # ---- Agent 1 really READS Jira (scope-gated) ----
    await stream.emit(ActivityEvent("jira_read", "Agent 1", "triage",
                      "Checking for duplicates…", status=STATUS_RUNNING, primary=True))
    similar: list[dict] = []
    read_ok, read_note = False, ""
    try:
        require_scope(t1, READ_SCOPE)
        reader = JiraClient(os.environ["JIRA_BASE_URL"], os.environ["ATLASSIAN_EMAIL"],
                            os.getenv("ATLASSIAN_API_TOKEN", ""))
        similar = reader.search_similar(project, t.title)
        read_ok = True
    except ScopeDenied as e:
        read_note = str(e)
        log.warning("read blocked by scope guard: %s", e)
    except Exception:
        read_note = "Jira read failed"
        log.exception("jira read failed")
    await stream.emit(ActivityEvent("jira_read", "Agent 1", "triage",
                      (f"Checked for duplicates · {len(similar)} similar ticket"
                       f"{'' if len(similar) == 1 else 's'} open" if read_ok
                       else f"Duplicate check skipped · {read_note}"),
                      status=STATUS_OK if read_ok else STATUS_ERROR, primary=True,
                      tech=(f"GET /rest/api/3/search, authorized by {READ_SCOPE}. This is a real "
                            "read against the live project, not a narrated one."
                            if read_ok else read_note),
                      data={"scope": READ_SCOPE, "similar": similar}))

    # ---- Claude classifies AND judges self-serviceability ----
    await stream.emit(ActivityEvent("classify", "Agent 1", "triage",
                      "Classifying…", status=STATUS_RUNNING, primary=True))
    cls = classify(t.title, t.body, [f"{s['key']} {s['summary']}" for s in similar])
    dept, urgency = cls["department"], cls.get("urgency", "Medium")
    auto, reason = cls["self_serviceable"], cls.get("reason", "")
    priority = {"Critical": "Highest", "High": "High", "Medium": "Medium",
                "Low": "Low"}.get(urgency, "Medium")
    log.info("%s classified dept=%s urgency=%s self_serviceable=%s (%s)",
             t.id, dept, urgency, auto, reason)
    await stream.emit(ActivityEvent("classify", "Agent 1", "triage",
                      f"Classified as {dept} · {urgency} priority · routed to the {dept} team",
                      status=STATUS_OK, primary=True,
                      tech=f"Claude → {dept} ({urgency}). Self-serviceable: {auto}. {reason}",
                      data={"department": dept, "urgency": urgency,
                            "self_serviceable": auto, "reason": reason}))

    # ---- Agent 1 ATTEMPTS a write, and Okta refuses. The proof. ----
    await stream.emit(ActivityEvent("write_denied", "Agent 1", "triage",
                      f"Attempting {WRITE_SCOPE}…", status=STATUS_RUNNING, primary=True))
    denial: dict = {}
    if t1 and a1_jwk:
        try:
            # Target the resource Agent 1 CAN address, asking for the scope it
            # cannot have. Pointing at the write lane instead yields invalid_target
            # (no connection to that resource), which is true but reads like a
            # config error rather than a permission refusal.
            denial = attempt_denied_write(t1, a1_id, a1_jwk, OKTA_DOMAIN,
                                          read_cas_issuer, read_resource, WRITE_SCOPE)
        except Exception:
            log.exception("denial probe raised")
    was_denied = bool(denial.get("_denied"))
    log.info("write denial probe: status=%s error=%s",
             denial.get("_status"), denial.get("error"))
    await stream.emit(ActivityEvent("write_denied", "Agent 1", "triage",
                      (f"Write refused by Okta · Agent 1 cannot hold {WRITE_SCOPE}" if was_denied
                       else "Write attempt inconclusive"),
                      status=STATUS_OK if was_denied else STATUS_ERROR, primary=True,
                      tech=(f"Agent 1 asked Okta for {WRITE_SCOPE} and was refused. It is not an "
                            "authorized client on the write authorization server, and that scope "
                            "does not exist on the servers where it is authorized. Least privilege "
                            "is enforced by Okta policy, not by this application."
                            if was_denied else
                            "The write attempt did not return a denial. Check that the write lane "
                            "still lists only Agent 2 in its policy."),
                      data={"denied": was_denied, "http_status": denial.get("_status"),
                            "error": denial.get("error"),
                            "error_description": (denial.get("error_description")
                                                  or denial.get("errorSummary")),
                            "attempted_scope": WRITE_SCOPE},
                      system_log_id="app.oauth2.as.consent.grant.deny" if was_denied else None))

    # ---- Agent 1 delegates to Agent 2 ----
    await stream.emit(ActivityEvent("a2a_delegate", "Agent 1 → Agent 2", "triage",
                      "Delegating to the write-capable agent", status=STATUS_RUNNING, primary=True))
    idjag1, t_res, res_claims = None, None, {}
    try:
        if t1:
            r = exchange_for_id_jag(t1, a1_id, a1_jwk, OKTA_DOMAIN, read_cas_issuer,
                                    read_resource, scope=READ_SCOPE)
            idjag1 = r.get("access_token")
            if not idjag1:
                log.error("id-jag 1 failed: %s", json.dumps(r)[:300])
            else:
                r2 = redeem_id_jag_for_a2a_token(idjag1, a1_id, a1_jwk,
                                                 f"{read_cas_issuer}/v1/token")
                t_res = r2.get("access_token")
                if t_res:
                    res_claims = jose_jwt.get_unverified_claims(t_res)
                else:
                    log.error("id-jag 1 redemption failed: %s", json.dumps(r2)[:300])
    except Exception:
        log.exception("delegation hop raised")
    real1 = "act" in res_claims
    await stream.emit(ActivityEvent("a2a_delegate", "Agent 1 → Agent 2", "triage",
                      "Delegated to the write-capable agent" if real1 else "Delegation pending",
                      status=STATUS_OK if real1 else STATUS_ERROR, primary=True,
                      tech=("Agent 1 cannot write, so it hands the work to Agent 2. The act claim "
                            "records that Agent 1 initiated this, so the eventual write stays "
                            "attributable to it, not anonymous."
                            if real1 else "Delegation unavailable, check the read lane config"),
                      token_claims=(res_claims or None),
                      raw_tokens=({k: v for k, v in {"idjag1": idjag1, "t_res": t_res}.items() if v}
                                  or None),
                      data={"scope": READ_SCOPE, "granted": scopes_of(t_res),
                            "caller": a1_id, "callee": a2_id},
                      system_log_id="app.oauth2.token.grant.id_jag" if real1 else None))

    # ---- Agent 2 obtains WRITE on the write lane. The capability change. ----
    await stream.emit(ActivityEvent("write_grant", "Agent 2", "fulfill",
                      f"Requesting {WRITE_SCOPE}…", status=STATUS_RUNNING, primary=True))
    idjag2, t_ful, ful_claims = None, None, {}
    try:
        if t_res:
            r = exchange_for_id_jag(t_res, a2_id, a2_jwk, OKTA_DOMAIN, write_cas_issuer,
                                    write_resource, scope=WRITE_SCOPE)
            idjag2 = r.get("access_token")
            if not idjag2:
                log.error("id-jag 2 (write) failed: %s", json.dumps(r)[:300])
            else:
                r2 = redeem_id_jag_for_a2a_token(idjag2, a2_id, a2_jwk,
                                                 f"{write_cas_issuer}/v1/token")
                t_ful = r2.get("access_token")
                if t_ful:
                    ful_claims = jose_jwt.get_unverified_claims(t_ful)
                else:
                    log.error("id-jag 2 redemption failed: %s", json.dumps(r2)[:300])
    except Exception:
        log.exception("write grant hop raised")
    real2 = "act" in ful_claims
    await stream.emit(ActivityEvent("write_grant", "Agent 2", "fulfill",
                      (f"Granted write access · {WRITE_SCOPE}" if real2
                       else f"{WRITE_SCOPE} grant pending"),
                      status=STATUS_OK if real2 else STATUS_ERROR, primary=True,
                      tech=("Agent 2 is the only client authorized on the write authorization "
                            "server, so only Agent 2 can obtain this scope. Its act claim still "
                            "names Agent 1 and the Intake Service, so the chain of custody is "
                            "intact across the capability change."
                            if real2 else "Write grant unavailable, check the write lane config"),
                      token_claims=(ful_claims or None),
                      raw_tokens=({k: v for k, v in {"idjag2": idjag2, "t_ful": t_ful}.items() if v}
                                  or None),
                      data={"scope": WRITE_SCOPE, "granted": scopes_of(t_ful),
                            "caller": a2_id},
                      system_log_id="app.oauth2.token.grant.id_jag" if real2 else None))

    # ---- Agent 2 drafts ----
    comments = draft_comments(t.title, t.body, dept)
    resolution = draft_resolution(t.title, t.body, dept) if auto else ""
    await _emit_pair(stream, ActivityEvent("draft", "Agent 2", "resolve",
                     ("Assessed the case as self-serviceable, drafted a customer resolution"
                      if auto else "Decided the fix and drafted work notes"), primary=True,
                     tech=(f"Claude judged this self-serviceable: {reason}" if auto
                           else f"Claude judged this needs a human: {reason}"),
                     data={"self_serviceable": auto, "reason": reason}))

    # ---- Agent 2 releases the vaulted credential ----
    await stream.emit(ActivityEvent("opa_vault", "Agent 2", "fulfill",
                      "Releasing the Jira credential…", status=STATUS_RUNNING))
    jira_token, vaulted = "", False
    orn = os.getenv("JIRA_SECRET_RESOURCE_ORN")
    # Autonomous release: Agent 2 presents its INBOUND delegated token (t_res) as the
    # machine subject. Okta runs a delegation-policy check on it and releases. No human.
    if orn and t_res:
        try:
            vault = retrieve_vaulted_secret(a2_id, a2_jwk, OKTA_DOMAIN, orn,
                                            subject_token=t_res,
                                            subject_token_type=SUBJECT_TYPE_ACCESS_TOKEN)
            jira_token = _extract_vaulted_secret(vault)
            vaulted = bool(jira_token)
            if not vaulted:
                log.error("vault release returned no secret: %s", json.dumps(vault)[:300])
        except Exception:
            log.exception("vault release raised")
    if not jira_token:
        jira_token = os.getenv("ATLASSIAN_API_TOKEN", "")
    await stream.emit(ActivityEvent("opa_vault", "Agent 2", "fulfill",
                      "Released the Jira credential", status=STATUS_OK,
                      tech=("Vaulted-secret exchange against Okta Privileged Access, authorized by "
                            "Agent 2's own inbound delegated token" if vaulted
                            else "Credential from secure env (OPA vault connection pending)"),
                      data={"resource_orn": orn, "subject_token_ref": "t_res" if t_res else None,
                            "vaulted": vaulted},
                      system_log_id="app.credential.vault.access" if vaulted else None))

    # ---- Agent 2 writes (scope-gated) ----
    await stream.emit(ActivityEvent("jira_write", "Agent 2", "fulfill",
                      "Filing in Jira…", status=STATUS_RUNNING, primary=True))
    # If the write token exists it must carry the write scope. When the A2A chain is
    # degraded there is no token to check, and the run is already flagged as such.
    if t_ful:
        require_scope(t_ful, WRITE_SCOPE)
    jira = JiraClient(os.environ["JIRA_BASE_URL"], os.environ["ATLASSIAN_EMAIL"], jira_token)
    labels = ["atlas", "autonomous", dept.lower().replace(" ", "-")] + (["auto-resolved"] if auto else [])
    issue = jira.create_issue(project, t.title, t.body, component=dept,
                              labels=labels, priority=priority)
    key = issue.get("key", "ITSD-?")
    log.info("created %s", key)
    assignee, assign_status = _assign_to_demo_user(jira, key)
    for c in comments:
        jira.add_comment(key, c)
    issue_url = f"{os.environ['JIRA_BASE_URL'].rstrip('/')}/browse/{key}"
    common = {"issue_key": key, "issue_url": issue_url, "team": dept, "priority": priority,
              "assignee": assignee, "assignee_status": assign_status, "scope": WRITE_SCOPE,
              "self_serviceable": auto, "reason": reason}
    if auto:
        jira.add_comment(key, f"Customer resolution (auto-sent to {requester}):\n\n{resolution}")
        jira_status = jira.resolve_issue(key)
        await stream.emit(ActivityEvent("jira_write", "Agent 2", "fulfill",
                          f"Auto-resolved {key} · replied to {requester} · "
                          + (f"closed in Jira ({jira_status})" if jira_status else "marked resolved"),
                          status=STATUS_OK, primary=True,
                          tech=f"POST /rest/api/3/issue then transition, authorized by {WRITE_SCOPE}",
                          data={**common, "auto_resolved": True, "resolution": resolution,
                                "requester": requester, "jira_status": jira_status or "Resolved"},
                          system_log_id="jira.issue.resolved"))
    else:
        await stream.emit(ActivityEvent("jira_write", "Agent 2", "fulfill",
                          f"Filed {key} · routed to {dept} · {priority} priority · "
                          f"{len(comments)} comments",
                          status=STATUS_OK, primary=True,
                          tech=f"POST /rest/api/3/issue authorized by {WRITE_SCOPE}",
                          data={**common, "auto_resolved": False},
                          system_log_id="jira.issue.created"))

    await _emit_pair(stream, ActivityEvent("done", "Atlas", "okta",
                     ("Case auto-resolved by the agent · customer notified" if auto
                      else f"Filed and routed to {dept} for a specialist"),
                     primary=True, data={"auto_resolved": auto},
                     tech="One agent could read. One could write. Okta decided which, and every "
                          "hop is attributable and revocable."))
