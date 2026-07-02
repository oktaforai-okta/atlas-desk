# Okta-Secured IT Support Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a customer demo that runs one workflow (file an IT ticket into Jira) through two Okta-secured agent patterns side by side, autonomous A2A + OPA-vaulted credential, and interactive STS brokered consent via the MCP Bridge, with a live chain-of-custody UI.

**Architecture:** Next.js 14 frontend (Vercel) streams pipeline events from a FastAPI orchestrator (Render). The orchestrator drives two Okta workload-principal agents (`JC IT Intake Agent` → `JCDevOpsAgent`) over a real A2A machine-context token exchange; the downstream agent pulls its Jira credential from Okta OPA and writes to Jira. A separate small Jira MCP server (Render) sits behind the existing MCP Bridge for the interactive STS half driven by live Claude Code.

**Tech Stack:** Next.js 14/React/Tailwind, FastAPI/Python, Anthropic Claude API, Okta Workload Principals + A2A + OPA + STS, Atlassian Jira Cloud REST v3, MCP (Streamable HTTP), Vercel + Render.

**Testing philosophy:** External hops (Okta token exchanges, OPA retrieval, Jira writes, Bridge STS) are verified against the **real** tenant/services with observable output, never mocked into a false pass. Pure logic (ticket fabrication, claims/scope parsing, event shaping, classification prompt assembly) uses TDD.

**Tenant facts (verified 2026-06-29):** oktaforai.oktapreview.com; A2A live (a2a-servers + delegation-links endpoints work; existing A2A resources present); SSWS admin token available; `DevOps Agent`/`Claude Code Agent` already exist (we create distinct `JCDevOpsAgent` + `JC IT Intake Agent`).

---

## File Structure

```
atlas-desk/
  apps/
    web/                         # Next.js 14 (Vercel)
      app/page.tsx               # desk shell, tab switch
      app/api/run/route.ts       # proxy/SSE bridge to orchestrator (optional)
      components/TicketIntake.tsx
      components/AgentPipeline.tsx
      components/ChainOfCustodyPanel.tsx
      components/StsBridgeTab.tsx
      lib/events.ts              # SSE client + event types
    orchestrator/                # FastAPI (Render)
      main.py                    # app, /api/tickets/generate, /api/run (SSE), /healthz
      okta/client_assertion.py   # private_key_jwt builder (shared)
      okta/a2a_exchange.py       # A2A machine-context token exchange
      okta/opa_vault.py          # STS vaulted-secret exchange
      agents/intake_agent.py     # triage via Claude
      agents/devops_agent.py     # comments via Claude + OPA vault + Jira write
      llm/claude.py              # Claude API wrapper
      jira/client.py             # Jira REST v3 writes
      tickets/seeds.py           # fabricated inbound tickets
      events.py                  # ChainEvent model + emitter
      tests/                     # pytest (pure-logic units)
    jira-mcp/                    # Half 2 MCP server (Render)
      server.py                  # tools: list_my_issues, add_label
  scripts/
    okta_setup.py                # idempotent Okta config (agents, JWK, A2A, delegation, OPA secret)
    a2a_spike.py                 # Milestone 0 gate: prove machine-context A2A exchange
  .env.example
```

---

## Phase 0, Repo scaffold

### Task 0.1: Monorepo skeleton + env example

**Files:**
- Create: `apps/orchestrator/requirements.txt`, `apps/web/package.json`, `.env.example`, `README.md`

