// Activity model. The SAME events drive two surfaces:
//  - Service Desk (main): product-friendly `plain` lines, the work as it happens.
//  - How it works (deep dive): `tech` + decoded `token_claims` + System Log ids.
// Mock stream makes it demoable; flips to live SSE when NEXT_PUBLIC_ORCHESTRATOR_URL is set.

export type Status = "running" | "ok" | "error";
export type ActorKind = "intake" | "triage" | "resolve" | "fulfill" | "okta";

export interface ActivityEvent {
  step: string;
  actor: string;
  actorKind: ActorKind;
  plain: string;          // main feed line
  tech?: string;          // deep-dive detail
  primary?: boolean;      // surfaced on the main feed
  token_claims?: Record<string, unknown> | null;
  raw_tokens?: Record<string, string> | null; // {label: compact JWT}, e.g. {"t1": "...", "t_res": "..."}
  system_log_id?: string | null;
  data?: Record<string, unknown>;
  status?: Status;
  ts?: number;
}

// "Last event per step wins", the same pattern TicketActivity built inline;
// shared here since AgentFlowGraph and the Jira-link lookup need it too.
export function latestByStep(events: ActivityEvent[]): Map<string, ActivityEvent> {
  const latest = new Map<string, ActivityEvent>();
  for (const e of events) latest.set(e.step, e);
  return latest;
}

// Merges raw_tokens across the whole stream (first-appearance order), the flat
// {label: rawJwt} map the Token Inspector reads. Additive only.
export function collectRawTokens(events: ActivityEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) if (e.raw_tokens) Object.assign(out, e.raw_tokens);
  return out;
}

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  requester: string;
  team?: string;
  status: "new" | "working" | "resolved";
  issueKey?: string;
  issueUrl?: string;
  outcome?: "auto_resolved" | "routed"; // set once the run finishes
  resolution?: string;                   // customer reply the agent sent (auto-resolve only)
  createdAgo: string;
}

export const ORCH = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";

// Bridges the real per-step token_claims from a live run over to /how-it-works,
// which is a separate page (and loses component state on navigation).
export const TOKEN_CLAIMS_KEY = "atlas:tokenClaims";

export function captureTokenClaims(e: ActivityEvent) {
  if (typeof window === "undefined" || !e.token_claims) return;
  try {
    const raw = window.sessionStorage.getItem(TOKEN_CLAIMS_KEY);
    const store = raw ? JSON.parse(raw) : {};
    store[e.step] = { token_claims: e.token_claims, system_log_id: e.system_log_id ?? null, captured_at: Date.now() };
    window.sessionStorage.setItem(TOKEN_CLAIMS_KEY, JSON.stringify(store));
  } catch {
    // sessionStorage unavailable (private mode, etc.), the static example still renders
  }
}

// Bridges a full run's raw JWTs + vault exchange metadata over to /tokens, a
// separate page (and loses component state on navigation) — parallel to
// TOKEN_CLAIMS_KEY above, not a replacement (AgentStatusBadge on /agents still
// reads that one). Written once a run completes; the Token Inspector falls
// back to clearly-labeled illustrative examples when this key is absent.
export const RAW_TOKENS_KEY = "atlas:rawTokens";

export interface CapturedRawTokens {
  tokens: Record<string, string>;
  vault: Record<string, unknown> | null;
  capturedAt: number;
}

export function captureRawTokens(events: ActivityEvent[]) {
  if (typeof window === "undefined") return;
  const tokens = collectRawTokens(events);
  if (Object.keys(tokens).length === 0) return;
  try {
    const vault = latestByStep(events).get("opa_vault")?.data ?? null;
    const payload: CapturedRawTokens = { tokens, vault, capturedAt: Date.now() };
    window.sessionStorage.setItem(RAW_TOKENS_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage unavailable, the Token Inspector falls back to illustrative examples
  }
}

export function readCapturedRawTokens(): CapturedRawTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RAW_TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CapturedRawTokens;
    return parsed?.tokens ? parsed : null;
  } catch {
    return null;
  }
}

