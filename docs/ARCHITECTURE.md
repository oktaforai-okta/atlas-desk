# Architecture

This is the deep technical explanation of how Atlas Service Desk works: the components, the exact token mechanics for agent-to-agent delegation, and the vaulted-secret release that lets a fully autonomous agent reach a downstream credential with no human anywhere in the chain.

If you want to build this pattern yourself, in your own Okta tenant, see [docs/OKTA_SETUP.md](OKTA_SETUP.md) instead, this document explains *how it works*, that one is a *build checklist*.

## What Okta provides, at each layer

| Layer | What it means here |
|---|---|
| **Identity** | Each agent (Triage, Resolution, Fulfillment) is a first-class **workload principal** in Okta's directory, its own key pair, its own human owner, its own lifecycle. Not a shared service account, not an API key copy-pasted into three places. |
| **Authorization** | Agent-to-agent delegation is policy-governed, not just "any agent can call any agent." Each hop mints an **ID-JAG** (an OAuth token-exchange grant type, an IETF draft standard) whose `act` claim (RFC 8693) records exactly who acted, on whose authority, a verifiable chain of custody across every agent in the request, not a log entry that could have been written after the fact. |
| **Runtime** | Only the agent that's supposed to touch production actually can. Its downstream credential (here, a Jira API token) is vaulted in **Okta Privileged Access** and released just-in-time, at request time, over a real OAuth exchange. Nothing static lives in the agent's code or environment. |
| **Governance** | Every hop above is a real, queryable event in the **Okta System Log**, attributable to a named identity. Deactivate any single agent in the chain and the next hand-off provably fails, that's not a policy statement, it's a testable fact about the system. |

## Components

![System architecture](diagrams/system-architecture.drawio.png)

- **Next.js frontend** (Vercel). Renders the ticket queue, the live activity feed, and the architecture/chain-of-custody visualizations. Holds zero credentials, everything it shows comes from the orchestrator over a streamed connection.
- **FastAPI orchestrator** (Render). The only component that talks to Okta, Claude, or Jira. Drives the pipeline below and streams `ActivityEvent`s to the frontend over Server-Sent Events.
- **Claude API.** Two jobs: classify an inbound ticket (department + urgency, which becomes the real Jira priority, not just narration) and draft resolution text (either internal work notes, or a customer-facing reply when the case gets auto-resolved).
- **Okta.** An Org Authorization Server (issues and exchanges tokens, and releases vaulted secrets), plus one Custom Authorization Server per agent (each agent is also registered as its *own* resource, "dual citizenship", so other agents can be issued tokens that target it).
- **Okta Privileged Access.** Holds the one credential that actually reaches a production system (the Jira API token), released only in exchange for a valid, policy-checked token, never stored in the orchestrator's code or environment.
- **Jira Cloud.** The real destination. Issues are actually created, actually commented on, and actually transitioned to Done on the auto-resolve path.

## The nine-step pipeline

![Pipeline sequence, nine steps, token movement highlighted](diagrams/pipeline-sequence.drawio.png)

