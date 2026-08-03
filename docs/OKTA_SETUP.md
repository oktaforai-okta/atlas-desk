# Configuring this in your own Okta tenant

A from-scratch build checklist: what to create in Okta, in what order, and why, to reproduce the capability boundary this project demonstrates. Written generically; every ID below is a placeholder you replace with your own tenant's value.

For *how* the resulting system behaves, see [ARCHITECTURE.md](ARCHITECTURE.md).

## The idea you are building

Two agents. One holds `ticket.read`. One holds `ticket.write`. Neither can hold the other's scope, and that is enforced by Okta policy rather than by application code.

The mechanism that enforces it is worth stating up front, because it determines the whole shape of the configuration:

> **The authorization server, not the scope string, is the policy boundary.**

A scope only exists on the authorization servers where you publish it, and each authorization server has its own policy naming which clients may use it. So "Agent 1 cannot write" is implemented as: publish the write scope on exactly one authorization server, and do not list Agent 1 as a client on it. Both halves matter, and together they give you two independent barriers.

## Prerequisites

- An Okta tenant with **AI Agents / Workload Principals** available.
- **Okta Privileged Access** provisioned, with its own admin console (a separate product surface with its own login and its own service-account credential system).
- Super admin on the core org. A separate **Okta Privileged Access security admin** role for the vault steps.
- A Jira Cloud site (or whatever downstream system you are wiring up) and an API token.

## 1. Register the Intake Service client

Something must originate authority for the first hand-off. Register an ordinary OAuth service client (a `client_credentials` app), for example `Intake Service`. This is the *only* credential in the system minted via `client_credentials`; everything downstream is a delegation.

It exists because workload principals are barred from that grant type. See the gotchas below.

## 2. Register the two agents (workload principals)

| Placeholder | Role |
|---|---|
| `<agent-1-id>` | Reads and triages. Holds `ticket.read`. Cannot write. |
| `<agent-2-id>` | Executes. Holds `ticket.write`. The only agent that touches production. |

For each, generate a JWK key pair (RSA, `RS256`) and store the **private** key securely. That key signs the agent's own `private_key_jwt` client assertions. Each id looks like `wlp<...>`.

Assign a human owner to each agent and activate it. Owner assignment may be Console-only on some tenants; see the gotchas.

## 3. Create the capability lanes

You need three Custom Authorization Servers. Two are read lanes, one is the write lane. Each callable agent must also be registered as its own **resource** (an "a2a-server") so other agents can be issued tokens targeting it specifically.

For each lane:

- A **resource URL** identifying the agent as a resource, for example `https://<your-domain>/agent-one`. This does not need to resolve to anything; it is an identifier, not a live endpoint.
- A **Custom Authorization Server** whose issuer becomes that lane's token endpoint (`https://<your-org>/oauth2/<cas-id>/v1/token`).

Then configure the scopes and policies. **This table is the security model:**

| Lane | Publish scope | Policy `clients.include` |
|---|---|---|
| Agent 1's own AS (bootstrap) | `ticket.read` | Intake Service, Agent 1 |
| Delegation AS | `ticket.read` | Intake Service, Agent 1 |
| **Write AS** | `ticket.write` | **Agent 2 only** |

Two rules that make this work:

1. **Publish `ticket.write` on the write AS and nowhere else.** If it also exists on a lane where Agent 1 is a client, Agent 1 can obtain it and the boundary is gone.
2. **Do not add Agent 1 to the write AS's client list.** This is the primary barrier.

Set each policy rule's scope list explicitly rather than leaving it as `*`. A rule granting `*` grants any scope published on that server, including ones you add later, which quietly widens the boundary over time.

### Verify the denial before you trust it

Do not assume the configuration works. Prove it. Mint a token as a client that should not have write access and confirm you get a refusal:

```
POST https://<org>/oauth2/<write-as-id>/v1/token
  grant_type=client_credentials&scope=ticket.write&client_id=<a-non-authorized-client>&...

-> 401  access_denied
   "Policy evaluation failed for this request, please check the policy configurations."
```

And confirm the second barrier, asking a read lane for the write scope:

```
-> 400  invalid_scope
   "One or more scopes are not configured for the authorization server resource."
```

If either of these succeeds, your boundary does not exist. This demo performs the first check on every run and displays the result, precisely so the claim stays falsifiable.

> **Gotcha:** registering an agent as a resource may require the Okta **Console UI**, not the REST API, depending on your tenant's release. A direct `POST`/`PUT` against the resource-servers API for this object type has been observed returning `405`, forcing manual registration. Also: once created, a resource URL generally **cannot be changed without deleting and recreating** the a2a-server object. Decide your naming scheme up front.

## 4. Vault the downstream credential in Okta Privileged Access

A genuinely separate product surface, worth calling out because it is easy to assume it is another core-Okta admin screen:

- **Okta Privileged Access has its own console** (own login URL, typically its own subdomain) and its own data model: **Team → Resource Group → Project → Folder → Secret.**
- It also has its **own service-account credential system**: a service user plus API key, minted inside that console, exchanged for a short-lived bearer token at its own token endpoint. Your core-org admin token (SSWS or OAuth) does **not** work against this API.

Steps:

1. In the Privileged Access console, create (or reuse) a Resource Group → Project → Folder.
2. Create a Secret in that folder holding your downstream credential. For a Jira API token a simple key/value pair works; key name `apikey` is a natural choice with an "API Key" style template.
3. Note the secret's **resource indicator** (an ORN, `orn:<region>:pam:<org-id>:secrets:<uuid>`).

## 5. Connect the write-capable agent to the vaulted secret

