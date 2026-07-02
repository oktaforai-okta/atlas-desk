# Deploying Atlas Service Desk (live demo)

Two managed services, both on the shared **oktaforai** accounts:

| Piece | App | Host |
|---|---|---|
| Frontend (Next.js) | `apps/web` | **Vercel** (oktaforai account) |
| Orchestrator (FastAPI) | `apps/orchestrator` | **Render** (project `prj-d7gh20a8qa3s73f6lheg`, Starter) |

The frontend calls the orchestrator over SSE. Wire them by setting the Render URL as the frontend's `NEXT_PUBLIC_ORCHESTRATOR_URL`.

> Prereq: both accounts' GitHub connections must have access to `astro7982/jc-devops-desk` and this deploy branch. Grant the oktaforai Vercel + Render GitHub apps access to the repo if prompted.

---

## 1. Backend — Render (do this first; the frontend needs its URL)

1. In the shared Render project **prj-d7gh20a8qa3s73f6lheg** → **New → Blueprint** (or Web Service), connect `astro7982/jc-devops-desk`, pick this deploy branch. Render reads `render.yaml` and proposes **atlas-orchestrator** (Starter, rootDir `apps/orchestrator`).
2. Set the secret env vars (marked `sync:false` in `render.yaml`, so Render prompts for them). Values live in the local `.secrets/` on the demo machine:

   | Env var | Where to get the value |
   |---|---|
   | `INTAKE_SERVICE_CLIENT_ID` | `.secrets/.env` |
   | `INTAKE_SERVICE_SECRET` | `.secrets/.env` |
   | `INTAKE_PRIVATE_JWK` | paste the full JSON of `.secrets/wlp10qjmsgdQROgxE1d8.private.jwk.json` |
   | `DEVOPS_PRIVATE_JWK` | paste the full JSON of `.secrets/wlp10qjml8mNlyBVK1d8.private.jwk.json` |
   | `JIRA_BASE_URL` | `.secrets/.env` (e.g. `https://aisupportbuild.atlassian.net`) |
   | `ATLASSIAN_EMAIL` | `.secrets/.env` |
   | `ATLASSIAN_API_TOKEN` | `.secrets/.env` |
   | `JIRA_SECRET_RESOURCE_ORN` | `.secrets/.env` (optional; falls back to `ATLASSIAN_API_TOKEN` if unset) |
   | `ANTHROPIC_API_KEY` | `.secrets/.env` |

   Non-secret vars (`OKTA_DOMAIN`, agent IDs, `JIRA_ASSIGNEE_EMAIL`, `AUTO_RESOLVE_RATE`, etc.) are already baked into `render.yaml`.
3. Deploy. When it's up, hit `https://<service>.onrender.com/healthz` — it should return `{"ok":true,"mode":"live"}` once the secrets are set (`"demo"` means a required secret is still missing).
4. Copy the service URL (e.g. `https://atlas-orchestrator-xxxx.onrender.com`).

## 2. Frontend — Vercel (oktaforai account)

1. **Add New → Project**, import `astro7982/jc-devops-desk`, same branch.
2. **Root Directory → `apps/web`** (Framework auto-detects as Next.js; build `next build`).
3. Add an Environment Variable (Production + Preview):
   - `NEXT_PUBLIC_ORCHESTRATOR_URL` = the Render URL from step 1.4
   - This is inlined at build time, so it must be set **before** the first deploy. If you change it later, redeploy.
4. Deploy. The Vercel URL is the live demo.

## 3. Verify

Open the Vercel URL → the header pill should read **Live** (green). Click **Simulate inbound ticket** a few times:
- some cases **auto-resolve** (green panel, customer reply, "closed in Jira"),
- others **route** to a team (blue panel),
- every case is assigned to **oktaforai@atko.email** — log into Jira as that account and you'll see them under "assigned to me", auto-resolved ones marked **Done**.

## Notes

- CORS on the orchestrator is currently `*`, so the Vercel origin works out of the box. To tighten later, restrict `allow_origins` in `apps/orchestrator/main.py` to the Vercel domain.
- Render Starter is always-on (no cold starts). The health check is `/healthz`.
- `AUTO_RESOLVE_RATE` (Render env, default `0.5`) tunes how often cases auto-resolve; set `1.0` or `0.0` to force one outcome for a scripted demo.
- Secrets never leave the dashboards — `.secrets/`, `.env*` are git-ignored.