const POOL: Array<{ subject: string; body: string; requester: string; team: string }> = [
  { subject: "Can't connect to VPN from home", team: "Networking",
    body: "Corporate VPN client fails with 'authentication timeout' right after I approve the push. Worked yesterday. Fully remote today.",
    requester: "dana.reed@acme.example" },
  { subject: "Need access to the Salesforce Revenue dashboard", team: "Access Management",
    body: "Moved to RevOps and can't see the Revenue dashboard in Salesforce. Manager said to request access through IT.",
    requester: "priya.nair@acme.example" },
  { subject: "Laptop won't power on after update", team: "Hardware",
    body: "ThinkPad shut down during a Windows update and now the power light blinks three times. Customer demo at 2pm.",
    requester: "marco.silva@acme.example" },
  { subject: "Slack huddle audio not working on desktop app", team: "Software",
    body: "Mic and audio fail only in the Slack desktop app; browser works. Reinstalled, no change. Blocks standup.",
    requester: "noah.berg@acme.example" },
  { subject: "Locked out of GitHub org after SSO change", team: "Access Management",
    body: "After the SSO migration I can't access the engineering GitHub org. Getting 'you are not a member' even though I was yesterday.",
    requester: "tara.lin@acme.example" },
  { subject: "Office Wi-Fi dropping every few minutes", team: "Networking",
    body: "The 4th-floor conference room Wi-Fi disconnects every 5-10 minutes during calls. Multiple people on the floor see the same thing.",
    requester: "lena.fischer@acme.example" },
  { subject: "Adobe Acrobat keeps crashing on launch", team: "Software",
    body: "Acrobat Pro crashes immediately on open since the latest version. Reinstalled twice, same result. I need it to process signed contracts.",
    requester: "evan.cole@acme.example" },
  { subject: "Replacement keyboard and dock request", team: "Hardware",
    body: "Several keys on my keyboard stopped working and my dock no longer charges the laptop. Requesting replacement hardware.",
    requester: "sam.osei@acme.example" },
  { subject: "DNS resolution failing for internal sites", team: "Networking",
    body: "Internal tools like wiki.acme.com won't resolve on the corporate network, but public sites load fine. Started after this morning's maintenance window.",
    requester: "raj.patel@acme.example" },
  { subject: "VPN split-tunnel not routing to the data center", team: "Networking",
    body: "I can reach the internet on VPN but not the 10.20.x.x data-center subnet. Other people on my team can. Blocks my deploys.",
    requester: "mia.torres@acme.example" },
  { subject: "Need admin role on the Payments Jira project", team: "Access Management",
    body: "I'm the new lead for Payments but only have contributor access in Jira. Need project-admin to manage the board and workflows.",
    requester: "kofi.mensah@acme.example" },
  { subject: "Can't open the shared HR drive after my transfer", team: "Access Management",
    body: "Moved from Support to People Ops last week and the HR shared drive shows 'access denied'. Manager approved the move already.",
    requester: "hana.kim@acme.example" },
  { subject: "External monitor flickers on the new dock", team: "Hardware",
    body: "My 4K monitor flickers every few seconds through the new USB-C dock, but is fine plugged in directly. Swapped the cable, no change.",
    requester: "diego.romero@acme.example" },
  { subject: "Webcam not detected after BIOS update", team: "Hardware",
    body: "After the firmware update pushed last night, the built-in webcam is gone from Device Manager. I have client calls all day.",
    requester: "ava.nguyen@acme.example" },
  { subject: "Excel macros disabled by policy during finance close", team: "Software",
    body: "Group policy is blocking macros in Excel and our close workbook depends on them. Need an exception for the finance team this week.",
    requester: "liam.oconnor@acme.example" },
  { subject: "Zoom add-in missing from Outlook", team: "Software",
    body: "The Zoom scheduling add-in disappeared from the Outlook ribbon after the last update. Reinstalling Zoom didn't bring it back.",
    requester: "sofia.rossi@acme.example" },
];

