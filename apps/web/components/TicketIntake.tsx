"use client";

import { motion } from "framer-motion";
import { Zap, User } from "lucide-react";
import type { Ticket } from "@/lib/events";

export default function TicketIntake({
  ticket,
  running,
  onGenerate,
}: {
  ticket: Ticket | null;
  running: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="panel-edge rounded-xl p-4">
      <div className="kicker text-mute mb-3">Ticket intake</div>
      <button
        onClick={onGenerate}
        disabled={running}
        className="group flex w-full items-center justify-center gap-2 rounded-lg border border-identity/50 bg-identity/10 px-4 py-3 font-display text-sm text-bright transition-all hover:bg-identity/20 hover:shadow-glow-id disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Zap className={`h-4 w-4 text-identity ${running ? "animate-pulse" : "group-hover:scale-110 transition-transform"}`} />
        {running ? "Processing…" : "Generate Ticket"}
      </button>

      {ticket && (
        <motion.div
          key={ticket.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-lg border border-line bg-void/60 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-flight">{ticket.id}</span>
            <span className="kicker rounded bg-surface px-1.5 py-0.5 text-mute">inbound</span>
          </div>
          <div className="mt-1.5 font-display text-[13px] leading-snug text-bright">{ticket.title}</div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink/75">{ticket.body}</p>
          <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-mute">
            <User className="h-3 w-3" /> {ticket.reporter}
          </div>
        </motion.div>
      )}
    </div>
  );
}
