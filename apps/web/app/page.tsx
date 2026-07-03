"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus, ShieldCheck, User, CircleDot, Sparkles, Forward, MailCheck, KeyRound } from "lucide-react";
import AgentFlowGraph from "@/components/AgentFlowGraph";
import TicketActivity from "@/components/TicketActivity";
import {
  runPipeline, nextTicket, captureTokenClaims, captureRawTokens, SEED_QUEUE, ORCH,
  type ActivityEvent, type Ticket,
} from "@/lib/events";

const STATUS_META: Record<Ticket["status"], { label: string; dot: string; text: string }> = {
  new: { label: "New", dot: "bg-accent", text: "text-accent" },
  working: { label: "Working", dot: "bg-warn animate-pulse", text: "text-warn" },
  resolved: { label: "Resolved", dot: "bg-ok", text: "text-ok" },
};

// Once a run finishes, the outcome drives the label: the agent either auto-resolved
// the case or routed it to a human. Falls back to the plain status mid-run / for seeds.
function displayMeta(t: Ticket): { label: string; dot: string; text: string } {
  if (t.outcome === "auto_resolved") return { label: "Auto-resolved", dot: "bg-ok", text: "text-ok" };
  if (t.outcome === "routed") return { label: "Routed", dot: "bg-accent", text: "text-accent" };
  return STATUS_META[t.status];
}

