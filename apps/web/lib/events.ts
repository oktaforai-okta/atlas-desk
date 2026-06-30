// Activity model. The SAME events drive two surfaces:
//  - Service Desk (main): product-friendly `plain` lines, the work as it happens.
//  - How it works (deep dive): `tech` + decoded `token_claims` + System Log ids.
// Mock stream makes it demoable; flips to live SSE when NEXT_PUBLIC_ORCHESTRATOR_URL is set.

export type Status = "running" | "ok" | "error";
export type ActorKind = "intake" | "triage" | "resolve" | "okta";

export interface ActivityEvent {
  step: string;
  actor: string;
  actorKind: ActorKind;
  plain: string;          // main feed line
  tech?: string;          // deep-dive detail
  primary?: boolean;      // surfaced on the main feed
  token_claims?: Record<string, unknown> | null;
  system_log_id?: string | null;
  data?: Record<string, unknown>;
  status?: Status;
  ts?: number;
}

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  requester: string;
  team?: string;
  status: "new" | "working" | "resolved";
  issueKey?: string;
  createdAgo: string;
}

export const ORCH = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";

const POOL: Array<{ id: string; subject: string; body: string; requester: string; team: string }> = [
  { id: "INC-4471", subject: "Can't connect to VPN from home", team: "Networking",
    body: "Corporate VPN client fails with 'authentication timeout' right after I approve the push. Worked yesterday. Fully remote today.",
    requester: "dana.reed@acme.com" },
  { id: "INC-4473", subject: "Need access to the Salesforce Revenue dashboard", team: "Access Management",
    body: "Moved to RevOps and can't see the Revenue dashboard in Salesforce. Manager said to request access through IT.",
    requester: "priya.nair@acme.com" },
  { id: "INC-4472", subject: "Laptop won't power on after update", team: "Hardware",
    body: "ThinkPad shut down during a Windows update and now the power light blinks three times. Customer demo at 2pm.",
    requester: "marco.silva@acme.com" },
  { id: "INC-4478", subject: "Slack huddle audio not working on desktop app", team: "Software",
    body: "Mic and audio fail only in the Slack desktop app; browser works. Reinstalled, no change. Blocks standup.",
    requester: "noah.berg@acme.com" },
];

// A few resolved tickets so the queue looks like a real, lived-in desk.
export const SEED_QUEUE: Ticket[] = [
  { id: "INC-4469", subject: "MFA prompt loop on new phone", body: "", requester: "owen.diaz@acme.com",
    team: "Access Management", status: "resolved", issueKey: "ITSD-118", createdAgo: "2h ago" },
  { id: "INC-4470", subject: "Monitor not detected via dock", body: "", requester: "amy.chen@acme.com",
    team: "Hardware", status: "resolved", issueKey: "ITSD-119", createdAgo: "1h ago" },
];

let idx = 0;
export function nextTicket(): Ticket {
  const t = POOL[idx % POOL.length];
  idx += 1;
  return { id: t.id, subject: t.subject, body: t.body, requester: t.requester,
           status: "new", createdAgo: "just now" };
}

const ISS = "https://oktaforai.oktapreview.com/oauth2/aus10rq0j6dqzBIY51d8";

function sequence(t: Ticket): ActivityEvent[] {
  const team = POOL.find((p) => p.id === t.id)?.team || "Networking";
  const issueKey = `ITSD-${120 + (idx % 60)}`;
  const triage = "Atlas Triage";
  const resolve = "Atlas Resolution";
  return [
    { step: "inbound", actor: "Intake", actorKind: "intake", primary: true,
      plain: "Received via intake API", tech: `${t.id} ingested from the external ticketing system` },
    { step: "intake_auth", actor: triage, actorKind: "triage",
      plain: "Atlas Triage picked up the ticket",
      tech: "Authenticated to Okta with its workload identity (private_key_jwt) — no human in the loop",
      system_log_id: "app.oauth2.token.grant" },
    { step: "intake_classify", actor: triage, actorKind: "triage", primary: true,
      plain: `Classified as ${team} · routed to the ${team} team`,
      tech: "Claude classified the ticket and selected the destination team" },
    { step: "a2a_exchange", actor: `${triage} → ${resolve}`, actorKind: "triage", primary: true,
      plain: `Handed off to ${resolve}`,
      tech: "Agent-to-agent delegation over Okta (machine context, scope agent.invoke). The issued token carries an act claim — the verifiable chain of custody.",
      token_claims: { sub: "wlp · Atlas Triage", act: { sub: "wlp · Atlas Triage", scope: "agent.invoke" },
        aud: "https://atlas.acme.example/resolution", scp: ["agent.invoke"], iss: ISS },
      system_log_id: "app.oauth2.token.grant.id_jag" },
    { step: "opa_vault", actor: resolve, actorKind: "resolve",
      plain: "Retrieved Jira credential securely",
      tech: "Jira credential released from the Okta OPA vault at runtime (STS vaulted-secret) — never stored in agent code",
      token_claims: { resource: "orn:okta:opa:…:secrets:jira-atlas", requested_token_type: "vaulted-secret" },
      system_log_id: "app.credential.vault.access" },
    { step: "devops_draft", actor: resolve, actorKind: "resolve", primary: true,
      plain: "Drafted an acknowledgement and a first next step",
      tech: "Claude drafted two work-note comments for the ticket" },
    { step: "jira_write", actor: resolve, actorKind: "resolve", primary: true,
      plain: `Filed ${issueKey} in Jira · ${team} · labeled · 2 comments`,
      tech: "POST /rest/api/3/issue — created, componented, labeled, commented",
      data: { issue_key: issueKey, team }, system_log_id: "jira.issue.created" },
    { step: "done", actor: "Atlas", actorKind: "okta", primary: true,
      plain: "Resolved and tracked in Jira",
      tech: "Every hop attributed to a governed identity · fully revocable" },
  ];
}

export async function runPipeline(
  ticket: Ticket,
  onEvent: (e: ActivityEvent) => void,
  signal?: AbortSignal,
): Promise<{ issueKey?: string; team?: string }> {
  let result: { issueKey?: string; team?: string } = {};
  if (ORCH) {
    const res = await fetch(`${ORCH}/api/run?ticket_id=${encodeURIComponent(ticket.id)}`, { signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const e: ActivityEvent = JSON.parse(line.slice(6));
        if (e.data?.issue_key) result = { issueKey: String(e.data.issue_key), team: String(e.data.team || "") };
        onEvent(e);
      }
    }
    return result;
  }
  for (const e of sequence(ticket)) {
    if (signal?.aborted) return result;
    onEvent({ ...e, status: "running", ts: Date.now() });
    await delay(360);
    if (signal?.aborted) return result;
    onEvent({ ...e, status: "ok", ts: Date.now() });
    if (e.data?.issue_key) result = { issueKey: String(e.data.issue_key), team: String(e.data.team || "") };
    await delay(440);
  }
  return result;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
