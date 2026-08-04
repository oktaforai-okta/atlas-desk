// Activity model. The same events drive two surfaces:
//  - Service Desk (main): product-friendly `plain` lines, the work as it happens.
//  - Chain of custody (/tokens): the credential obtained at each step.
// An offline mock keeps the app demoable; it flips to live SSE when
// NEXT_PUBLIC_ORCHESTRATOR_URL is set.

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
  raw_tokens?: Record<string, string> | null; // {label: compact JWT}
  system_log_id?: string | null;
  data?: Record<string, unknown>;
  status?: Status;
  ts?: number;
}

// "Last event per step wins", since each step arrives twice (running, then ok).
export function latestByStep(events: ActivityEvent[]): Map<string, ActivityEvent> {
  const latest = new Map<string, ActivityEvent>();
  for (const e of events) latest.set(e.step, e);
  return latest;
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
  outcome?: "auto_resolved" | "routed" | "blocked"; // set once the run finishes
  resolution?: string;                   // customer reply the agent sent
  blockedError?: string;                 // Okta error code, when a run was blocked
  createdAgo: string;
}

export const ORCH = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "";

/** The two narratives. `normal` gets the work done by delegating; `violation` has
 *  the read-only agent try to write, get refused by Okta, and stop. Keeping them
 *  separate is the point: a refusal shown on every run reads as decoration. */
export type RunMode = "normal" | "violation";

// ---------------------------------------------------------------------------
// Bridge a completed run over to /tokens, which is a separate page and so loses
// component state on navigation. Stores the raw events; /tokens derives the
// chain from them (see lib/chain.ts) rather than this module guessing a shape.

export const RUN_KEY = "atlas:lastRun";

export interface CapturedRun {
  events: ActivityEvent[];
  capturedAt: number;
}

export function captureRun(events: ActivityEvent[]) {
  if (typeof window === "undefined") return;
  // only steps that carry credentials or a denial matter downstream; keeping the
  // payload small avoids the ~5MB sessionStorage ceiling on long sessions
  const keep = events.filter(
    (e) => e.raw_tokens || e.data?.denied || e.step === "write_denied"
      || e.step === "blocked",
  );
  if (!keep.length) return;
  try {
    const payload: CapturedRun = { events: keep, capturedAt: Date.now() };
    window.sessionStorage.setItem(RUN_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage unavailable; /tokens falls back to illustrative examples
  }
}

export function readCapturedRun(): CapturedRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CapturedRun;
    return Array.isArray(parsed?.events) ? parsed : null;
  } catch {
    return null;
  }
}

/** The orchestrator's most recent run.
 *
 *  sessionStorage is per-tab, so it only ever helps the tab that ran the pipeline.
 *  Anyone following a shared link, opening a second tab, or returning later would
 *  see illustrative placeholders and reasonably conclude the page is static. This
 *  asks the backend instead, so the credentials shown are real for everybody. */