export default function ServiceDesk() {
  const [queue, setQueue] = useState<Ticket[]>(SEED_QUEUE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const selected = queue.find((t) => t.id === selectedId) || null;

  async function simulateInbound() {
    if (running) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const t = nextTicket();
    setQueue((q) => [t, ...q]);
    setSelectedId(t.id);
    setEvents([]);
    setRunning(true);
    setQueue((q) => q.map((x) => (x.id === t.id ? { ...x, status: "working" } : x)));
    // Kept alongside React state (which is a stale closure inside this async
    // function by the time the stream closes) so captureRawTokens sees every
    // event from this run, not just whatever `events` last was on render.
    const collected: ActivityEvent[] = [];
    const res = await runPipeline(t, (e) => {
      collected.push(e);
      setEvents((prev) => [...prev, e]);
      captureTokenClaims(e);
    }, ac.signal);
    captureRawTokens(collected); // bridges this run's raw JWTs over to /tokens
    setQueue((q) =>
      q.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status: res.autoResolved ? "resolved" : "working",
              team: res.team || x.team,
              issueKey: res.issueKey,
              issueUrl: res.issueUrl,
              outcome: res.autoResolved ? "auto_resolved" : "routed",
              resolution: res.resolution,
            }
          : x,
      ),
    );
    setRunning(false);
  }

  return (
    <div className="flex h-screen flex-col">
      {/* header */}
      <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[17px] font-semibold text-bright">Service Desk</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs ${
              ORCH ? "border-ok/30 bg-ok/10 text-ok" : "border-line bg-raised text-mute"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${ORCH ? "bg-ok live-dot" : "bg-mute"}`} />
              {ORCH ? "Live" : "Demo"}
            </span>
          </div>
          <p className="mt-0.5 text-2xs text-mute">Autonomous triage &amp; resolution, secured by Okta</p>
        </div>
        <button
          onClick={simulateInbound}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-accent to-[#5B86E8] px-3.5 py-2 text-[15px] font-medium text-white shadow-[0_2px_12px_-2px_rgba(122,162,255,0.5)] transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
        >
          <Plus className="h-4 w-4" />
          {running ? "Processing…" : "Simulate inbound ticket"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* queue */}
        <div className="w-[340px] shrink-0 overflow-y-auto border-r border-line">
          <div className="px-4 py-3 text-2xs uppercase tracking-wider text-mute">
            Queue · {queue.length}
          </div>
          {queue.map((t) => {
            const m = displayMeta(t);
            const active = t.id === selectedId;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`block w-full border-b border-line/60 px-4 py-3 text-left transition-colors ${
                  active ? "bg-surface" : "hover:bg-surface/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px] text-mute">{t.id}</span>
                  <span className={`flex items-center gap-1.5 text-2xs ${m.text}`}>
                    <span className={`dot ${m.dot}`} /> {m.label}
                  </span>
                </div>
                <div className="mt-1 text-[15px] leading-snug text-ink">{t.subject}</div>
                <div className="mt-1 flex items-center gap-2 text-2xs text-mute">
                  {t.team && <span className="rounded bg-raised px-1.5 py-0.5">{t.team}</span>}
                  <span>{t.createdAgo}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <CircleDot className="h-7 w-7 text-line2" />
              <p className="mt-3 text-[15px] text-mute">
                Select a ticket, or simulate an inbound one
                <br />to watch the agents work it.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-6xl px-8 py-6">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 font-mono text-[13px] text-mute">
                  {selected.id}
                  <span className={`flex items-center gap-1.5 ${displayMeta(selected).text}`}>
                    · <span className={`dot ${displayMeta(selected).dot}`} />
                    {displayMeta(selected).label}
                  </span>
                </div>
                <h2 className="mt-1.5 text-[23px] font-semibold leading-snug text-bright">{selected.subject}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-mute" /> {selected.requester}
                  </span>
                  {selected.team && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-mute">Team</span>
                      <span className="rounded bg-raised px-1.5 py-0.5 text-ink">{selected.team}</span>
                    </span>
                  )}
                  {selected.issueKey && (
                    selected.issueUrl ? (
                      <a
                        href={selected.issueUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-resolve hover:underline"
                      >
                        {selected.issueKey} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-soft">{selected.issueKey}</span>
                    )
                  )}
                </div>

                {selected.body && (
                  <p className="mt-4 rounded-lg border border-line bg-panel px-4 py-3 text-[15px] leading-relaxed text-body">
                    {selected.body}
                  </p>
                )}
              </div>

              {selected.outcome === "auto_resolved" && (
                <div className="mt-5 max-w-3xl rounded-xl border border-ok/30 bg-ok/[0.06] p-4">
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-ok">
                    <Sparkles className="h-4 w-4" /> Auto-resolved by Agent 2
                  </div>
                  <div className="mt-1 text-[13px] text-mute">
                    The agent judged this case self-serviceable, replied to the customer with the fix, and closed it in Jira. No human needed.
                  </div>
                  {selected.resolution && (
                    <div className="mt-3 rounded-lg border border-line bg-panel px-3.5 py-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-2xs uppercase tracking-wider text-mute">
                        <MailCheck className="h-3.5 w-3.5 text-ok" /> Reply sent to {selected.requester}
                      </div>
                      <p className="whitespace-pre-line text-[14px] leading-relaxed text-body">{selected.resolution}</p>
                    </div>
                  )}
                  {selected.issueKey && (
                    <div className="mt-2 text-2xs text-mute">
                      Case closed in Jira ·{" "}
                      {selected.issueUrl ? (
                        <a href={selected.issueUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-resolve hover:underline">{selected.issueKey} ↗</a>
                      ) : (
                        <span className="font-mono">{selected.issueKey}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selected.outcome === "routed" && (
                <div className="mt-5 max-w-3xl rounded-xl border border-accent/30 bg-accent/[0.06] p-4">
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-accent">
                    <Forward className="h-4 w-4" /> Routed to {selected.team} for a specialist
                  </div>
                  <div className="mt-1 text-[13px] text-mute">
                    Not self-serviceable this time. The agents filed it with full work notes and handed it to a human on the {selected.team} team.
                  </div>
                  {selected.issueKey && (
                    <div className="mt-2 text-2xs text-mute">
                      Filed in Jira ·{" "}
                      {selected.issueUrl ? (
                        <a href={selected.issueUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-resolve hover:underline">{selected.issueKey} ↗</a>
                      ) : (
                        <span className="font-mono">{selected.issueKey}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 mb-3 flex items-center gap-2">
                <span className="text-2xs uppercase tracking-wider text-mute">Agent flow</span>
                <span className="h-px flex-1 bg-line" />
                <span className="inline-flex items-center gap-1 text-2xs text-mute">
                  <ShieldCheck className="h-3 w-3 text-ok" /> secured by Okta
                </span>
              </div>
              <AgentFlowGraph events={events.length && selectedId === selected.id ? events : []} />

              {selected.outcome && (
                <Link href="/tokens"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] text-accent transition-colors hover:border-accent/60 hover:bg-accent/5">
                  <KeyRound className="h-3.5 w-3.5" /> Inspect the tokens from this run →
                </Link>
              )}

              <div className="mt-6 mb-3 flex max-w-3xl items-center gap-2">
                <span className="text-2xs uppercase tracking-wider text-mute">Activity</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="max-w-3xl">
                <TicketActivity events={events.length && selectedId === selected.id ? events : []} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