In the core admin console: **Directory → AI Agents → select Agent 2 → Resource connections → Add connection → Secret**, pick the secret, and accept (or deliberately set) the Resource Indicator. Requires the **Okta Privileged Access security admin** role in addition to super admin. The connection is created `ACTIVE` via this UI flow; created via the management API it may land `INACTIVE` and need an explicit activate call.

Connect it to the **write-capable** agent, not the read-only one. The read-only agent should not be able to reach a production credential at all, which is the entire point of splitting them.

**The subject that unlocks the vault at runtime must be the agent's own *inbound* token** (the one it received from the previous hop), presented as `subject_token` in a `grant_type=token-exchange` call to `/oauth2/v1/token`, with `requested_token_type=urn:okta:params:oauth:token-type:vaulted-secret` and `resource=<the secret's ORN>`. A token the agent mints itself, or a raw service-client token, is rejected with a delegation-policy error. See [ARCHITECTURE.md](ARCHITECTURE.md#the-vaulted-secret-release-a-machine-authorizes-itself).

## 6. Configuration: environment variables

Every Okta object identifier this app needs is an environment variable. There are no source constants to edit in `apps/orchestrator`.

### Backend (Render)

| Variable | What it is |
|---|---|
| `OKTA_DOMAIN` | Your tenant domain, e.g. `<your-org>.oktapreview.com` |
| `INTAKE_AGENT_ID` | Agent 1's workload principal id (`wlp...`) |
| `INTAKE_PRIVATE_JWK` | Agent 1's private key, full JSON |
| `DEVOPS_AGENT_ID` | Agent 2's workload principal id |
| `DEVOPS_PRIVATE_JWK` | Agent 2's private key, full JSON |
| `INTAKE_SERVICE_CLIENT_ID` / `INTAKE_SERVICE_SECRET` | The Intake Service client from step 1 |
| `TRIAGE_CAS_ID` / `TRIAGE_RESOURCE_URL` | Agent 1's own Custom AS id and resource URL. **Note:** these are two different values for two different objects. The CAS audience and the a2a-server resource URL are configured separately and need not match; set this to whatever you passed as the resource indicator. |
| `A2A_CAS_ISSUER` / `A2A_AUDIENCE` | The delegation lane's Custom AS issuer URL and resource URL |
| `FULFILLMENT_CAS_ISSUER` / `FULFILLMENT_RESOURCE` | The **write** lane's Custom AS issuer URL and resource URL |
| `A2A_READ_SCOPE` | Read scope name. Defaults to `ticket.read` |
| `A2A_WRITE_SCOPE` | Write scope name. Defaults to `ticket.write` |
| `JIRA_BASE_URL` / `ATLASSIAN_EMAIL` | Your Jira Cloud site and the account whose token you are using |
| `ATLASSIAN_API_TOKEN` | Fallback credential, used for the read path and when the vault is unreachable |
| `JIRA_SECRET_RESOURCE_ORN` | The vaulted secret's ORN from step 4 |
| `JIRA_ASSIGNEE_EMAIL` | Shared account every case is assigned to |
| `JIRA_PROJECT_KEY` | Your Jira project key. Defaults to `ITSD` |
| `CLAUDE_MODEL` | Model id. Defaults to a current Claude model |
| `ATLAS_ANTHROPIC_BASE_URL` | Override the Anthropic API base URL (e.g. a gateway). Optional |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_REGEX` | CORS allowlist. Defaults cover the deployed frontends plus any localhost port |
| `RATE_LIMIT_RUNS` / `RATE_LIMIT_WINDOW_SEC` | Per-IP limit on `/api/run`. Defaults to 12 per 300s |
| `LOG_LEVEL` | Defaults to `INFO` |

### Frontend (Vercel)

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | The orchestrator's URL. Inlined at build time, so changing it requires a redeploy |

That is the only frontend variable. The UI intentionally holds no tenant identifiers: everything it displays comes from the orchestrator, which read it off a real token.

### Setup scripts only (never in the deployed service)

`OKTA_SSWS_TOKEN`, `OWNER_USER_ID`, `ORG_ID`, `RESOLUTION_CAS_ID`, `FULFILLMENT_CAS_ID`.

## Gotchas learned the hard way

- **Workload principals cannot use `grant_type=client_credentials`.** Their allowed grants are `jwt-bearer` and `token-exchange` only, by design. An agent can only ever *receive* delegated authority, never mint its own. That is exactly why step 1's service client exists.
- **Okta does not down-scope a token-exchange request.** If any requested scope is not grantable, the *entire* request fails rather than issuing the grantable subset. (`authorization_code` down-scopes; `jwt-bearer` and `token-exchange` do not.) This is load-bearing for the boundary: there is no partial success to mistake for authorization. It also means a caller requesting a union of scopes for several agents will fail for every agent that lacks any one of them.
- **Only one managed connection per authorization server per agent.** A second attempt returns `DUPLICATE_CONNECTION`. Connection scopes live on the connection, so two scope boundaries means two authorization servers, which means two audiences.
- **The vaulted-secret exchange always requires a `subject_token`.** "Fully autonomous, no human" does not mean "no subject"; it means the subject is a machine token (the agent's own inbound delegation), not a human's ID token. Passing no subject fails with a plain missing-parameter error.
- **`STS_VAULT_SECRET` connections and the secret's storage are two systems with two credential types.** The connection on the agent is managed via the core Okta management API with your normal admin token. The secret's contents live in Okta Privileged Access, reachable only with that product's own service-account bearer token.
- **Resource URLs for agent-as-resource registrations are effectively immutable.** Changing one means deleting and recreating the a2a-server object.
- **Owner assignment and agent activation may be Console-only.** Activating a freshly registered agent via API can fail with an opaque `E0000001` until an owner is assigned in the Console.
