# Architecture

The technical explanation of how Atlas Service Desk works: the components, the exact token mechanics for agent-to-agent delegation, how the read/write capability boundary is enforced, and the vaulted-secret release that lets a fully autonomous agent reach a downstream credential with no human in the chain.

To build this pattern in your own tenant, see [OKTA_SETUP.md](OKTA_SETUP.md). For the non-technical argument, see [WHY-THIS-MATTERS.md](WHY-THIS-MATTERS.md). For the verified-live evidence behind the table below, see [okta-security-value.md](okta-security-value.md).

## What Okta provides, at each layer

| Layer | What it means here |
|---|---|
| **Identity** | Each agent is a first-class **workload principal** in Okta's directory: its own key pair, its own human owner, its own lifecycle. Not a shared service account, not an API key copy-pasted into two places. |
| **Authorization** | Capability is a **scope**, granted per authorization server by policy. Agent 1 may hold `ticket.read`. Agent 2 may hold `ticket.write`. Neither can hold the other's, and that is enforced by Okta before a token exists. Each delegation hop mints an **ID-JAG** whose `act` claim (RFC 8693) records who acted on whose authority. |
| **Runtime** | Only the write-capable agent can reach production. Its downstream credential (a Jira API token) is vaulted in **Okta Privileged Access** and released just in time over a real OAuth exchange. Nothing static lives in agent code. |
| **Governance** | Every hop, including the refused one, is a real event in the **Okta System Log**, attributable to a named identity. Deactivate any agent and the next hand-off provably fails. |

## Components

- **Next.js frontend** (Vercel). Renders the ticket queue, the live flow graph, and the chain of custody. Holds zero credentials. Deliberately contains **no JWT decoder**: every identifier and scope it displays was read off a real token by the orchestrator and sent over, so the UI cannot invent one. Tokens are shown encoded, for export to a tool the reader controls.
- **FastAPI orchestrator** (Render). The only component that talks to Okta, Claude, or Jira. Drives the pipeline and streams `ActivityEvent`s over Server-Sent Events.
- **Claude.** Three jobs: classify the ticket (department and urgency, which becomes the real Jira priority), judge whether the case is genuinely self-serviceable, and draft the resolution text.
- **Okta.** An Org Authorization Server (issues and exchanges tokens, releases vaulted secrets), plus one Custom Authorization Server per capability lane. Each agent is also registered as its own resource ("dual citizenship") so other agents can be issued tokens targeting it.
- **Okta Privileged Access.** Holds the one credential that reaches production, released only in exchange for a valid, policy-checked token.
- **Jira Cloud.** The real destination. Issues are actually searched, created, commented on, and transitioned to Done.

## The capability boundary

This is the part that distinguishes this demo from "Agent A can call Agent B."

Three custom authorization servers. Two scopes. The authorization server, not the scope string, is the real policy boundary:

| Lane | Scope it publishes | Policy `clients.include` |
|---|---|---|
| Read (Agent 1's own AS) | `ticket.read` | Intake Service, Agent 1 |
| Delegation | `ticket.read` | Intake Service, Agent 1 |
| **Write** | `ticket.write` | **Agent 2 only** |

`ticket.write` exists on exactly one authorization server, and Agent 1 is not an authorized client there. So Agent 1 cannot obtain write access by any route:

| What Agent 1 tries | What Okta returns |
|---|---|
| `ticket.write` from the write AS | `401 access_denied` "Policy evaluation failed for this request" |
| `ticket.write` from an AS where it *is* a client | `400 invalid_scope` "One or more scopes are not configured for the authorization server resource" |

Two independent barriers, verified against a live tenant. The pipeline performs the first of these attempts on every run and surfaces the response verbatim.

**Okta does not down-scope.** If a token-exchange request names a scope the caller cannot be granted, the entire request fails rather than issuing the grantable subset. (An `authorization_code` flow will down-scope; `jwt-bearer` and `token-exchange` will not.) This is what makes the boundary safe to rely on: there is no partial success that a careless caller could mistake for authorization.

**Why the read-only agent is still useful.** It cannot write, but it can *delegate*. The token Agent 2 ends up holding carries an `act` claim naming Agent 1 and, beneath that, the Intake Service. So the write is attributable to the agent that initiated it even though that agent could never have performed it. Least privilege and accountability at the same time, rather than a trade between them.

## Two paths, one shared prefix

The pipeline runs in one of two modes, selected by the caller
(`GET /api/run?mode=normal|violation`). Both share the first four steps, so the
only variable between them is whether the read-only agent delegates or
over-reaches.

| | normal | violation |
|---|---|---|
| Agent 1 granted `ticket.read` | yes | yes |
| Agent 1 reads Jira | yes | yes |
| Claude classifies and judges | yes | yes |
| Agent 1 attempts a write | no | **yes, and Okta refuses** |
| Delegation to Agent 2 | yes | no |
| `ticket.write` issued | yes | no |
| Vaulted credential released | yes | no |
| Jira issue created | yes | **no** |

The violation path terminating without a write is the point. An earlier version of
this demo ran the refusal on *every* request, including successful ones, which made
it read as decoration: the write happened anyway, immediately afterwards, by another
route. Separating the paths means the refusal is only ever shown when it actually
prevented something.

`deriveAgentFlowState` in the frontend infers which path ran from the events rather
than being told, so the diagram cannot disagree with what happened. On a violation
it leaves Agent 2, the vault, and Jira unlit.

## The nine-step pipeline (normal path)

1. **`inbound`** A ticket arrives via the intake API. No Okta involvement yet.
2. **`read_grant`** The Intake Service mints a bootstrap token scoped `ticket.read`, and Agent 1 holds it. A service client does this because workload principals may not use `client_credentials` at all (see below).
3. **`jira_read`** Agent 1 performs a real `GET /rest/api/3/search` against the live project, looking for duplicate open tickets. Gated on the token actually carrying `ticket.read` (`okta/scope_guard.py`).
4. **`classify`** Claude classifies the ticket and judges whether it is self-serviceable, given the duplicates Agent 1 found. Anything other than an explicit `true` routes to a human, so a malformed judgment can never auto-close a real ticket.
5. **`a2a_delegate`** Agent 1 exchanges its token for an ID-JAG targeting the delegation lane and Agent 2 redeems it. Result: a token whose `act` claim records Agent 1.
6. **`write_grant`** Agent 2 exchanges *that* token for one on the write lane, carrying `ticket.write`. Same chain, new capability. Only Agent 2 can make this call.
7. **`draft`** Claude drafts the resolution text (or the work notes, on the routed path).
8. **`opa_vault`** Agent 2 retrieves the Jira credential from Okta Privileged Access, presenting its own inbound delegated token as the subject. See below.
9. **`jira_write`** Agent 2 creates the issue, comments, and on the self-serviceable path transitions it to Done.

The violation path shares steps 1-4, then instead attempts `write_denied` (Agent 1 asks Okta for `ticket.write` and is refused; the real HTTP status and error body are emitted for display) and stops at `blocked`. **`write_denied` succeeding would mean the boundary is broken** — it is expected to fail on every run that reaches it.

## Agent-to-agent delegation: the three-call mechanics

Both exchanges (steps 6 and 7) are the same three-call pattern with different actors.

**Why three calls, not one.** Okta's workload principals are deliberately restricted: their registered grant types are `urn:ietf:params:oauth:grant-type:jwt-bearer` and `urn:ietf:params:oauth:grant-type:token-exchange` only. **Not `client_credentials`.** An agent cannot mint its own authority from nothing; it can only *receive* delegated authority. That restriction is the whole point, and it is why a bootstrap service client exists at all.

1. **A service client mints a bootstrap token.** Something must originate authority. An ordinary OAuth service client (using the one grant type agents cannot) mints a short-lived token scoped to the read lane.
2. **The calling agent exchanges it for an ID-JAG.** A `grant_type=token-exchange` call to the Org Authorization Server, presenting the current token as `subject_token`, requesting `requested_token_type=...:id-jag`, with the *target* lane's Custom AS as `audience` and its resource identifier as `resource`. Authenticated with the calling agent's own `private_key_jwt` client assertion.
3. **The calling agent redeems the ID-JAG at the target's Custom AS.** `grant_type=jwt-bearer`, `assertion=<the id-jag>`, again signed with the caller's key. This produces the access token, and its `act` claim nests whatever chain preceded it.

Run it twice and the final token's `act` claim reads, unwound: *Agent 2 was invoked by Agent 1, which was invoked by the Intake Service.* Every link is an independently verifiable Okta-issued JWT, not an application-level assertion.

## The vaulted-secret release: a machine authorizes itself

Okta Privileged Access can vault a static credential and release it only in exchange for a valid token, via the same RFC 8693 grant with `requested_token_type=urn:okta:params:oauth:token-type:vaulted-secret` and `resource=<the secret's ORN>`.

That exchange **requires a `subject_token`**, and Okta runs a delegation-policy check against it. This is worth being precise about, because it is easy to conflate "no human in the loop" with "no subject at all," and token exchange does not work that way. There is always a subject. The question is whose.

Three candidates were tested against a live tenant:

| Candidate subject | Result |
|---|---|
| The agent's own service-client bootstrap token | Rejected: `"'subject_token' is invalid: no delegation policy authorizes this token."` |
| A token the agent mints *downstream* | Rejected, same error |
| **The agent's own *inbound* token**, the delegated authority it was handed | **Accepted.** The vault releases the secret. |

So the working pattern for a fully autonomous release is: **the agent presents the token that authorized *it***. Okta's delegation-policy check validates that chain, sees an unbroken line of authority terminating in this specific agent, and releases the secret. No person approved anything; the machine's own provenance was the approval.

(The released credential comes back under a `vaulted_secret` field, worth knowing if you are matching this against RFC 8693's more common `access_token` field name elsewhere.)

## Honesty by design

The orchestrator runs **live** (real Okta, Claude, Jira) or **demo** (a canned sequence, no external calls). Live mode degrades per-step: if the A2A chain or the vault is not fully configured, that step degrades rather than crashing the pipeline.

The rule enforced throughout: **the UI is never allowed to claim something happened that didn't.** A degraded step gets different narration and either a different System Log event id or none at all. It never reuses success language, and it never fabricates a log identifier for an event that was not emitted.

Three mechanisms back this up rather than just asserting it:

- **Demo-mode tokens are unsigned on purpose.** `alg=none` is real RFC 7515 vocabulary for an unsecured JWS, and the third segment reads `DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN`. Two independent tells, one for a reader who knows JWT internals and one for a reader who glances.
- **The UI detects them.** The chain-of-custody page reads the header of the first token it is given and shows a warning banner when `alg` is `none`. It does not decide honesty by whether a run happened; it decides by what the credential says about itself.
- **`/healthz` lists what is missing.** It reports `live` only when every variable the live path actually dereferences is present, and returns the missing names otherwise. An earlier version omitted the A2A settings from that check, so a half-configured deployment could report `live` and then fail on its first run.

## Current implementation notes

Two things this repo does not get all the way right, stated plainly:

**One vaulted credential, not two.** The credential released from the vault is write-capable and belongs to Agent 2. Agent 1's read in step 3 uses a configured environment credential instead of a separate read-only vaulted secret, because vaulting a second credential needs a second Jira principal and OPA console access. The *authorization* boundary is fully real: Agent 1's read is gated on a scope Okta granted, and Agent 1 cannot obtain write authority by any route. The *credential* separation is aspirational. Vaulting a read-only secret and connecting it to Agent 1 is the clean follow-up.

**A third workload principal exists and is unused.** The reference tenant contains a third agent from an earlier three-agent design. It has an active key and is registered as a resource, but it holds no connections and the backend never calls it. The demo now describes what actually exists: two agents, split by capability.

(Every Okta object identifier this app needs is an environment variable. See the table in [OKTA_SETUP.md](OKTA_SETUP.md).)

## Glossary

| Term | Meaning |
|---|---|
| **Workload principal** | An Okta identity representing a non-human actor, with its own credentials and lifecycle, distinct from a human user or a shared service account. |
| **ID-JAG** | Identity Assertion JWT Authorization Grant. An IETF draft token type used to carry delegated authority from one party to another via OAuth token exchange. |
| **`act` claim** | Defined in RFC 8693. Records who *actually* acted, distinct from the token's nominal subject. Nests recursively, one layer per hop. |
| **Down-scoping** | Issuing a token with a subset of the requested scopes when some are not grantable. Okta does this for `authorization_code` and deliberately does **not** for `jwt-bearer` or `token-exchange`. |
| **RFC 8693** | OAuth 2.0 Token Exchange. Defines `grant_type=token-exchange`, `subject_token`, and the `act` claim. |
| **OPA (Okta Privileged Access)** | The Okta product that vaults static credentials and releases them just in time over a token exchange. |
| **ORN** | Okta Resource Name. The identifier format Okta uses to reference a resource across its APIs. |
| **Dual citizenship** | This project's shorthand for an agent registered as *both* a caller and a resource, which is what makes agent-to-agent delegation possible. |