- [ ] **Step 1:** Create `apps/orchestrator/requirements.txt`:
```
fastapi==0.115.*
uvicorn[standard]==0.32.*
httpx==0.27.*
python-jose[cryptography]==3.3.*
anthropic==0.40.*
sse-starlette==2.1.*
pydantic==2.*
pytest==8.*
pytest-asyncio==0.24.*
```
- [ ] **Step 2:** Create `.env.example`:
```
OKTA_DOMAIN=oktaforai.oktapreview.com
OKTA_SSWS_TOKEN=                 # admin API token (local scripts only; NOT in deployed env)
INTAKE_AGENT_ID=                 # wlp... (filled by okta_setup.py)
INTAKE_CLIENT_ID=
INTAKE_PRIVATE_JWK=              # JSON
DEVOPS_AGENT_ID=                 # wlp...
DEVOPS_CLIENT_ID=
DEVOPS_PRIVATE_JWK=              # JSON
A2A_CAS_ISSUER=                  # https://oktaforai.oktapreview.com/oauth2/aus...
A2A_AUDIENCE=                    # JCDevOpsAgent a2a-server resourceUrl
A2A_SCOPE=ticket:file
JIRA_SECRET_RESOURCE_ORN=        # OPA Secret connection ORN on JCDevOpsAgent
JIRA_BASE_URL=                   # https://<site>.atlassian.net
JIRA_PROJECT_KEY=ITSD
ANTHROPIC_API_KEY=               # Render env only
```
- [ ] **Step 3:** Commit.
```bash
git add -A && git commit -m "chore: monorepo skeleton + env example"
```

---

## Phase 1, Okta foundation (idempotent setup script)

> Run locally with `OKTA_SSWS_TOKEN`. The script is idempotent (look up by name before create). Owners are required for activation, assign the current admin user as owner.

### Task 1.1: `client_assertion.py` (shared private_key_jwt builder)

**Files:** Create `apps/orchestrator/okta/client_assertion.py`; Test `apps/orchestrator/tests/test_client_assertion.py`