// A few resolved tickets so the queue looks like a real, lived-in desk.
export const SEED_QUEUE: Ticket[] = [
  { id: "INC-4469", subject: "MFA prompt loop on new phone", body: "", requester: "owen.diaz@acme.example",
    team: "Access Management", status: "resolved", issueKey: "ITSD-118", createdAgo: "2h ago" },
  { id: "INC-4470", subject: "Monitor not detected via dock", body: "", requester: "amy.chen@acme.example",
    team: "Hardware", status: "resolved", issueKey: "ITSD-119", createdAgo: "1h ago" },
];

// Each simulated inbound is a fresh incident number (like a real ticketing
// system) picked at random from the pool, avoiding an immediate repeat, so
// the demo never feels stuck on one ticket.
let lastPoolIdx = -1;
let incidentCounter = 4479;
const teamById: Record<string, string> = {}; // pool team, for the offline mock only

export function nextTicket(): Ticket {
  let i = Math.floor(Math.random() * POOL.length);
  if (POOL.length > 1) while (i === lastPoolIdx) i = Math.floor(Math.random() * POOL.length);
  lastPoolIdx = i;
  const p = POOL[i];
  const id = `INC-${incidentCounter++}`;
  teamById[id] = p.team;
  return { id, subject: p.subject, body: p.body, requester: p.requester, status: "new", createdAgo: "just now" };
}

const RES_ISS = "https://example.oktapreview.com/oauth2/ausEXAMPLEResolveCA1";
const FUL_ISS = "https://example.oktapreview.com/oauth2/ausEXAMPLEFulfillCA1";

// Offline mock resolution the agent "sends" when a case auto-resolves.
function mockResolution(t: Ticket): string {
  const who = t.requester.split("@")[0].split(".")[0];
  const name = who.charAt(0).toUpperCase() + who.slice(1);
  return `Hi ${name}, we resolved "${t.subject}". We applied the standard fix and included step-by-step `
    + `instructions so you can confirm it on your end. This ticket is now closed in Jira. Reply here to reopen it `
    + `if anything is still not working.`;
}