export async function fetchLastRun(): Promise<CapturedRun | null> {
  if (!ORCH) return null;
  try {
    const res = await fetch(`${ORCH}/api/last-run`);
    if (!res.ok) return null;
    const j = (await res.json()) as { events?: ActivityEvent[]; captured_at?: number };
    if (!Array.isArray(j?.events) || j.events.length === 0) return null;
    return { events: j.events, capturedAt: (j.captured_at ?? 0) * 1000 };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

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
  { subject: "Need admin role on the Payments Jira project", team: "Access Management",
    body: "I'm the new lead for Payments but only have contributor access in Jira. Need project-admin to manage the board and workflows.",
    requester: "kofi.mensah@acme.example" },
  { subject: "External monitor flickers on the new dock", team: "Hardware",
    body: "My 4K monitor flickers every few seconds through the new USB-C dock, but is fine plugged in directly. Swapped the cable, no change.",
    requester: "diego.romero@acme.example" },
  { subject: "Excel macros disabled by policy during finance close", team: "Software",
    body: "Group policy is blocking macros in Excel and our close workbook depends on them. Need an exception for the finance team this week.",
    requester: "liam.oconnor@acme.example" },
  { subject: "Zoom add-in missing from Outlook", team: "Software",
    body: "The Zoom scheduling add-in disappeared from the Outlook ribbon after the last update. Reinstalling Zoom didn't bring it back.",
    requester: "sofia.rossi@acme.example" },
  { subject: "Webcam not detected after BIOS update", team: "Hardware",
    body: "After the firmware update pushed last night, the built-in webcam is gone from Device Manager. I have client calls all day.",
    requester: "ava.nguyen@acme.example" },
];

// A few resolved tickets so the queue looks like a real, lived-in desk.
export const SEED_QUEUE: Ticket[] = [
  { id: "INC-4469", subject: "MFA prompt loop on new phone", body: "", requester: "owen.diaz@acme.example",
    team: "Access Management", status: "resolved", issueKey: "ITSD-118", createdAgo: "2h ago" },
  { id: "INC-4470", subject: "Monitor not detected via dock", body: "", requester: "amy.chen@acme.example",
    team: "Hardware", status: "resolved", issueKey: "ITSD-119", createdAgo: "1h ago" },
];

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

const READ = "ticket.read";
const WRITE = "ticket.write";

/** Offline stand-in for Claude's judgement, matching the backend's demo heuristic:
 *  physical and entitlement problems need a human, settings problems do not. */
function mockSelfServiceable(t: Ticket): boolean {
  const s = `${t.subject} ${t.body}`.toLowerCase();
  const needsHuman = ["won't power", "blink", "replace", "keyboard", "dock", "monitor",
    "webcam", "hardware", "broken", "access", "permission", "admin role", "not a member",
    "shared drive"];
  return !needsHuman.some((k) => s.includes(k));
}

function mockResolution(t: Ticket): string {
  const who = t.requester.split("@")[0].split(".")[0];
  const name = who.charAt(0).toUpperCase() + who.slice(1);
  return `Hi ${name}, we resolved "${t.subject}". We applied the standard fix and included step-by-step `
    + `instructions so you can confirm it on your end. This ticket is now closed in Jira. Reply here to reopen it `
    + `if anything is still not working.`;
}

/** Mirrors the backend's step list exactly, so demo and live stay in lockstep. */
function sequence(t: Ticket, mode: RunMode = "normal"): ActivityEvent[] {
  const team = teamById[t.id] || "Software";
  const issueKey = `ITSD-${120 + (incidentCounter % 60)}`;
  const auto = mockSelfServiceable(t);
  const resolution = auto ? mockResolution(t) : "";
  const shared: ActivityEvent[] = [
    { step: "inbound", actor: "Intake", actorKind: "intake", primary: true,
      plain: "Received via intake API", tech: `${t.id} ingested from the external ticketing system` },
    { step: "read_grant", actor: "Agent 1", actorKind: "triage", primary: true,
      plain: `Granted read access · ${READ}`,
      tech: "The Intake Service bootstraps the chain (client_credentials, the one grant an agent may not use) and Agent 1 receives a read-only token.",
      data: { scope: READ }, system_log_id: "app.oauth2.token.grant" },
    { step: "jira_read", actor: "Agent 1", actorKind: "triage", primary: true,
      plain: "Checked for duplicates · 1 similar ticket open",
      tech: `GET /rest/api/3/search, authorized by ${READ}`,
      data: { scope: READ } },
    { step: "classify", actor: "Agent 1", actorKind: "triage", primary: true,
      plain: `Classified as ${team} · routed to the ${team} team`,
      tech: "Claude classified the ticket and judged whether it is self-serviceable",
      data: { department: team, self_serviceable: auto } },
  ];

  // VIOLATION: the read-only agent asks for write authority and is refused. The
  // run ends there, so nothing is filed. Mirrors the backend branch.
  if (mode === "violation") {
    return [...shared,
      { step: "write_denied", actor: "Agent 1", actorKind: "triage", primary: true,
        plain: `Refused by Okta · Agent 1 cannot hold ${WRITE}`,
        tech: `Agent 1 asked Okta for ${WRITE} and was refused. Its connection permits the read scope and nothing else.`,
        data: { denied: true, http_status: 400, error: "invalid_scope",
          error_description: `The following scopes are not allowed for this request: [${WRITE}].`,
          attempted_scope: WRITE },
        system_log_id: "app.oauth2.as.consent.grant.deny" },
      { step: "blocked", actor: "Atlas", actorKind: "okta", primary: true,
        plain: "Stopped by policy · nothing was written",
        data: { blocked: true, wrote_to_jira: false, attempted_scope: WRITE,
          error: "invalid_scope" },
        tech: "The ticket was never filed. Agent 1 held read authority only, so no credential existed to perform the write it attempted." },
    ];
  }

  // NORMAL: the work gets done, by delegating rather than over-reaching.
  return [...shared,
    { step: "a2a_delegate", actor: "Agent 1 → Agent 2", actorKind: "triage", primary: true,
      plain: "Delegated to the write-capable agent",
      tech: "The act claim records that Agent 1 initiated this, so the eventual write stays attributable to it.",
      data: { scope: READ }, system_log_id: "app.oauth2.token.grant.id_jag" },
    { step: "write_grant", actor: "Agent 2", actorKind: "fulfill", primary: true,
      plain: `Granted write access · ${WRITE}`,
      tech: "Agent 2 is the only client authorized on the write authorization server, so only Agent 2 can obtain this scope.",
      data: { scope: WRITE }, system_log_id: "app.oauth2.token.grant.id_jag" },
    { step: "draft", actor: "Agent 2", actorKind: "resolve", primary: true,
      plain: auto ? "Assessed the case as self-serviceable, drafted a customer resolution"
                  : "Decided the fix and drafted work notes",
      tech: "Claude drafted the reply", data: { self_serviceable: auto } },
    { step: "opa_vault", actor: "Agent 2", actorKind: "fulfill",
      plain: "Released the Jira credential",
      tech: "Vaulted-secret exchange against Okta Privileged Access, authorized by Agent 2's own inbound delegated token",
      system_log_id: "app.credential.vault.access" },
    { step: "jira_write", actor: "Agent 2", actorKind: "fulfill", primary: true,
      plain: auto ? `Auto-resolved ${issueKey} · replied to ${t.requester} · closed in Jira`
                  : `Filed ${issueKey} · routed to ${team} · 2 comments`,
      tech: `POST /rest/api/3/issue authorized by ${WRITE}`,
      data: { issue_key: issueKey, team, auto_resolved: auto, resolution,
        requester: t.requester, scope: WRITE },
      system_log_id: auto ? "jira.issue.resolved" : "jira.issue.created" },
    { step: "done", actor: "Atlas", actorKind: "okta", primary: true,
      plain: auto ? "Case auto-resolved by the agent · customer notified"
                  : `Filed and routed to ${team} for a specialist`,
      data: { auto_resolved: auto },
      tech: "One agent could read. One could write. Okta decided which." },
  ];
}

export type PipelineResult = {
  issueKey?: string; issueUrl?: string; team?: string;
  autoResolved?: boolean; resolution?: string; failed?: boolean;
  /** the violation path was stopped by Okta policy; nothing was written */
  blocked?: boolean;
  blockedError?: string;
};

// Accumulate result fields as events stream in (works for live + mock alike).
function absorb(result: PipelineResult, e: ActivityEvent) {
  const d = e.data;
  if (!d) return;
  if (d.issue_key) result.issueKey = String(d.issue_key);
  if (d.issue_url) result.issueUrl = String(d.issue_url);
  if (d.team) result.team = String(d.team);
  if ("auto_resolved" in d) result.autoResolved = Boolean(d.auto_resolved);
  if (d.resolution) result.resolution = String(d.resolution);
  if (d.blocked) {
    result.blocked = true;
    if (d.error) result.blockedError = String(d.error);
  }
}

export async function runPipeline(
  ticket: Ticket,
  onEvent: (e: ActivityEvent) => void,
  signal?: AbortSignal,
  mode: RunMode = "normal",
): Promise<PipelineResult> {
  const result: PipelineResult = {};
  if (ORCH) {
    // Send the ACTUAL ticket so the backend classifies/files what's on screen,
    // not a seed ticket. This is what makes "what you see = what ran" true.
    const qs = new URLSearchParams({
      ticket_id: ticket.id, title: ticket.subject,
      body: ticket.body, requester: ticket.requester, mode,
    });
    const res = await fetch(`${ORCH}/api/run?${qs.toString()}`, { signal });
    if (!res.ok || !res.body) {
      // surfaced as a pipeline error rather than thrown, so the caller's finally
      // is not the only thing standing between a 502 and a wedged UI
      onEvent({
        step: "error", actor: "Atlas", actorKind: "okta", status: "error", primary: true,
        plain: `Orchestrator returned HTTP ${res.status}`,
        tech: res.status === 429
          ? "Rate limited. The run endpoint allows a limited number of runs per window."
          : "The orchestrator could not be reached or returned an error.",
      });
      result.failed = true;
      return result;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let e: ActivityEvent;
        try {
          e = JSON.parse(line.slice(6));
        } catch {
          continue; // a partial or malformed frame must not kill the stream
        }
        if (e.step === "error") result.failed = true;
        absorb(result, e);
        onEvent(e);
      }
    }
    return result;
  }
  for (const e of sequence(ticket, mode)) {
    if (signal?.aborted) return result;
    onEvent({ ...e, status: "running", ts: Date.now() });
    await delay(340);
    if (signal?.aborted) return result;
    onEvent({ ...e, status: "ok", ts: Date.now() });
    absorb(result, e);
    await delay(400);
  }
  return result;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
