# Configuring this in your own Okta tenant

This is a from-scratch build checklist: what to create in Okta, in what order, and why, to reproduce the identity pattern this project demonstrates. It's written generically; every ID below is a placeholder you replace with your own tenant's real value.

For *how* the resulting system behaves once it's wired up, see [docs/ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- An Okta tenant with **AI Agents / Workload Principals** available (this is the feature that gives you first-class non-human identities with their own key pairs and A2A delegation).
- **Okta Privileged Access** provisioned on that tenant, with its own admin console (a separate product surface from the core Okta admin console, with its own login and its own service-account credential system, more on this below).
- Super admin on the core Okta org. A separate **Okta Privileged Access security admin role** for the steps that touch the vault.
- A Jira Cloud site (or whatever downstream system you're wiring up instead) and an API token for it.

## 1. Register the Intake Service client

Something has to originate authority for the very first hand-off. Register an ordinary OAuth service client (a `client_credentials` app), for example named `Intake Service`. Grant it a client ID + client secret. This is the *only* credential in the whole system minted via `client_credentials`, everything downstream of it is a delegation.

## 2. Register the three agents (workload principals)

Register three AI agents in Okta, for example:

| Placeholder name | Role |
|---|---|
| `<triage-agent-id>` | Classifies inbound tickets, initiates the first hand-off |
| `<resolution-agent-id>` | Decides the fix, delegates execution |
| `<fulfillment-agent-id>` | The only agent trusted to touch production; retrieves the vaulted credential and writes to the downstream system |

For each, generate a JWK key pair (RSA, `RS256`) and download/store the **private** key securely, this is what each agent uses to sign its own `private_key_jwt` client assertions. Each agent's id will look like `wlp<...>`.

## 3. Register each agent as its own resource ("dual citizenship")

Agent-to-agent delegation requires each *callable* agent to also be registered as its own **Custom Authorization Server / resource** (an "a2a-server" in Okta's terms), so other agents can be issued tokens that target it specifically. Concretely, for Resolution and Fulfillment (anything another agent needs to invoke), you need:

- A **resource URL** identifying the agent as a resource, for example `https://<your-domain>/resolution` and `https://<your-domain>/fulfillment`. This does not need to resolve to anything, it's an identifier, not a live endpoint.
- A **Custom Authorization Server** whose issuer becomes that agent's token endpoint (`https://<your-org>.oktapreview.com/oauth2/<cas-id>/v1/token`).

> **Gotcha:** registering an agent as a resource this way may require the Okta **Console UI**, not just the REST API, depending on your tenant's release. A direct `POST`/`PUT` against the resource-servers API for this specific object type has been observed returning `405` in some tenants, forcing manual registration. Also: once created, the resource URL generally **cannot be changed without deleting and recreating** the a2a-server object, decide on your resource URL scheme up front.

## 4. Vault the downstream credential in Okta Privileged Access

This is a genuinely separate product surface from the rest of the setup above, worth calling out explicitly since it's easy to assume it's just another core-Okta admin screen:

- **Okta Privileged Access has its own console** (its own login URL, typically on its own subdomain), and its own data model: **Team → Resource Group → Project → Folder → Secret.**
- It also has its **own service-account credential system** for API access: a "service user" + API key pair, minted inside that console, exchanged for a short-lived bearer token at its own token endpoint. Your core-org Okta admin token (SSWS or OAuth) does **not** work against this API.

Steps:
1. In the Privileged Access console, create (or reuse) a Resource Group → Project → Folder to hold your secret.
2. Create a Secret in that folder holding your downstream credential (for a Jira API token, a simple key/value pair works fine, key name `apikey` is a natural choice if using an "API Key" style template).
3. Note the secret's **resource indicator** (an ORN, `orn:<region>:pam:<org-id>:secrets:<uuid>`), you'll need it in step 5 and in your environment configuration.

## 5. Connect the Fulfillment agent to the vaulted secret

Back in the core Okta admin console: **Directory → AI Agents → select the Fulfillment agent → Resource connections → Add connection → Secret**, pick the secret you just vaulted, and accept (or deliberately set) the Resource Indicator. This requires the **Okta Privileged Access security admin** role in addition to super admin. The connection is created `ACTIVE` immediately via this UI flow; if you do this via the management API instead, a newly created connection may land `INACTIVE` and needs an explicit activate call.

**The subject that unlocks the vault, at runtime, must be the Fulfillment agent's own *inbound* A2A token** (the token it received from the previous hop in the chain), presented as `subject_token` in a `grant_type=token-exchange` call to your org's `/oauth2/v1/token`, with `requested_token_type=urn:okta:params:oauth:token-type:vaulted-secret` and `resource=<the secret's ORN>`. A token the agent mints itself, or a raw service-client token, will be rejected with a delegation-policy error, only a legitimately-delegated inbound token authorizes the release. See [docs/ARCHITECTURE.md](ARCHITECTURE.md#the-vaulted-secret-release-a-machine-authorizes-itself) for why.

## 6. Configuration: environment variables

Every Okta object identifier this app needs is an environment variable, there are no source constants to edit.

| Variable | What it is |
|---|---|
| `OKTA_DOMAIN` | Your tenant domain, e.g. `<your-org>.oktapreview.com` |
| `INTAKE_AGENT_ID` | Triage's workload principal id (`wlp...`) |
| `INTAKE_SERVICE_CLIENT_ID` / `INTAKE_SERVICE_SECRET` | The Intake Service client from step 1 |
| `INTAKE_PRIVATE_JWK` | Triage's private key, full JSON |
| `DEVOPS_AGENT_ID` | The Resolution/Fulfillment workload principal id (see the current-implementation note in the architecture doc, today this one identity plays both roles) |
| `DEVOPS_PRIVATE_JWK` | That agent's private key, full JSON |
| `TRIAGE_CAS_ID` / `TRIAGE_RESOURCE_URL` | Triage's Custom AS id and resource URL from step 3 |
| `A2A_CAS_ISSUER` / `A2A_AUDIENCE` | Resolution's Custom AS issuer and resource URL from step 3 |
| `FULFILLMENT_CAS_ISSUER` / `FULFILLMENT_RESOURCE` | Fulfillment's Custom AS issuer and resource URL from step 3 |
| `A2A_SCOPE` | The scope requested on each A2A hop, e.g. `agent.invoke` |
| `JIRA_BASE_URL` / `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` | Your Jira Cloud site and a fallback credential (used if the vault path below isn't reachable) |
| `JIRA_SECRET_RESOURCE_ORN` | The vaulted secret's ORN from step 4 |
| `JIRA_ASSIGNEE_EMAIL` | Where resolved/routed tickets get assigned |
| `JIRA_PROJECT_KEY` | Your Jira project key |
| `AUTO_RESOLVE_RATE` | Fraction of tickets the agent resolves autonomously vs. routes to a human team (0.0–1.0) |
| `ANTHROPIC_API_KEY` | Your Claude API key |

## Gotchas learned the hard way

- **Workload principals cannot use `grant_type=client_credentials`.** Their allowed grant types are `jwt-bearer` and `token-exchange` only, by design, an agent can only ever *receive* delegated authority, never mint its own from nothing. That's exactly why step 1's service client exists.
- **The vaulted-secret exchange requires a `subject_token`, always.** "Fully autonomous, no human" does not mean "no subject", it means the subject is a machine token (the agent's own inbound delegation), not a human's ID token. Passing no subject at all fails with a plain missing-parameter error, not something you can configure around.
- **`STS_VAULT_SECRET` connections and the secret's underlying storage are two different systems with two different credential types.** The connection (on the agent) is managed via the core Okta management API with your normal admin token. The secret's contents live in Okta Privileged Access, a different product, reachable only with that product's own service-account bearer token. Don't assume one admin token works for both.
- **Resource URLs for agent-as-resource registrations are effectively immutable.** Changing one typically means deleting and recreating the whole a2a-server object. Pick your naming scheme before you register anything.
