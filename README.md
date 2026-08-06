# Atlas Service Desk

**Two AI agents work an IT ticket. One can read. One can write. Okta decides which, and refuses when the read-only agent asks for more.**

Atlas Service Desk is a working demo of agent-to-agent delegation secured end to end by Okta identity. It triages, resolves, and files real Jira issues with no human in the loop, and it makes the authorization visible at every step: each agent's capability is a real OAuth scope in a real Okta-issued token, and the moment an agent over-reaches, Okta says no.

It exists to answer one question concretely: **when an AI agent acts, and hands work to another AI agent, who is accountable, what were they allowed to do, and can you prove it?**

## The thing worth looking at

Most agent demos show that Agent A can call Agent B. That is easy, and it proves very little. The interesting question is what each agent is *not* allowed to do.

So the demo has **two buttons**, and they tell two different stories.

**Simulate inbound ticket.** The work gets done. Agent 1 reads, classifies, and delegates to an agent that is allowed to write. The ticket is filed. No refusal appears anywhere, because nothing was refused.

**Simulate policy violation.** Agent 1 tries to write the ticket itself instead of delegating. Okta refuses:

```
Agent 1 asks Okta for ticket.write
  -> HTTP 400  invalid_scope
     "The following scopes are not allowed for this request: [ticket.write]."
```

And then the run **stops**. No delegation, no write token, no vaulted credential, nothing filed in Jira. On the diagram, Agent 2 and Jira stay dark. That darkness is the evidence.

That second path is the one worth watching, because the refusal has a consequence. A denial emitted on every run, including the successful ones, is decoration. A denial that only appears when an agent over-reaches, and that visibly prevents the write, is enforcement you can reproduce with an HTTP status code.

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

## The two paths

```
                inbound
                  |
       Agent 1 granted ticket.read
                  |
    Agent 1 reads Jira for duplicates      (a real GET, scope-gated)
                  |
    Claude classifies + judges self-serviceability
                  |
        +---------+----------+
        |                    |
     NORMAL              VIOLATION
        |                    |
  delegates to Agent 2   asks Okta for ticket.write
        |                    |
  Agent 2 gets           Okta REFUSES
  ticket.write                |
        |               run stops.
  vault releases        nothing written.
  the credential
        |
  Agent 2 writes to Jira
```

The shared prefix is identical, which is what makes the comparison legible: the same agent, the same ticket, the same read authority. The only difference is whether it delegates or over-reaches.

Whether a ticket auto-resolves is **Claude's judgment, not a coin flip**. A Slack audio problem gets fixed with self-service instructions and closed. A laptop that will not power on gets routed to a human, because no amount of instructions will fix hardware. The model is asked to be honest about the difference, and to default to routing when unsure.

## What Okta provides

- **Identity.** Each agent is a first-class workload principal with its own key pair, owner, and lifecycle. Not a shared API key copy-pasted into two places.
- **Authorization.** Capability is a scope, granted by policy per authorization server. Changing what an agent may do is a policy edit, not a code deploy.
- **Runtime.** The one credential that reaches production (a Jira API token) is vaulted in Okta Privileged Access and released just in time, in exchange for the agent's own delegated authority. Nothing static lives in agent code.
- **Governance.** Every hop, including the refused one, is a real event in the Okta System Log attributable to a named identity. Deactivate an agent and the next hand-off provably fails.

See [docs/okta-security-value.md](docs/okta-security-value.md) for the verified-live evidence behind each of these four bullets.

## Documentation

- **[docs/WHY-THIS-MATTERS.md](docs/WHY-THIS-MATTERS.md)** start here if you are not going to build it. What breaks without this, in plain terms.
- **[docs/okta-security-value.md](docs/okta-security-value.md)** the evidence layer: what Okta mechanism backs each claim above, what this repo shows against a live tenant, and what failure mode is structurally closed.
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

### Light and dark

The UI follows the operating system preference, with an explicit override in the sidebar (match system / light / dark). A stored choice is applied to `<html>` by an inline script before first paint, so there is no flash of the wrong palette on load.