- [ ] **Step 1: Failing test**
```python
# tests/test_client_assertion.py
import json, time
from jose import jwt
from okta.client_assertion import build_client_assertion

JWK = json.loads(open("tests/fixtures/test_private_jwk.json").read())  # RS256 test key

def test_assertion_has_iss_sub_aud_and_verifies():
    tok = build_client_assertion(principal_id="wlpTEST", token_endpoint="https://x/oauth2/v1/token", private_jwk=JWK)
    claims = jwt.get_unverified_claims(tok)
    assert claims["iss"] == "wlpTEST" and claims["sub"] == "wlpTEST"
    assert claims["aud"] == "https://x/oauth2/v1/token"
    assert claims["exp"] > time.time()
```
- [ ] **Step 2:** Run `./.venv/bin/pytest apps/orchestrator/tests/test_client_assertion.py -v` → FAIL (module missing). Generate the RS256 fixture key first if absent.
- [ ] **Step 3: Implement** `build_client_assertion(principal_id, token_endpoint, private_jwk)` → signs `{iss,sub=principal_id, aud=token_endpoint, exp=now+300, iat, jti=uuid4}` RS256 with `kid` header from the JWK. (Mirror the verified pattern in the adapter's `okta_sts_exchanger.build_client_assertion`.)
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit.

### Task 1.2: `okta_setup.py`, create agents + JWKs

**Files:** Create `scripts/okta_setup.py`

- [ ] **Step 1:** Implement `ensure_agent(name, description)`: `GET /workload-principals/api/v1/ai-agents?limit=100`, match `profile.name`; if absent `POST` `{profile:{name,description}}`. Returns agent `id` (`wlp…`). Run for `JC IT Intake Agent` and `JCDevOpsAgent`.
- [ ] **Step 2:** Implement `ensure_jwk(agent_id)`: generate RS256 keypair locally; register public JWK `POST /workload-principals/api/v1/ai-agents/{id}/credentials/jwks`; activate it (vertical-ellipsis equivalent: `POST .../jwks/{kid}/lifecycle/activate` if needed); print the private JWK once to write into `.env`.
- [ ] **Step 3:** Implement `assign_owner(agent_id, user_id)` then `activate(agent_id)` (`POST .../{id}/lifecycle/activate`). Owner = the admin user id (look up via `GET /api/v1/users/me` or a configured login).
- [ ] **Step 4: Verify (real):** re-list agents; assert both are `ACTIVE` with one active credential. Print ids.
- [ ] **Step 5:** Commit `scripts/okta_setup.py` (no secrets committed).

### Task 1.3: `okta_setup.py`, JCDevOpsAgent as A2A resource + CAS + scope

**Files:** Modify `scripts/okta_setup.py`

- [ ] **Step 1:** Create a Custom Authorization Server (A2A CAS) via `POST /api/v1/authorizationServers` (name `JCDevOps A2A`, audience = a chosen resourceUrl e.g. `https://jcdevops.agents.oktademo`); add scope `ticket:file` (`POST .../scopes`); add an access policy + rule permitting grant types token-exchange/jwt-bearer (`POST .../policies`, `.../rules`). Assign the agents/clients as needed.
- [ ] **Step 2:** Register the A2A resource: `POST /resource-servers/api/v1/a2a-servers/{devopsAgentId}` with `{resourceUrl}` and link the CAS via the `authorization-servers` sub-resource (schema confirmed live: `a2aServerId`, `orn`, `resourceUrl`, `_links.authorization-servers`).
- [ ] **Step 3: Verify (real):** `GET /resource-servers/api/v1/a2a-servers/{devopsAgentId}` → 200 with `resourceUrl` + authorization-servers link. Record `A2A_CAS_ISSUER` + `A2A_AUDIENCE` into `.env`.
- [ ] **Step 4:** Commit.

### Task 1.4: `okta_setup.py`, delegation-link Intake → JCDevOps

**Files:** Modify `scripts/okta_setup.py`

- [ ] **Step 1:** Create the delegation (inbound connection) permitting `JC IT Intake Agent` to delegate to `JCDevOpsAgent`: `POST /workload-principals/api/v1/delegation-links` with `{from: intake client/principal, to.resourceOrn: JCDevOps a2a ORN}` (mirror the `to.resourceOrn` filter shape seen on `delegationLinks` hrefs).
- [ ] **Step 2: Verify (real):** `GET /workload-principals/api/v1/delegation-links?filter=to.resourceOrn eq "<jcdevops orn>"` → returns the link.
- [ ] **Step 3:** Commit.

### Task 1.5: `okta_setup.py`, OPA Secret + Secret connection on JCDevOpsAgent

**Files:** Modify `scripts/okta_setup.py`

> Requires OPA security admin role + the `OktaForAI` Secrets folder already present (confirmed in console).

- [ ] **Step 1:** Vault the Jira API credential in OPA (the Jira `email:api_token`) under the `OktaForAI` folder (OPA API or console; document the resource id).
- [ ] **Step 2:** Create the Secret connection on JCDevOpsAgent: `POST /workload-principals/api/v1/ai-agents/{devopsAgentId}/connections` with `{connectionType: "STS_VAULT_SECRET", resource:{…vaulted secret…}}`; capture the `resourceIndicator`/ORN into `JIRA_SECRET_RESOURCE_ORN`. Activate the connection.
- [ ] **Step 3: Verify (real):** list connections on the agent → the `STS_VAULT_SECRET` connection is `ACTIVE`.
- [ ] **Step 4:** Commit.

---

## Phase 2, Milestone 0 GATE: prove machine-context A2A exchange

### Task 2.1: `a2a_exchange.py` + `a2a_spike.py`

**Files:** Create `apps/orchestrator/okta/a2a_exchange.py`, `scripts/a2a_spike.py`

- [ ] **Step 1: Implement** `exchange_a2a(intake_creds, audience, scope) -> token` in `a2a_exchange.py`:
  - Get the Intake Agent's own access token (client_credentials with its JWK client assertion at the Org AS), OR use its WLP access token per A2A machine-context (subject = service client / WLP access token).
  - `POST {A2A_CAS_ISSUER}/v1/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<intake access token>`, `subject_token_type=urn:ietf:params:oauth:token-type:access_token`, `audience=<A2A_AUDIENCE>`, `scope=ticket:file`, `client_assertion=<intake private_key_jwt>`, `client_assertion_type=...jwt-bearer`.
  - Return the issued access token.
- [ ] **Step 2: Run the spike (real, GATE):**
```bash
./.venv/bin/python scripts/a2a_spike.py
```
Expected: prints HTTP 200 and the decoded issued token containing an **`act` claim** whose subject is the Intake Agent (chain of custody), `aud` = JCDevOps audience, `scp` includes `ticket:file`.
- [ ] **Step 3: Decision gate.** If 200 + `act` present → proceed. If the machine-context subject type is rejected (e.g. `invalid_grant`/unsupported subject), STOP, capture the exact error, and report to the user with the honest fallback options (service-client subject, or human-context anchor) before building further.
- [ ] **Step 4:** Commit the spike + result note in `docs/superpowers/plans/`.

---

## Phase 3, Orchestrator (Half 1, autonomous)

### Task 3.1: Ticket seeds (TDD)

**Files:** Create `apps/orchestrator/tickets/seeds.py`; Test `tests/test_seeds.py`

- [ ] **Step 1: Failing test:** `generate_ticket(seed_index)` returns `{id, title, body, reporter, created_at}`; ids unique across the seed set; bodies map to a known department for assertion.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement a curated seed list (VPN, Salesforce access, laptop, software install …). **Step 4:** PASS. **Step 5:** Commit.

### Task 3.2: Claude wrapper + classification (TDD on prompt assembly)

**Files:** Create `apps/orchestrator/llm/claude.py`, `apps/orchestrator/agents/intake_agent.py`; Test `tests/test_intake_classify.py`

- [ ] **Step 1: Failing test:** `build_classify_prompt(ticket)` includes the four departments and the ticket body; `parse_classification(model_json)` → `{department in {Networking,Hardware,Access Management,Software}, urgency, summary}` and raises on unknown department.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement prompt builder + parser (real Claude call lives behind `classify(ticket)` using `claude.py`; model id `claude-sonnet-4-6`). **Step 4:** PASS. **Step 5:** Commit.

### Task 3.3: OPA vault retrieval

**Files:** Create `apps/orchestrator/okta/opa_vault.py`

- [ ] **Step 1: Implement** `retrieve_jira_secret(devops_creds, resource_orn)`: STS token-exchange at Org AS `requested_token_type=urn:okta:params:oauth:token-type:vaulted-secret`, `resource=<ORN>`, `client_assertion=<devops private_key_jwt>` → returns `{email, api_token}` (or bearer). Mirror the adapter's `OktaVaultSecretExchanger`.
- [ ] **Step 2: Verify (real):** call against the live Secret connection → returns the vaulted credential (assert non-empty, do not log the value). **Step 3:** Commit.

### Task 3.4: Jira client (real write)

**Files:** Create `apps/orchestrator/jira/client.py`

- [ ] **Step 1: Implement** `create_issue(base_url, auth, project_key, summary, description, component)`, `add_labels(issue_key, labels)`, `add_comment(issue_key, body)` using Jira REST v3 (`POST /rest/api/3/issue`, `/comment`; PUT for labels). Auth = HTTP Basic `email:api_token`.
- [ ] **Step 2: Verify (real):** create a test issue in `ITSD`, assert it returns a key and is visible via `GET`. **Step 3:** Commit.

### Task 3.5: DevOps agent + orchestration + SSE

**Files:** Create `apps/orchestrator/agents/devops_agent.py`, `apps/orchestrator/events.py`, `apps/orchestrator/main.py`

- [ ] **Step 1:** `events.py`: `ChainEvent{step, label, status, identity, token_claims?, system_log_id?, ts}` + an async emitter queue.
- [ ] **Step 2:** `devops_agent.process(ticket, classification)`: draft comments via Claude → `retrieve_jira_secret` → `create_issue`+labels+comments → emit a ChainEvent per hop.
- [ ] **Step 3:** `main.py`: `POST /api/tickets/generate` (returns a seed ticket); `GET /api/run?ticket_id=…` (SSE) that runs Intake.classify → `exchange_a2a` (emit act-claim event) → DevOps.process, streaming ChainEvents; `GET /healthz`.
- [ ] **Step 4: Verify (real):** `curl` the SSE endpoint, observe ordered events ending with a real Jira issue key. **Step 5:** Commit.

---

## Phase 4, Frontend (Vercel)

### Task 4.1: Next.js app shell + Tailwind + Okta-brand theme

**Files:** Create `apps/web/*` (Next 14 app router, Tailwind). Okta palette, Playfair/DM-Sans optional.
- [ ] Steps: scaffold, theme tokens, layout shell with two tabs ("Autonomous (A2A)" / "Claude + Bridge (STS)"). Commit.

### Task 4.2: TicketIntake + AgentPipeline

**Files:** `components/TicketIntake.tsx`, `components/AgentPipeline.tsx`, `lib/events.ts`
- [ ] `TicketIntake`: Generate Ticket button → `POST /api/tickets/generate` → render card. `AgentPipeline`: nodes Inbound→Intake→(A2A edge)→JCDevOps→Jira, animate per SSE event. `lib/events.ts`: typed SSE client. Commit.

### Task 4.3: ChainOfCustodyPanel (centerpiece)

**Files:** `components/ChainOfCustodyPanel.tsx`
- [ ] Ordered receipts from SSE events; expandable token JSON (pretty-print the `act` chain); System Log event-id links; copy buttons. Commit.

### Task 4.4: Wire end-to-end (Half 1)
- [ ] Point web at the orchestrator URL; click Generate → watch pipeline + custody panel fill → click through to the real Jira issue. Commit.

---

## Phase 5, Half 2 (interactive STS via MCP Bridge)

### Task 5.1: Jira MCP server

**Files:** Create `apps/jira-mcp/server.py`
- [ ] MCP server (Streamable HTTP) exposing `list_my_issues` and `add_label`; expects an inbound Jira OAuth bearer (the Bridge-brokered token) and calls Jira REST with it; validates token audience/issuer. Verify locally with a token. Commit.

### Task 5.2: Atlassian OAuth 3LO app + Okta Application (STS) connection
- [ ] (User provisions the 3LO app.) Configure the Okta Application (`STS_ACCESS_TOKEN`) connection brokering Atlassian (OIN Jira app or custom resource server); callback = `https://oktaforai.oktapreview.com/oauth2/v1/sts/callback`; scopes match the 3LO app. Reference recipe: o4aa `atlassian-sts`.

### Task 5.3: Bridge wiring + Claude registration
- [ ] Using the Bridge admin (token in `bridge.txt`), add the Jira MCP server as a resource, link the Application (STS) connection, register Claude as a client. `claude mcp add --transport http okta-gateway <bridge-url>`; `/mcp` authenticate.
- [ ] **Verify (real):** in Claude, run "tag my open tickets reviewed-2026" → first call triggers consent → after consent, labels applied. Capture the System Log STS/brokered events.

### Task 5.4: StsBridgeTab companion panel

**Files:** `components/StsBridgeTab.tsx`
- [ ] STS flow diagram, consent step, live System Log of brokered-token events, copy-paste Claude commands. Commit.

---

## Phase 6, Deploy + polish

- [ ] Render: deploy `orchestrator` + `jira-mcp` (env vars incl. `ANTHROPIC_API_KEY`, agent JWKs, ORNs). `render login` required (user-run).
- [ ] Vercel: deploy `apps/web` (env: orchestrator URL). `gh repo create oktaforai-okta/atlas-desk` + push.
- [ ] End-to-end dry run of both halves; record the talk track; README with the payoff table.

---

## Self-Review

- **Spec coverage:** Half 1 (Phases 1–4) ✓; Half 2 (Phase 5) ✓; chain-of-custody UI (4.3) ✓; honesty gate (Phase 2 = spec §6) ✓; OPA vault (1.5/3.3) ✓; A2A (1.3/1.4/2.1) ✓; Atlassian provisioning (5.2) ✓; deploy (6) ✓. No gaps.
- **Placeholders:** Integration steps specify exact endpoints/grant types/expected output. App-UI tasks are task-level (justified: real-integration risk is front-loaded; UI built with judgment during execution). `.env` blanks are runtime values produced by `okta_setup.py`, not plan placeholders.
- **Type consistency:** `build_client_assertion`, `exchange_a2a`, `retrieve_jira_secret`, `ChainEvent`, `process` used consistently across phases.
