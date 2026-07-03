# Deploying Atlas Service Desk

Two managed services:

| Piece | App | Host |
|---|---|---|
| Frontend (Next.js) | `apps/web` | **Vercel** |
| Orchestrator (FastAPI) | `apps/orchestrator` | **Render** |

The frontend calls the orchestrator over SSE. Wire them by setting the Render URL as the frontend's `NEXT_PUBLIC_ORCHESTRATOR_URL`.

> Prereq: your Vercel and Render accounts' GitHub connections need access to this repo and the branch you're deploying.

---

## 1. Backend — Render (do this first; the frontend needs its URL)

1. In your Render project → **New → Blueprint** (or Web Service), connect this repo, pick your branch. Render reads `render.yaml` and proposes **atlas-orchestrator** (Starter plan, rootDir `apps/orchestrator`).
2. Set every `sync:false` env var (Render prompts for these; see [docs/OKTA_SETUP.md](docs/OKTA_SETUP.md) for what each one is and how to obtain it for your tenant):

   | Env var | What it is |
   |---|---|
   | `OKTA_DOMAIN` | Your Okta tenant domain |
   | `INTAKE_AGENT_ID` | Triage's workload principal id |
   | `INTAKE_SERVICE_CLIENT_ID` / `INTAKE_SERVICE_SECRET` | Your Intake Service `client_credentials` app |
   | `INTAKE_PRIVATE_JWK` | Full JSON of Triage's private key |
   | `DEVOPS_AGENT_ID` | The Resolution/Fulfillment workload principal id |
   | `DEVOPS_PRIVATE_JWK` | Full JSON of that agent's private key |
   | `TRIAGE_CAS_ID` / `TRIAGE_RESOURCE_URL` | Triage's Custom AS id and resource URL |
   | `A2A_CAS_ISSUER` / `A2A_AUDIENCE` | Resolution's Custom AS issuer URL and resource URL |
   | `FULFILLMENT_CAS_ISSUER` / `FULFILLMENT_RESOURCE` | Fulfillment's Custom AS issuer URL and resource URL |
   | `JIRA_BASE_URL` | Your Jira Cloud site, e.g. `https://your-site.atlassian.net` |
   | `ATLASSIAN_EMAIL` | The Jira account whose API token you're using |
   | `ATLASSIAN_API_TOKEN` | That account's Jira API token |
   | `JIRA_SECRET_RESOURCE_ORN` | Your vaulted secret's ORN (optional; falls back to `ATLASSIAN_API_TOKEN` if unset) |
   | `JIRA_ASSIGNEE_EMAIL` | The shared account you want every case assigned to |
   | `ANTHROPIC_API_KEY` | Your Claude API key |

   Non-secret vars (`JIRA_PROJECT_KEY`, `AUTO_RESOLVE_RATE`, `A2A_SCOPE`, etc.) are already baked into `render.yaml`.
3. Deploy. When it's up, hit `https://<service>.onrender.com/healthz`, it should return `{"ok":true,"mode":"live"}` once every required var is set (`"demo"` means one still is missing).
4. Copy the service URL (e.g. `https://atlas-orchestrator-xxxx.onrender.com`).

## 2. Frontend — Vercel

1. **Add New → Project**, import this repo, same branch.
2. **Root Directory → `apps/web`** (Framework auto-detects as Next.js; build `next build`).
3. Add an Environment Variable (Production + Preview):
   - `NEXT_PUBLIC_ORCHESTRATOR_URL` = the Render URL from step 1.4
   - This is inlined at build time, so it must be set **before** the first deploy. If you change it later, redeploy.
4. Deploy. The Vercel URL is the live demo.

## 3. Verify

Open the Vercel URL, the header pill should read **Live** (green). Click **Simulate inbound ticket** a few times:
- some cases **auto-resolve** (green panel, customer reply, "closed in Jira"),
- others **route** to a team (blue panel),
- every case is assigned to whichever account you set as `JIRA_ASSIGNEE_EMAIL`, log in as that account and you'll see them under "assigned to me," auto-resolved ones marked **Done**.

## Notes

- CORS on the orchestrator is currently `*`, so any frontend origin works out of the box. To tighten later, restrict `allow_origins` in `apps/orchestrator/main.py` to your actual frontend domain.
- Render Starter is always-on (no cold starts). The health check is `/healthz`.
- `AUTO_RESOLVE_RATE` (Render env, default `0.5`) tunes how often cases auto-resolve; set `1.0` or `0.0` to force one outcome for a scripted demo.
- Secrets never leave the dashboards, `.secrets/`, `.env*` are git-ignored, and every tenant-specific value (not just the true secrets) is `sync:false` in `render.yaml`.