Every colour is a CSS variable holding an `R G B` triple, composed by Tailwind as `rgb(var(--x) / <alpha-value>)`, which is what keeps the opacity modifiers used throughout (`bg-ok/10`, `border-bad/40`) working across both themes. The two SVG diagrams compute colours in JavaScript rather than CSS, so they read the resolved theme from `lib/theme.ts`. Their light palette is not a lightened copy of the dark one: status colour in those diagrams is information (idle vs running vs ok vs refused is how you read what happened), so each value was chosen to hold the same relative meaning against a white ground.

To run fully live against your own tenant, see the environment table in [docs/OKTA_SETUP.md](docs/OKTA_SETUP.md).

## Tests

```bash
# backend: pure logic (scope enforcement, the auto-resolve safety default,
# the credential expiry window, vaulted-secret parsing)
cd apps/orchestrator
./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/python -m pytest tests/ -q

# frontend: chain assembly and flow-state derivation
cd apps/web && npm test

# end to end against a live deployment: are the tokens really signed, do the
# scopes really differ per hop, does the act chain really nest, does Okta really
# refuse the write
python3 scripts/verify_live.py [orchestrator-url]
```

The unit suites cover the properties where a silent regression would undermine
the demo's integrity rather than merely break it: that a read-only token can
never satisfy a write, that anything other than an explicit boolean `true` routes
a ticket to a human instead of auto-closing it, and that an expired credential is
never published. `verify_live.py` exits non-zero on failure, so it can gate a
deploy.

## Honest limitations

This is a demo built to prove an identity pattern, not a hardened production service.

- **Two agents, not three.** Earlier versions of this demo narrated three agents while using two real Okta identities. That gap is now closed by describing what actually exists: two workload principals, split by capability. A third workload principal still exists in the reference tenant and is unused.
- **One vaulted credential, not two.** The Jira credential released from the OPA vault is write-capable and belongs to Agent 2. Agent 1's read currently uses a configured environment credential rather than a separate read-only vaulted secret. The *authorization* boundary is real and enforced by Okta; the credential separation is not yet, and vaulting a second read-only secret is the clean follow-up.
- **The orchestrator does not re-verify signatures** on tokens Okta just handed it over TLS. It treats Okta as an already-authenticated first party. A standalone resource server should verify against the issuer's JWKS; `okta/scope_guard.py` says so where it matters.
- **The jwt.io link sends the token to Google Analytics.** Each token card links to `https://jwt.io/#token=<jwt>`, which pre-loads it for inspection. The token rides in the URL *fragment*, and it is tempting to conclude it therefore never leaves the browser. That is wrong, and it was measured rather than assumed: jwt.io runs Google Analytics, GA reports the full document location including the fragment as its `dl` parameter, and the live site issues two such POSTs per load, each carrying the whole JWT. Kept deliberately, for the same reasons the endpoint below is public and because these tokens are inert. **Do not pre-fill a token that actually authorizes something into a third-party page.**
- **Tokens are shown only to the browser that produced them.** `/tokens` reads the run out of `sessionStorage` and shows an empty state otherwise. There is no server-side retention and no endpoint that serves a previous run.

  This took two wrong turns to get right, and both are worth recording. Showing illustrative placeholder tokens on a cold landing made the page look static and fabricated. Replacing that with an endpoint that served the orchestrator's last run to anybody fixed the appearance but was worse: a visitor who had clicked nothing was handed real credentials and had no way to know whose they were. The credential belongs to the run that produced it and to the person who watched it happen, so now there is simply nothing to see until you run something.
- **`/api/run` is rate limited, not authenticated.** It costs real money and has real side effects, so it enforces a per-IP limit and a CORS origin allowlist. Neither is authentication. Do not expose an endpoint shaped like this without auth in a context where abuse matters.
- **If the vault path is not configured** the app falls back to an environment credential rather than failing closed, and the UI narrates the degraded path differently and emits no System Log id for an event that did not happen. It never fabricates a vault event. See [the honesty rule](docs/ARCHITECTURE.md#honesty-by-design).
