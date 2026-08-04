# Atlas Service Desk

**Two AI agents work an IT ticket. One can read. One can write. Okta decides which, and refuses when the read-only agent asks for more.**

Atlas Service Desk is a working demo of agent-to-agent delegation secured end to end by Okta identity. It triages, resolves, and files real Jira issues with no human in the loop, and it makes the authorization visible at every step: each agent's capability is a real OAuth scope in a real Okta-issued token, and the moment an agent over-reaches, Okta says no.

It exists to answer one question concretely: **when an AI agent acts, and hands work to another AI agent, who is accountable, what were they allowed to do, and can you prove it?**

## The thing worth looking at

Most agent demos show that Agent A can call Agent B. That is easy, and it proves very little. The interesting question is what each agent is *not* allowed to do.

So this demo includes a step that **fails on purpose**:

```
Agent 1 asks Okta for ticket.write
  -> HTTP 401  access_denied
     "Policy evaluation failed for this request, please check the policy configurations."
```

That is a real response from a real Okta tenant, surfaced verbatim in the UI, copyable. Least privilege here is not a sentence in a README. It is an HTTP status code you can reproduce.

## Live demo

**https://atlas-desk.vercel.app**

Click "Simulate inbound ticket" and watch it run. Then open **Chain of custody** and copy any token into [jwt.io](https://jwt.io). Check the `scp` claim against what the page says that agent was allowed to do, and the `act` claim for who acted on whose authority.

Nothing in this app asks you to trust it. Every credential it issues is exportable and independently verifiable against Okta's published signing keys.

## How the CRUD boundary works

Two Okta workload principals, three authorization servers, two scopes.

| Lane | What it is | Scope | Who is authorized |
|---|---|---|---|
| Read | Agent 1's own authorization server | `ticket.read` | Intake Service, Agent 1 |
| Delegation | The hand-off boundary | `ticket.read` | Intake Service, Agent 1 |
| **Write** | The privileged authorization server | `ticket.write` | **Agent 2 only** |

Agent 1 cannot obtain `ticket.write`, for two independent reasons:

1. **It is not an authorized client on the write authorization server.** Asking there returns `401 access_denied`.
2. **The write scope does not exist on the servers where Agent 1 *is* authorized.** Asking there returns `400 invalid_scope`.

And Okta does not down-scope a token-exchange request: an ungrantable scope fails the *whole* request rather than quietly issuing the grantable subset. There is no partial success to accidentally accept.

Agent 1 is not powerless, though. It can **delegate** to an agent that does have write access, and the resulting token's `act` claim records that Agent 1 initiated the request. So the write remains attributable to the agent that asked for it, even though that agent could never have performed it. That is the pattern worth stealing.

## The pipeline

```
inbound
  -> Agent 1 granted ticket.read
  -> Agent 1 reads Jira for duplicates          (a real GET, scope-gated)
  -> Claude classifies and judges self-serviceability
  -> Agent 1 attempts a write, Okta refuses     (the proof)
  -> Agent 1 delegates to Agent 2               (act chain begins)
  -> Agent 2 obtains ticket.write               (capability change)
  -> Agent 2 releases the Jira credential from the OPA vault
  -> Agent 2 writes to Jira
```

Whether a ticket auto-resolves is **Claude's judgment, not a coin flip**. A Slack audio problem gets fixed with self-service instructions and closed. A laptop that will not power on gets routed to a human, because no amount of instructions will fix hardware. The model is asked to be honest about the difference, and to default to routing when unsure.

## What Okta provides

- **Identity.** Each agent is a first-class workload principal with its own key pair, owner, and lifecycle. Not a shared API key copy-pasted into two places.
- **Authorization.** Capability is a scope, granted by policy per authorization server. Changing what an agent may do is a policy edit, not a code deploy.
- **Runtime.** The one credential that reaches production (a Jira API token) is vaulted in Okta Privileged Access and released just in time, in exchange for the agent's own delegated authority. Nothing static lives in agent code.
- **Governance.** Every hop, including the refused one, is a real event in the Okta System Log attributable to a named identity. Deactivate an agent and the next hand-off provably fails.

## Documentation

- **[docs/WHY-THIS-MATTERS.md](docs/WHY-THIS-MATTERS.md)** start here if you are not going to build it. What breaks without this, in plain terms.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** the technical walkthrough: exact token mechanics, the vaulted-secret release, and what this repo is honest about not doing yet.
- **[docs/OKTA_SETUP.md](docs/OKTA_SETUP.md)** a from-scratch build checklist for your own tenant, written generically with no tenant-specific values.
- **[DEPLOY.md](DEPLOY.md)** Render plus Vercel.

## Tech stack

| | |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind, D3, Framer Motion |
| Backend | FastAPI (Python), `python-jose` + `cryptography` for token signing |
| Identity | Okta workload principals, custom authorization servers, RFC 8693 token exchange, ID-JAG, Okta Privileged Access |
| AI | Claude (classification, self-serviceability judgment, resolution drafting) |
| Downstream | Jira Cloud REST v3 |

## Local development

```bash
# backend
cd apps/orchestrator
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m uvicorn main:app --port 8080

# frontend, in another shell
cd apps/web
npm install
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:8080 npm run dev
```

With no Okta or Jira credentials configured the orchestrator runs a **demo path**: the same event sequence and the same token *shapes*, on unsigned `alg=none` tokens whose signature segment literally reads `DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN`. `GET /healthz` reports which mode you are in and lists exactly which environment variables are missing.

The header pill reads Live only when the orchestrator itself reports live. It is not driven by whether a URL happens to be configured.

To run fully live against your own tenant, see the environment table in [docs/OKTA_SETUP.md](docs/OKTA_SETUP.md).

## Honest limitations

This is a demo built to prove an identity pattern, not a hardened production service.

- **Two agents, not three.** Earlier versions of this demo narrated three agents while using two real Okta identities. That gap is now closed by describing what actually exists: two workload principals, split by capability. A third workload principal still exists in the reference tenant and is unused.
- **One vaulted credential, not two.** The Jira credential released from the OPA vault is write-capable and belongs to Agent 2. Agent 1's read currently uses a configured environment credential rather than a separate read-only vaulted secret. The *authorization* boundary is real and enforced by Okta; the credential separation is not yet, and vaulting a second read-only secret is the clean follow-up.
- **The orchestrator does not re-verify signatures** on tokens Okta just handed it over TLS. It treats Okta as an already-authenticated first party. A standalone resource server should verify against the issuer's JWKS; `okta/scope_guard.py` says so where it matters.
- **The last run's tokens are served publicly, on purpose.** `GET /api/last-run` returns the most recent run's still-valid credentials, so the chain-of-custody page shows real tokens to anyone rather than only to the browser tab that happened to run the pipeline. Letting people verify the tokens elsewhere is the entire point of that page.

  Why this is acceptable *here*, in order of how much weight each argument carries:

  1. **Every onward use requires a private key we do not publish.** Exchanging one of these tokens for another, or releasing the vaulted Jira credential, requires the agent's `private_key_jwt` client assertion. The private JWKs live only in the orchestrator's environment. A token on its own does nothing.
  2. **No resource server can exist at these audiences.** They sit under `atlas.acme.example`, and `.example` is an IANA-reserved TLD (RFC 2606) that cannot be registered.
  3. **The exposure window equals the credential's own lifetime.** Expired tokens are filtered out of the response, so the endpoint is a live view rather than an accumulating archive. ID-JAGs last 5 minutes, access tokens 1 hour.
  4. **The payload carries no ticket content.** Only the credential-bearing steps are retained, and their data is limited to scope and principal ids. The duplicate-search results, which contain other people's real Jira ticket summaries, are deliberately excluded.

  The residual risk, stated plainly: if someone later built a real resource server at one of those audiences and trusted `aud` without further checks, a published token would be replayable within its lifetime. **Do not copy this pattern for tokens that actually grant access to something.**
- **`/api/run` is rate limited, not authenticated.** It costs real money and has real side effects, so it enforces a per-IP limit and a CORS origin allowlist. Neither is authentication. Do not expose an endpoint shaped like this without auth in a context where abuse matters.
- **If the vault path is not configured** the app falls back to an environment credential rather than failing closed, and the UI narrates the degraded path differently and emits no System Log id for an event that did not happen. It never fabricates a vault event. See [the honesty rule](docs/ARCHITECTURE.md#honesty-by-design).
