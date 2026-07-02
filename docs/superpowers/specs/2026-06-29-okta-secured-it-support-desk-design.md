# Okta-Secured IT Support Desk, Design Spec

**Date:** 2026-06-29
**Owner:** Johnathan Campos
**Status:** Draft for review
**Purpose:** A customer-facing demo that makes two distinct agent access patterns concrete and un-conflated, so customers can see *exactly* how Okta secures an AI agent with a full, verifiable chain of custody.

---

## 1. Why this exists

Customers conflate two fundamentally different ways an AI agent reaches a downstream system (Jira):

1. **Autonomous / headless**, no human in the loop. The agent acts on its own machine authority.
2. **Interactive / on-behalf-of-user**, a human is present and the agent borrows their permissions.

They map to different Okta mechanisms, and customers routinely pick the wrong one or assume one tool covers both. This demo runs **one workflow (file an IT ticket into Jira) through both patterns, side by side**, with the Okta identity and chain of custody surfaced visually at every hop.

Reference quality bar: `courtedge-ai-demo` (Next.js 14 frontend on Vercel, FastAPI backend on Render, live token-exchange visualization).

---

## 2. The two halves

### Half 1, Autonomous: agent-to-agent (A2A) + OPA-vaulted credential, no human

Click **Generate Ticket** → a fake inbound ticket appears ("Can't connect to VPN from home"), simulating arrival from an external ticketing system over an API. A real two-agent, fully governed pipeline then runs with **zero human consent**:

```
External ticket (faked inbound API)
      │
      ▼
[ JC IT Intake Agent ]   ← Okta workload identity (wlp…)
   • Claude API triages: department + urgency
      │   Okta A2A token exchange (machine context)
      │   → issued token carries act claim  ← CHAIN OF CUSTODY
      ▼
[ JCDevOpsAgent ]        ← Okta workload identity + A2A resource (dual citizen)
   • Claude API drafts resolution comments
   • Retrieves Jira API credential from Okta OPA vault (nothing in code)
      │
      ▼
   Jira  ← issue created, routed to dept (component), labeled, commented
```

**Chain of custody (real, not mocked):** external trigger → Intake Agent identity → **A2A delegation with `act` claim** → JCDevOpsAgent identity → **OPA-vaulted credential retrieval** → Jira write. Every hop emits an Okta System Log event; the UI shows the receipts.

### Half 2, Interactive: STS brokered consent via the MCP Bridge, human present

