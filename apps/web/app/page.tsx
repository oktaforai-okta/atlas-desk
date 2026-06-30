"use client";

import { useRef, useState } from "react";
import { Plus, ShieldCheck, User, CircleDot } from "lucide-react";
import TicketActivity from "@/components/TicketActivity";
import {
  runPipeline, nextTicket, SEED_QUEUE, ORCH,
  type ActivityEvent, type Ticket,
} from "@/lib/events";

const STATUS_META: Record<Ticket["status"], { label: string; dot: string; text: string }> = {
  new: { label: "New", dot: "bg-accent", text: "text-accent" },
  working: { label: "Working", dot: "bg-warn animate-pulse", text: "text-warn" },
  resolved: { label: "Resolved", dot: "bg-ok", text: "text-ok" },
};

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
    const res = await runPipeline(t, (e) => setEvents((prev) => [...prev, e]), ac.signal);
    setQueue((q) =>
      q.map((x) =>
        x.id === t.id ? { ...x, status: "resolved", team: res.team || x.team, issueKey: res.issueKey } : x,
      ),
    );
    setRunning(false);
  }

  return (
    <div className="flex h-screen flex-col">
      {/* header */}
      <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <div>
          <h1 className="text-[15px] font-semibold text-bright">Service Desk</h1>
          <p className="text-2xs text-mute">
            Autonomous triage &amp; resolution · {ORCH ? "live" : "demo data"}
          </p>
        </div>
        <button
          onClick={simulateInbound}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
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
            const m = STATUS_META[t.status];
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
                  <span className="font-mono text-[11px] text-mute">{t.id}</span>
                  <span className={`flex items-center gap-1.5 text-2xs ${m.text}`}>
                    <span className={`dot ${m.dot}`} /> {m.label}
                  </span>
                </div>
                <div className="mt-1 text-[13px] leading-snug text-ink">{t.subject}</div>
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
              <p className="mt-3 text-[13px] text-mute">
                Select a ticket, or simulate an inbound one
                <br />to watch the agents work it.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl px-8 py-6">
              <div className="flex items-center gap-2 font-mono text-[11px] text-mute">
                {selected.id}
                <span className={`flex items-center gap-1.5 ${STATUS_META[selected.status].text}`}>
                  · <span className={`dot ${STATUS_META[selected.status].dot}`} />
                  {STATUS_META[selected.status].label}
                </span>
              </div>
              <h2 className="mt-1.5 text-[19px] font-semibold leading-snug text-bright">{selected.subject}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-soft">
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
                  <a href="#" className="font-mono text-resolve hover:underline">
                    {selected.issueKey} ↗
                  </a>
                )}
              </div>

              {selected.body && (
                <p className="mt-4 rounded-lg border border-line bg-panel px-4 py-3 text-[13px] leading-relaxed text-body">
                  {selected.body}
                </p>
              )}

              <div className="mt-6 mb-3 flex items-center gap-2">
                <span className="text-2xs uppercase tracking-wider text-mute">Activity</span>
                <span className="h-px flex-1 bg-line" />
                <span className="inline-flex items-center gap-1 text-2xs text-mute">
                  <ShieldCheck className="h-3 w-3 text-ok" /> secured by Okta
                </span>
              </div>

              <TicketActivity events={events.length && selectedId === selected.id ? events : []} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