function sequence(t: Ticket): ActivityEvent[] {
  const team = teamById[t.id] || "Software";
  const issueKey = `ITSD-${120 + (incidentCounter % 60)}`;
  // some cases auto-resolve (agent solves + closes), others route to a human
  const auto = Math.random() < 0.5;
  const resolution = auto ? mockResolution(t) : "";
  const jiraEvent: ActivityEvent = auto
    ? { step: "jira_write", actor: "Fulfillment", actorKind: "fulfill", primary: true,
        plain: `Auto-resolved ${issueKey} · replied to ${t.requester} · closed in Jira`,
        tech: "POST customer reply comment, then transition the issue to Done",
        data: { issue_key: issueKey, team, auto_resolved: true, resolution, requester: t.requester, jira_status: "Done" },
        system_log_id: "jira.issue.resolved" }
    : { step: "jira_write", actor: "Fulfillment", actorKind: "fulfill", primary: true,
        plain: `Filed ${issueKey} in Jira · routed to ${team} · 2 comments`,
        tech: "POST /rest/api/3/issue, created, componented, labeled, commented",
        data: { issue_key: issueKey, team, auto_resolved: false }, system_log_id: "jira.issue.created" };
  return [
    { step: "inbound", actor: "Intake", actorKind: "intake", primary: true,
      plain: "Received via intake API", tech: `${t.id} ingested from the external ticketing system` },
    { step: "intake_auth", actor: "Triage", actorKind: "triage",
      plain: "Triage picked up the ticket",
      tech: "Claude reads the ticket. Okta isn't involved yet, that starts at the handoff below." },
    { step: "intake_classify", actor: "Triage", actorKind: "triage", primary: true,
      plain: `Classified as ${team} · routed to the ${team} team`,
      tech: "Claude classified the ticket and selected the destination team",
      data: { department: team } },
    // Hop 1: Triage → Resolution (one agent in the act chain)
    { step: "a2a_exchange", actor: "Triage → Resolution", actorKind: "triage", primary: true,
      plain: "Handed off to Agent 2",
      tech: "Intake Service bootstraps (client_credentials); Triage exchanges that for an id-jag and invokes Resolution, agent → agent.",
      token_claims: {
        sub: "0oaEXAMPLEIntakeSvc1",
        act: { sub: "wlpEXAMPLETriageAgt1", sub_profile: "ai_agent",
               act: { sub: "0oaEXAMPLEIntakeSvc1", sub_profile: "service" } },
        aud: "https://atlas.acme.example/resolution", scp: ["agent.invoke"], iss: RES_ISS,
      },
      system_log_id: "app.oauth2.token.grant.id_jag" },
    { step: "devops_draft", actor: "Resolution", actorKind: "resolve", primary: true,
      plain: auto ? "Assessed the case as self-serviceable, drafted a customer resolution" : "Decided the fix and drafted work notes",
      tech: "Claude drafts the resolution. Resolution has no prod credential, it delegates execution to Fulfillment." },
    // Hop 2: Resolution → Fulfillment (TWO agents in the act chain)
    { step: "a2a_fulfillment", actor: "Resolution → Fulfillment", actorKind: "fulfill", primary: true,
      plain: "Delegated execution to Agent 3",
      tech: "Resolution invokes Fulfillment. The token's act claim now nests BOTH agents, Resolution ← Triage ← Intake Service.",
      token_claims: {
        sub: "0oaEXAMPLEIntakeSvc1",
        act: { sub: "wlpEXAMPLEResolveAg1", sub_profile: "ai_agent",
               act: { sub: "wlpEXAMPLETriageAgt1", sub_profile: "ai_agent",
                      act: { sub: "0oaEXAMPLEIntakeSvc1", sub_profile: "service" } } },
        aud: "https://atlas.acme.example/fulfillment", scp: ["agent.invoke"], iss: FUL_ISS,
      },
      system_log_id: "app.oauth2.token.grant.id_jag" },
    { step: "opa_vault", actor: "Fulfillment", actorKind: "fulfill",
      plain: "Retrieved Jira credential securely",
      tech: "Jira credential released from the Okta OPA vault at runtime (STS vaulted-secret), never stored in agent code",
      system_log_id: "app.credential.vault.access" },
    jiraEvent,
    { step: "done", actor: "Atlas", actorKind: "okta", primary: true,
      plain: auto ? "Case auto-resolved by the agent · customer notified" : `Filed and routed to ${team} for a specialist`,
      data: { auto_resolved: auto },
      tech: "Three agents, each least-privileged. Every hop attributed and revocable." },
  ];
}

export type PipelineResult = { issueKey?: string; issueUrl?: string; team?: string; autoResolved?: boolean; resolution?: string };

// Accumulate result fields as events stream in (works for live + mock alike).
function absorb(result: PipelineResult, e: ActivityEvent) {
  const d = e.data;
  if (!d) return;
  if (d.issue_key) result.issueKey = String(d.issue_key);
  if (d.issue_url) result.issueUrl = String(d.issue_url);
  if (d.team) result.team = String(d.team);
  if ("auto_resolved" in d) result.autoResolved = Boolean(d.auto_resolved);
  if (d.resolution) result.resolution = String(d.resolution);
}

export async function runPipeline(
  ticket: Ticket,
  onEvent: (e: ActivityEvent) => void,
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const result: PipelineResult = {};
  if (ORCH) {
    // Send the ACTUAL ticket so the backend classifies/files what's on screen,
    // not a seed ticket. This is what makes "what you see = what ran" true.
    const qs = new URLSearchParams({ ticket_id: ticket.id, title: ticket.subject, body: ticket.body, requester: ticket.requester });
    const res = await fetch(`${ORCH}/api/run?${qs.toString()}`, { signal });
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
        absorb(result, e);
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
    absorb(result, e);
    await delay(440);
  }
  return result;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