Plain **Claude Code**, connected through the existing `oktaforai-poc` MCP Bridge to a Jira MCP server. The user runs a routine ("tag all my open tickets `reviewed-2026`"). Claude triggers **STS brokered consent** (handled by the Bridge, Claude can't do the exchange itself); the user consents once; Claude acts **as the user**. The app shows a companion panel visualizing the STS flow plus the Okta System Log consent + brokered-token events.

### The payoff (dot-connector shown in the UI)

| | Autonomous (Half 1) | Interactive (Half 2) |
|---|---|---|
| Who anchors access | A machine delegation chain | A consenting human |
| Okta mechanism | **A2A** token exchange + **OPA-vaulted** credential | **STS brokered consent** (via MCP Bridge) |
| Credential in agent code | None (vaulted in Okta) | None (brokered by Okta) |
| Chain of custody | `act` claim across agents | `sub` (user) + `act` (Claude) |
| Token lifetime | Short-lived A2A token; vaulted key static (Okta-governed) | Short-lived brokered token; consent 90-day |
| When to use | Headless / scheduled / no user present | Routines a human drives live |

---

## 3. Architecture & components

### 3.1 Deployables

| Component | Tech | Host | Responsibility |
|---|---|---|---|
| **Frontend** | Next.js 14 + React | Vercel | Ticket desk UI, animated pipeline, Chain-of-Custody panel, System Log receipts, Half-1/Half-2 tabs |
| **Orchestrator backend** | FastAPI (Python) | Render | Intake Agent + JCDevOpsAgent logic, Claude API calls, Okta A2A + OPA token exchanges, Jira REST writes, SSE/stream of pipeline events to the UI |
| **Jira MCP server** | Python (MCP) | Render | Half 2 only: small MCP server (tools: `list_my_issues`, `add_label`) fronted by the Bridge; receives the STS-brokered Jira token and calls Jira |

### 3.2 Okta objects (oktaforai tenant)

| Object | Type | For |
|---|---|---|
| **JC IT Intake Agent** | Workload principal (client) + JWK | Half 1 upstream agent |
| **JCDevOpsAgent** | Workload principal (client + A2A resource / a2a-server) + JWK | Half 1 downstream agent |
| **Delegation-link** | Intake → JCDevOps | Half 1: permits the A2A handoff (`allow_delegate`) |
| **A2A CAS** | Custom AS protecting the JCDevOps a2a-server | Half 1: issues the A2A token with scopes (`ticket:file`) |
| **OPA Secret** + **Secret connection** (`STS_VAULT_SECRET`) on JCDevOpsAgent | Vaulted Jira API token | Half 1: JCDevOps retrieves Jira creds JIT |
| **Application connection** (`STS_ACCESS_TOKEN`) on the Claude agent | Brokers Atlassian OAuth 3LO | Half 2: STS brokered consent |
| **Bridge resource + Claude client registration** | MCP Bridge config | Half 2: Claude → Bridge → Jira MCP server |

### 3.3 Atlassian objects (you provision)

- Free Atlassian Cloud (Jira) site.
- Project (e.g. key `ITSD`) with components as "departments": `Networking`, `Hardware`, `Access Management`, `Software`.
- **API token** (email + token) → vaulted in Okta OPA (Half 1). Max 365-day expiry (Atlassian policy).
- **OAuth 2.0 (3LO) app** (client ID/secret, scopes, callback = Okta STS callback) → Okta Application connection (Half 2).

---

## 4. Data flow detail

### 4.1 Half 1 (autonomous), step by step

1. UI `POST /api/tickets/generate` → backend fabricates a ticket (id, title, body, reporter) from a seed set.
2. **Intake Agent** authenticates to Okta (private_key_jwt, its own JWK), obtains its access token. Calls Claude API to classify: `{ department, urgency, summary }`.
3. **A2A token exchange (machine context):** Intake Agent presents its access token as `subject_token` to the A2A CAS, `resource` = JCDevOpsAgent's a2a-server, scope `ticket:file`. Okta validates the delegation-link and issues a scoped access token whose `act` claim records Intake Agent. *(This exact exchange is the first thing verified, see §6.)*
4. **JCDevOpsAgent** receives the call + A2A token (validates `aud`/`act`). Calls Claude API to draft 1–2 resolution comments.
5. **OPA vault retrieval:** JCDevOpsAgent does an STS vaulted-secret exchange (its JWK client assertion, `resource` = the Secret connection ORN) → Okta releases the Jira API token. Nothing sensitive in Render code/env.
6. **Jira write:** `POST /rest/api/3/issue` (project `ITSD`, component = department), then add labels + the LLM comments via REST.
7. Backend streams a pipeline event after each hop (identity, token claims, System Log event id) over SSE; the UI's Chain-of-Custody panel lights up.

### 4.2 Half 2 (interactive), step by step

1. User runs `claude mcp add --transport http okta-gateway <bridge-url>` (one-time) and `/mcp` authenticates (SSO to Okta).
2. User: "tag all my open tickets `reviewed-2026`." Claude calls the Bridge's `list_my_issues` then `add_label` tools.
3. Bridge performs **STS brokered consent**: first call returns `interaction_required` → user consents to Jira once → Okta stores the Atlassian refresh token → Bridge brokers a short-lived Jira token and forwards it to the Jira MCP server.
4. Jira MCP server calls Jira REST with the brokered token, scoped to the user's own issues.
5. App companion panel reads the Okta System Log (`app.oauth2.as.token.grant.access_token`, STS consent/brokered events) and visualizes the consent + on-behalf-of-user token.

---

## 5. UI design

IT-helpdesk aesthetic, polished, dark/light Okta-brand palette.

- **Left rail:** Ticket intake. `Generate Ticket` button; the fabricated ticket card (reporter, title, body).
- **Center:** Animated agent pipeline. Nodes: `Inbound API → JC IT Intake Agent → (A2A handoff) → JCDevOpsAgent → Jira`. Each node animates as it executes; the A2A edge highlights the `act`-claim handoff.
- **Right rail, Chain of Custody (the centerpiece):** ordered receipts:
  1. ✓ Ticket received (external API)
  2. ✓ JC IT Intake Agent authenticated to Okta (wlp…), expandable token
  3. ✓ A2A token exchange, expandable JWT showing `sub` + `act` chain
  4. ✓ JCDevOpsAgent retrieved vaulted Jira credential from Okta OPA
  5. ✓ LLM routed → **Networking**
  6. ✓ Posted to Jira as machine identity + labeled, link to the Jira issue
  - Each receipt links to its Okta **System Log event id**.
- **Tab switch → "Claude + Bridge (STS)":** the Half-2 companion view, STS flow diagram, consent step, and live System Log of the brokered-token events; instructions to run the routine in Claude Code.
- Every element labeled with the Okta concept (A2A, `act` claim, OPA vault, STS consent) so customers connect the dots live.

---

## 6. Honesty checkpoint (first build milestone)

A2A is confirmed live in the tenant (multiple a2a-server resources + delegation-links exist). **The one thing to verify before building the UI around it: the machine-context A2A token exchange** (subject = the Intake Agent's own token, no user). Milestone 0 is a backend spike that performs steps 4.1.2–4.1.3 and prints the issued token's `act` claim. If machine-context isn't fully available, we surface it immediately and adjust to the strongest honest representation (e.g., service-client subject, or document the `act` layer precisely), rather than fake the chain. No customer-facing claim outruns what the tenant actually does.

---

## 7. Security & secrets

- No Jira credential in code or git. Half 1: vaulted in Okta OPA, retrieved JIT. Half 2: brokered by Okta, never held by the agent.
- Claude API key + agent JWKs: Render env vars only, never committed.
- Agent private keys generated, public JWK registered to Okta; private key stored in Render env (encrypted at rest by Render).
- `.gitignore` covers `.env*`, keys, tokens.

---

## 8. Out of scope (YAGNI)

- Real external ticketing integration (we fake the inbound API, that's the point).
- Multi-tenant / multi-user management UI.
- A2A self-context (roadmap), we use machine context, and *name* self-context as the next step.
- Production hardening, autoscaling, persistence beyond what the demo needs (in-memory/SSE is fine).

---

## 9. Build phases (high level; detailed plan via writing-plans)

0. **Spike:** verify A2A machine-context token exchange in-tenant (§6).
1. Okta config: create both agents + JWKs, A2A resource + CAS + delegation-link, OPA Secret connection.
2. Backend: Intake + JCDevOps orchestration, Claude API, A2A + OPA exchanges, Jira writes, SSE event stream.
3. Frontend: desk UI + animated pipeline + Chain-of-Custody panel.
4. Half 2: Jira MCP server + Bridge resource + Application (STS) connection + Claude registration; companion panel.
5. Deploy (Vercel + Render), end-to-end run, polish.

---

## 10. Open assumptions

- Project name / repo: `atlas-desk` (adjustable).
- App display name: "Okta-Secured IT Support Desk" (adjustable).
- Claude-side agent: new registration or reuse existing `Claude Code Agent`; decided at Phase 4.
- Jira "department" modeled as a **component**; tags as **labels**.