1. **`inbound`** — A ticket arrives via the intake API. No Okta involvement yet, this is a plain HTTP request.
2. **`intake_auth`** — The Triage agent authenticates to Okta using its own key (a `private_key_jwt` client assertion). This is the first point where the request is tied to a real identity.
3. **`intake_classify`** — Claude reads the ticket and classifies it (department + urgency). Okta isn't involved in this step; it's pure LLM reasoning.
4. **`a2a_exchange`** (hop 1) — Triage hands the ticket off to Resolution. See [Agent-to-agent delegation](#agent-to-agent-delegation-the-three-call-mechanics) below for exactly what happens. Result: a token whose `act` claim records one agent (Triage).
5. **`devops_draft`** — Claude drafts the fix. Resolution decides here whether the ticket is self-serviceable (auto-resolve) or needs a specialist (route it). Resolution has no production credential of its own either way, it always delegates execution.
6. **`a2a_fulfillment`** (hop 2) — Resolution hands execution off to Fulfillment, the only agent trusted to touch production. Same mechanics as hop 1, run again. Result: a token whose `act` claim now nests **both** agents (Resolution, having been invoked by Triage, invoking Fulfillment). Deactivate either agent in Okta and this hop fails.
7. **`opa_vault`** — Fulfillment retrieves the real Jira credential from Okta Privileged Access. This is the step this project spent the most effort getting right, see [The vaulted-secret release](#the-vaulted-secret-release-a-machine-authorizes-itself) below.
8. **`jira_write`** — Fulfillment uses the released credential to actually create the Jira issue (or, on the auto-resolve path, to comment the resolution and transition it to Done).
9. **`done`** — Terminal state. Every hop above now exists as a real, queryable Okta System Log event.

## Agent-to-agent delegation: the three-call mechanics

Both A2A hops (steps 4 and 6) are the *same* three-call pattern, just with different actors. This section describes it once.

**Why it's three calls, not one.** Okta's workload principals are deliberately restricted: their registered OAuth grant types are `urn:ietf:params:oauth:grant-type:jwt-bearer` and `urn:ietf:params:oauth:grant-type:token-exchange` only. **Not `client_credentials`.** An agent cannot unilaterally mint its own access token from nothing, it can only *receive* delegated authority: from a human (an ID token), from a service client, or from another agent's token. That restriction is the whole point, and it's why a bootstrap step exists at all.

1. **A service client mints a bootstrap token.** Something has to originate authority in the first place. An ordinary OAuth service client (`client_credentials`, the one grant type agents themselves can't use) mints a short-lived token scoped to invoke Triage. Its audience is Triage's own resource identifier.
2. **The calling agent exchanges that token for an ID-JAG.** Triage (now holding the bootstrap token as its own credential, or, in hop 2, holding the token it received from the previous hop) calls Okta's Org Authorization Server with `grant_type=token-exchange`, presenting that token as the `subject_token`, and requesting `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`, with the *target* agent's Custom AS as the audience and the target's resource identifier as `resource`. This step is authenticated with the calling agent's own `private_key_jwt` client assertion.
3. **The calling agent redeems the ID-JAG at the target's own Custom AS.** One more call, `grant_type=jwt-bearer`, `assertion=<the id-jag>`, sent to the *target* agent's token endpoint, again signed with the calling agent's own key. This produces the actual access token that authorizes invoking the target, and its `act` claim nests whatever chain preceded it.

Run this twice (once per hop) and the final token's `act` claim reads, unwound: *Fulfillment was invoked by Resolution, which was invoked by Triage, which was invoked by the bootstrap service client.* Every link is a real Okta-issued, independently verifiable JWT, not an application-level claim.

## The vaulted-secret release: a machine authorizes itself

Okta Privileged Access can vault a static credential (here, a Jira API token) and release it only in exchange for a valid token, via the same RFC 8693 token-exchange grant, `requested_token_type=urn:okta:params:oauth:token-type:vaulted-secret`, `resource=<the secret's identifier>`.

That exchange **requires a `subject_token`**, and Okta runs a delegation-policy check against it. This is the detail worth being precise about, because it's easy to conflate "no human in the loop" with "no subject at all", and RFC 8693 token exchange doesn't work that way. There is always a subject; the question is *whose*.

Three candidates were tested against a live tenant while building this:

| Candidate subject | Result |
|---|---|
| The agent's own service-client bootstrap token | Rejected: `"'subject_token' is invalid: no delegation policy authorizes this token."` |
| A token the agent mints *downstream*, to invoke something further along | Rejected, same error |
| **The agent's own *inbound* A2A token**, the delegated authority it was actually handed | **Accepted.** The vault releases the secret. |

So the working pattern for a fully autonomous release is: **the agent presents the token that authorized *it*** as the subject, not a human's ID token, not something it minted itself. Okta's delegation-policy check validates that chain, sees a legitimate, unbroken line of authority terminating in this specific agent, and releases the secret. No person approved anything; the machine's own provenance was the approval.

(The released credential itself comes back under a `vaulted_secret` field in the token response, worth knowing if you're matching this against RFC 8693's more common `access_token` field name elsewhere.)

## Current implementation notes

One thing worth stating plainly rather than glossing over:

**Only two of the three narrated agent identities are distinct today.** The pipeline narrates three agents (Triage, Resolution, Fulfillment), but the current backend uses two real, distinct Okta workload principals: one for Triage, and *one shared identity* for both the "Resolution" and "Fulfillment" roles. The same key signs hop 2's redemption (as "Resolution" inviting "Fulfillment") and the vault retrieval (as "Fulfillment" unlocking its credential). A third workload principal exists and is registered in the reference tenant, but the running backend never uses it, it only appears in the frontend's illustrative example data. Splitting this into three genuinely independent identities, each with its own key and its own Custom AS and its own vault connection, is a clean, mechanical follow-up: register the third agent, generate its key, add a third A2A hop, and move the `STS_VAULT_SECRET` connection to it.

(Every Okta object identifier this app needs is an environment variable, see the table in [docs/OKTA_SETUP.md](OKTA_SETUP.md), there are no source constants to edit.)

## Honesty by design: the demo-mode / fallback rule

This project runs in one of two modes depending on what's configured: **live** (real Okta, real Claude, real Jira) or **demo** (a fixed, safe, canned sequence, no external calls at all). Live mode itself has an internal fallback: if a specific piece (the A2A chain, the OPA vault) isn't fully configured yet, that one step degrades gracefully rather than crashing the whole pipeline.

The rule enforced throughout: **the UI is never allowed to claim something happened that didn't.** A degraded step gets different narration and either a different System Log event id or none at all, it never shows the same "success" language, and it never fabricates a log identifier for an event that wasn't actually emitted. If you're reading the code and want to know whether a given run was fully real, check the `system_log_id` on each event, that's the tell.

## Glossary

| Term | Meaning |
|---|---|
| **Workload principal** | An Okta identity representing a non-human actor (here, an AI agent), with its own credentials and lifecycle, distinct from a human user or a shared service account. |
| **ID-JAG** | Identity Assertion JWT Authorization Grant, an IETF draft standard token type used to carry delegated authority from one party to another via OAuth token exchange. |
| **`act` claim** | Defined in RFC 8693. Records who *actually* acted, distinct from the token's nominal subject. Nests recursively, each hop wraps the previous one's `act`. |
| **XAA (Cross App Access)** | Okta's protocol for one application/agent to access another's resources on behalf of an authenticated party, human or machine. |
| **RFC 8693** | The OAuth 2.0 Token Exchange specification. Defines the `grant_type=token-exchange` flow, `subject_token`, and the `act` claim used throughout this project. |
| **OPA (Okta Privileged Access)** | The Okta product that vaults static credentials (API keys, service-account passwords) and releases them just-in-time over a token exchange, rather than storing them in application code. |
| **ORN** | Okta Resource Name, the identifier format Okta uses to reference a specific resource (an auth server, a vaulted secret, a connection) across its APIs. |
| **Dual citizenship** | This project's shorthand for an agent that is registered as *both* a caller (a workload principal that can request tokens) and a resource (something another agent's token can target), which is what makes agent-to-agent delegation possible. |
