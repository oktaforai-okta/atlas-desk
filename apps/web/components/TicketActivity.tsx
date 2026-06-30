"use client";

import { motion, AnimatePresence } from "framer-motion";
import { BookOpen } from "lucide-react";
import Link from "next/link";
import type { ActivityEvent } from "@/lib/events";

const ACTOR_COLOR: Record<string, string> = {
  intake: "bg-mute",
  triage: "bg-triage",
  resolve: "bg-resolve",
  okta: "bg-accent",
};

export default function TicketActivity({ events }: { events: ActivityEvent[] }) {
  // collapse running+ok of the same step; keep only primary (product) lines here
  const latest = new Map<string, ActivityEvent>();
  for (const e of events) latest.set(e.step, e);
  const rows = Array.from(latest.values()).filter((e) => e.primary);

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-mute">
        No activity yet.
      </div>
    );
  }

  return (
    <div>
      <div className="relative pl-1">
        <AnimatePresence initial={false}>
          {rows.map((e, i) => {
            const running = e.status === "running";
            const handoff = e.step === "a2a_exchange";
            return (
              <motion.div
                key={e.step}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative flex gap-3 pb-4"
              >
                {/* rail */}
                <div className="relative flex flex-col items-center">
                  <span
                    className={`mt-1 h-2.5 w-2.5 rounded-full ${ACTOR_COLOR[e.actorKind]} ${
                      running ? "ring-4 ring-warn/15 animate-pulse" : ""
                    }`}
                  />
                  {i < rows.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                </div>

                <div className="-mt-0.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-[11px] ${
                        e.actorKind === "triage" ? "text-triage"
                          : e.actorKind === "resolve" ? "text-resolve"
                          : e.actorKind === "okta" ? "text-accent" : "text-soft"
                      }`}
                    >
                      {e.actor}
                    </span>
                    {handoff && (
                      <span className="rounded bg-raised px-1.5 py-0.5 text-2xs text-soft ring-1 ring-line">
                        agent → agent
                      </span>
                    )}
                  </div>
                  <div className={`mt-0.5 text-[13px] ${running ? "text-soft" : "text-ink"}`}>
                    {e.plain}
                    {running && <span className="ml-1 text-mute">…</span>}
                  </div>
                  {e.data?.issue_key ? (
                    <a
                      href="#"
                      className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-resolve/40 bg-resolve/10 px-2 py-1 font-mono text-[11px] text-resolve hover:bg-resolve/15"
                    >
                      {String(e.data.issue_key)} · open in Jira ↗
                    </a>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {rows.some((e) => e.step === "done") && (
        <Link
          href="/how-it-works"
          className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-mute hover:text-accent"
        >
          <BookOpen className="h-3.5 w-3.5" />
          See how Okta secured every hop of this →
        </Link>
      )}
    </div>
  );
}
