// Chain-of-custody event contract (mirrors apps/orchestrator/events.py).
// Provides a realistic MOCK stream so the UI is fully demoable before the
// live backend is wired; switches to real SSE when NEXT_PUBLIC_ORCHESTRATOR_URL is set.

export type ChainStatus = "running" | "ok" | "error";

export interface ChainEvent {
  step: string;
  label: string;
  status: ChainStatus;
  identity?: string | null;
  detail?: string | null;
  token_claims?: Record<string, unknown> | null;
  system_log_id?: string | null;
  data?: Record<string, unknown>;
  ts?: number;
}

export interface Ticket {
  id: string;
  title: string;
  body: string;
  reporter: string;
}

export const ORCH = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";

// ---- mock ticket pool (matches the backend seeds in spirit) ----
const MOCK_TICKETS: Array<Ticket & { department: string }> = [
  { id: "INC-4471", title: "Can't connect to VPN from home",
    body: "Corporate VPN client fails with 'authentication timeout' right after I approve the push. Worked yesterday. Fully remote today.",
    reporter: "dana.reed@acme.example", department: "Networking" },
  { id: "INC-4473", title: "Need access to the Salesforce Revenue dashboard",
    body: "Moved to RevOps and can't see the Revenue dashboard in Salesforce. Manager said to request access through IT.",
    reporter: "priya.nair@acme.example", department: "Access Management" },
  { id: "INC-4472", title: "Laptop won't power on after update",
    body: "ThinkPad shut down during a Windows update and now the power light blinks three times. Customer demo at 2pm.",
    reporter: "marco.silva@acme.example", department: "Hardware" },
  { id: "INC-4478", title: "Slack huddle audio not working on desktop app",
    body: "Mic and audio fail only in the Slack desktop app; browser works. Reinstalled, no change. Blocks standup.",
    reporter: "noah.berg@acme.example", department: "Software" },
];

let mockIdx = 0;
export function nextMockTicket(): Ticket {
  const t = MOCK_TICKETS[mockIdx % MOCK_TICKETS.length];
  mockIdx += 1;
  return { id: t.id, title: t.title, body: t.body, reporter: t.reporter };
}

const ORG = "00ounfmlb8nQg2PUH1d7";

// Build the realistic mock event sequence for a ticket.
function mockSequence(t: Ticket): ChainEvent[] {
  const dept = (MOCK_TICKETS.find((m) => m.id === t.id)?.department) || "Networking";
  const triage = "Atlas Triage Agent · wlp10qjmsgdQROgxE1d8";
  const resolution = "Atlas Resolution Agent · wlp10qjml8mNlyBVK1d8";
  const issueKey = `ITSD-${100 + (mockIdx % 80)}`;
  return [
    { step: "inbound", label: "Ticket received", status: "ok",
      identity: "External ticketing system", detail: `${t.id} ingested via inbound API` },
    { step: "intake_auth", label: "Triage agent authenticated", status: "ok",
      identity: triage, detail: "private_key_jwt → Okta (no human in the loop)",
      system_log_id: "wpo_" + rand() },
    { step: "intake_classify", label: "LLM triage", status: "ok",
      identity: triage, detail: `Claude classified → ${dept} · routed for filing` },
    { step: "a2a_exchange", label: "A2A token exchange", status: "ok",
      identity: `${triage}  ⟶  ${resolution}`,
      detail: "machine-context delegation · agent.invoke",
      token_claims: {
        sub: "wlp10qjmsgdQROgxE1d8",
        act: { sub: "wlp10qjmsgdQROgxE1d8", purpose: "agent.invoke" },
        aud: "https://atlas.acme.example/resolution",
        scp: ["agent.invoke"],
        iss: "https://oktaforai.oktapreview.com/oauth2/aus10rq0j6dqzBIY51d8",
      },
      system_log_id: "app.oauth2.token.grant." + rand() },
    { step: "devops_receive", label: "Resolution agent invoked", status: "ok",
      identity: resolution, detail: "validated act-claim chain of custody" },
    { step: "opa_vault", label: "Jira credential released from OPA vault", status: "ok",
      identity: resolution,
      detail: "STS vaulted-secret exchange · credential never in agent code",
      token_claims: { resource: `orn:okta:opa:${ORG}:secrets:jira-atlas`, requested_token_type: "vaulted-secret" },
      system_log_id: "app.credential.vault.access." + rand() },
    { step: "devops_draft", label: "LLM drafted resolution notes", status: "ok",
      identity: resolution, detail: "Claude drafted acknowledgement + first next step" },
    { step: "jira_write", label: "Filed to Jira as machine identity", status: "ok",
      identity: resolution,
      detail: `Created ${issueKey} · component ${dept} · labeled · 2 comments`,
      data: { issue_key: issueKey, component: dept },
      system_log_id: "jira.issue.created" },
    { step: "done", label: "Chain of custody complete", status: "ok",
      identity: "Atlas IOC", detail: "Every hop attributed · fully revocable" },
  ];
}

function rand() {
  // deterministic-ish id for display (no Math.random reliance on first paint)
  return Math.abs(Date.now() % 1_000_000).toString(36);
}

export async function runPipeline(
  ticket: Ticket,
  onEvent: (e: ChainEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (ORCH) {
    // Real backend SSE
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
        if (line) onEvent(JSON.parse(line.slice(6)));
      }
    }
    return;
  }
  // Mock stream with cinematic pacing
  const seq = mockSequence(ticket);
  for (const e of seq) {
    if (signal?.aborted) return;
    onEvent({ ...e, status: "running", ts: Date.now() });
    await delay(420);
    if (signal?.aborted) return;
    onEvent({ ...e, status: "ok", ts: Date.now() });
    await delay(520);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
