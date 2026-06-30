"use client";

import { motion } from "framer-motion";
import { Radio, Bot, ArrowLeftRight, ShieldCheck, FileCheck2 } from "lucide-react";
import type { ChainEvent } from "@/lib/events";

const NODES = [
  { key: "inbound", label: "Inbound API", sub: "external ticket", icon: Radio, steps: ["inbound"] },
  { key: "triage", label: "Atlas Triage", sub: "classify · route", icon: Bot, steps: ["intake_auth", "intake_classify"] },
  { key: "a2a", label: "A2A Exchange", sub: "act-claim handoff", icon: ArrowLeftRight, steps: ["a2a_exchange"] },
  { key: "resolution", label: "Atlas Resolution", sub: "vault · draft", icon: ShieldCheck, steps: ["devops_receive", "opa_vault", "devops_draft"] },
  { key: "jira", label: "Jira", sub: "issue filed", icon: FileCheck2, steps: ["jira_write", "done"] },
];

function nodeState(steps: string[], events: ChainEvent[]): "idle" | "active" | "done" {
  const seen = events.filter((e) => steps.includes(e.step));
  if (seen.length === 0) return "idle";
  if (seen.some((e) => e.status === "running")) return "active";
  const allOk = steps.every((s) => events.some((e) => e.step === s && e.status === "ok"));
  return allOk ? "done" : "active";
}

export default function AgentPipeline({ events }: { events: ChainEvent[] }) {
  return (
    <div className="panel-edge rounded-xl p-5">
      <div className="kicker text-mute mb-4">Autonomous pipeline · machine-to-machine</div>
      <div className="flex items-stretch gap-1.5">
        {NODES.map((n, i) => {
          const st = nodeState(n.steps, events);
          const Icon = n.icon;
          const isA2A = n.key === "a2a";
          const ring =
            st === "active"
              ? isA2A ? "border-agent/70 shadow-[0_0_24px_-4px_rgba(155,124,255,0.6)]" : "border-flight/70 shadow-glow-amber"
              : st === "done"
              ? "border-signal/50 shadow-glow"
              : "border-line";
          const ic =
            st === "active" ? (isA2A ? "text-agent" : "text-flight")
            : st === "done" ? "text-signal" : "text-mute";
          return (
            <div key={n.key} className="flex flex-1 items-center">
              <motion.div
                animate={st === "active" ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                transition={{ repeat: st === "active" ? Infinity : 0, duration: 1.4 }}
                className={`flex-1 rounded-lg border bg-surface/80 px-2 py-3 text-center transition-colors ${ring}`}
              >
                <Icon className={`mx-auto h-5 w-5 ${ic}`} />
                <div className="mt-1.5 font-display text-[12px] text-bright leading-tight">{n.label}</div>
                <div className="font-mono text-[9px] text-mute">{n.sub}</div>
              </motion.div>
              {i < NODES.length - 1 && (
                <div className="relative mx-1 h-px w-5 shrink-0 bg-edge">
                  <div
                    className={`absolute inset-0 ${
                      nodeState(NODES[i + 1].steps, events) !== "idle"
                        ? "bg-signal animate-pulseEdge"
                        : ""
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
