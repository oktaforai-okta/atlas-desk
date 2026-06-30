"use client";

import { useRef, useState } from "react";
import { ShieldCheck, Activity, Boxes } from "lucide-react";
import TicketIntake from "@/components/TicketIntake";
import AgentPipeline from "@/components/AgentPipeline";
import ChainOfCustody from "@/components/ChainOfCustody";
import StsPanel from "@/components/StsPanel";
import { runPipeline, nextMockTicket, ORCH, type ChainEvent, type Ticket } from "@/lib/events";

type Mode = "auto" | "sts";

export default function Page() {
  const [mode, setMode] = useState<Mode>("auto");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function onGenerate() {
    if (running) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const t = nextMockTicket();
    setTicket(t);
    setEvents([]);
    setRunning(true);
    try {
      await runPipeline(t, (e) => setEvents((prev) => [...prev, e]), ac.signal);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-5 py-5">
      {/* top bar */}
      <header className="mb-5 flex items-center justify-between border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-signal/40 bg-signal/10 shadow-glow">
            <ShieldCheck className="h-5 w-5 text-signal" />
          </div>
          <div>
            <h1 className="font-display text-[15px] font-semibold tracking-wide text-bright">
              ATLAS <span className="text-signal">IDENTITY OPERATIONS</span> CENTER
            </h1>
            <div className="font-mono text-[10px] text-mute">
              Okta-secured agentic IT support · chain of custody at every hop
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-mute">
            <Boxes className="h-3 w-3 text-identity" /> oktaforai.oktapreview.com
          </span>
          <span className="flex items-center gap-1 rounded border border-line bg-surface px-2 py-1 text-mute">
            <Activity className={`h-3 w-3 ${running ? "text-flight animate-pulse" : "text-signal"}`} />
            {ORCH ? "live" : "demo"}
          </span>
        </div>
      </header>

      {/* mode tabs */}
      <div className="mb-5 flex gap-1.5">
        {([
          { k: "auto", label: "Autonomous · A2A", hint: "no human — machine delegation" },
          { k: "sts", label: "Claude + Bridge · STS", hint: "human consent — on behalf of" },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setMode(t.k as Mode)}
            className={`flex-1 rounded-lg border px-4 py-2.5 text-left transition-all ${
              mode === t.k
                ? "border-identity/60 bg-identity/10 shadow-glow-id"
                : "border-line bg-surface/60 hover:border-edge"
            }`}
          >
            <div className={`font-display text-[13px] ${mode === t.k ? "text-bright" : "text-ink/70"}`}>
              {t.label}
            </div>
            <div className="font-mono text-[10px] text-mute">{t.hint}</div>
          </button>
        ))}
      </div>

      {mode === "auto" ? (
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_400px]">
          {/* left */}
          <div className="space-y-4">
            <TicketIntake ticket={ticket} running={running} onGenerate={onGenerate} />
            <div className="panel-edge rounded-xl p-4">
              <div className="kicker text-mute mb-2">How this is secured</div>
              <ul className="space-y-2 text-[12px] text-ink/80">
                <li className="flex gap-2"><span className="text-agent">▸</span> Triage agent <span className="text-identity">invokes</span> Resolution agent over Okta <span className="text-agent">A2A</span> (no user).</li>
                <li className="flex gap-2"><span className="text-flight">▸</span> Jira credential pulled from the <span className="text-flight">OPA vault</span> at runtime — never in code.</li>
                <li className="flex gap-2"><span className="text-signal">▸</span> Every hop carries an <span className="text-agent">act</span> claim — a verifiable chain of custody.</li>
              </ul>
            </div>
          </div>

          {/* center */}
          <div className="space-y-4">
            <AgentPipeline events={events} />
            <div className="panel-edge rounded-xl p-5">
              <div className="kicker text-mute mb-3">Two patterns · one workflow</div>
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div className="rounded-lg border border-agent/30 bg-agent/5 p-3">
                  <div className="font-display text-bright">Autonomous</div>
                  <div className="mt-1 text-ink/75">No human. Anchored on a machine delegation chain (A2A) + OPA-vaulted credential.</div>
                </div>
                <div className="rounded-lg border border-identity/30 bg-identity/5 p-3">
                  <div className="font-display text-bright">Interactive</div>
                  <div className="mt-1 text-ink/75">Human present. STS brokered consent — the agent acts on the user&apos;s behalf.</div>
                </div>
              </div>
              <div className="mt-3 font-mono text-[11px] text-mute">
                → unattended needs a machine credential · routines a human drives use STS consent
              </div>
            </div>
          </div>

          {/* right */}
          <div className="panel-edge rounded-xl overflow-hidden">
            <ChainOfCustody events={events} />
          </div>
        </div>
      ) : (
        <div className="flex-1">
          <StsPanel />
        </div>
      )}
    </main>
  );
}
