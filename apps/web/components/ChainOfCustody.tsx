"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, KeyRound, ArrowLeftRight, Fingerprint, FileCheck2, Radio, Cpu, Lock } from "lucide-react";
import type { ChainEvent } from "@/lib/events";

const ICON: Record<string, any> = {
  inbound: Radio,
  intake_auth: Fingerprint,
  intake_classify: Cpu,
  a2a_exchange: ArrowLeftRight,
  devops_receive: ShieldCheck,
  opa_vault: KeyRound,
  devops_draft: Cpu,
  jira_write: FileCheck2,
  done: Lock,
};

const ACCENT: Record<string, string> = {
  a2a_exchange: "text-agent",
  opa_vault: "text-flight",
  jira_write: "text-signal",
  done: "text-signal",
};

function TokenJSON({ claims }: { claims: Record<string, unknown> }) {
  const render = (obj: Record<string, unknown>, depth = 0): JSX.Element[] =>
    Object.entries(obj).map(([k, v]) => {
      const isAct = k === "act";
      const pad = { paddingLeft: depth * 14 };
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return (
          <div key={k} style={pad}>
            <span className={isAct ? "tok-act font-bold" : "tok-key"}>&quot;{k}&quot;</span>
            <span className="tok-punc">: {"{"}</span>
            <div className={isAct ? "rounded bg-agent/10 ring-1 ring-agent/30 my-0.5" : ""}>
              {render(v as Record<string, unknown>, depth + 1)}
            </div>
            <span className="tok-punc" style={pad}>{"}"}</span>
          </div>
        );
      }
      const val = Array.isArray(v) ? `[${v.map((x) => `"${x}"`).join(", ")}]` : `"${String(v)}"`;
      return (
        <div key={k} style={pad}>
          <span className="tok-key">&quot;{k}&quot;</span>
          <span className="tok-punc">: </span>
          <span className="tok-str">{val}</span>
        </div>
      );
    });
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-void/70 p-2.5 font-mono text-[11px] leading-relaxed">
      <span className="tok-punc">{"{"}</span>
      <div className="pl-1">{render(claims, 1)}</div>
      <span className="tok-punc">{"}"}</span>
    </pre>
  );
}

export default function ChainOfCustody({ events }: { events: ChainEvent[] }) {
  // collapse running+ok of the same step into the latest
  const latest = new Map<string, ChainEvent>();
  for (const e of events) latest.set(e.step, e);
  const rows = Array.from(latest.values());

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="kicker text-signal">Chain of Custody</div>
          <div className="font-display text-sm text-bright">Verifiable delegation trace</div>
        </div>
        <ShieldCheck className="h-4 w-4 text-signal" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {rows.length === 0 && (
          <div className="mt-16 text-center font-mono text-xs text-mute">
            awaiting signal…<br />generate a ticket to trace the chain
          </div>
        )}
        <div className="relative">
          {rows.length > 0 && <div className="absolute left-[15px] top-2 bottom-2 w-px bg-line" />}
          <AnimatePresence initial={false}>
            {rows.map((e) => {
              const Icon = ICON[e.step] || Radio;
              const running = e.status === "running";
              const accent = ACCENT[e.step] || "text-identity";
              return (
                <motion.div
                  key={e.step}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative mb-4 pl-9"
                >
                  <div
                    className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border bg-surface ${
                      running
                        ? "border-flight/60 shadow-glow-amber animate-pulseEdge"
                        : "border-line"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${running ? "text-flight" : accent}`} />
                  </div>
                  <div className="panel-edge rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-[13px] text-bright">{e.label}</span>
                      <span
                        className={`kicker rounded px-1.5 py-0.5 ${
                          running ? "bg-flight/15 text-flight" : "bg-signal/15 text-signal"
                        }`}
                      >
                        {running ? "···" : "ok"}
                      </span>
                    </div>
                    {e.identity && (
                      <div className="mt-1 font-mono text-[11px] text-identity break-all">{e.identity}</div>
                    )}
                    {e.detail && <div className="mt-1 text-[12px] text-ink/80">{e.detail}</div>}
                    {e.token_claims && <TokenJSON claims={e.token_claims} />}
                    {e.system_log_id && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded border border-line bg-void/50 px-1.5 py-0.5 font-mono text-[10px] text-mute">
                        <span className="text-signal">●</span> System Log · {e.system_log_id}
                      </div>
                    )}
                    {e.data?.issue_key ? (
                      <a
                        className="mt-2 ml-2 inline-flex items-center gap-1 rounded border border-signal/40 bg-signal/10 px-1.5 py-0.5 font-mono text-[10px] text-signal hover:bg-signal/20"
                        href="#"
                      >
                        {String(e.data.issue_key)} ↗
                      </a>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
