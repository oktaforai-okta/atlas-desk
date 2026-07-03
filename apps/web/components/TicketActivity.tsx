"use client";

import { motion, AnimatePresence } from "framer-motion";
import { latestByStep, type ActivityEvent } from "@/lib/events";

const ACTOR_COLOR: Record<string, string> = {
  intake: "bg-mute",
  triage: "bg-triage",
  resolve: "bg-resolve",
  okta: "bg-accent",
};

// Generic, per-step display label — same rule as the flow diagrams: static
// text stays "Agent N," the real name only ever reveals via the diagrams'
// hover state or the Token Inspector, never here in the always-visible feed.
const STEP_ACTOR_LABEL: Record<string, string> = {
  inbound: "Intake",
  intake_auth: "Agent 1",
  intake_classify: "Agent 1",
  a2a_exchange: "Agent 1 → Agent 2",
  devops_draft: "Agent 2",
  a2a_fulfillment: "Agent 2 → Agent 3",
  opa_vault: "Agent 3",
  jira_write: "Agent 3",
  done: "Atlas",
};

export default function TicketActivity({ events }: { events: ActivityEvent[] }) {
  // collapse running+ok of the same step; keep only primary (product) lines here
  const rows = Array.from(latestByStep(events).values()).filter((e) => e.primary);

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-[15px] text-mute">
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
                      className={`font-mono text-[13px] ${
                        e.actorKind === "triage" ? "text-triage"
                          : e.actorKind === "resolve" ? "text-resolve"
                          : e.actorKind === "okta" ? "text-accent" : "text-soft"
                      }`}
                    >
                      {STEP_ACTOR_LABEL[e.step] ?? e.actor}
                    </span>
                    {handoff && (
                      <span className="rounded bg-raised px-1.5 py-0.5 text-2xs text-soft ring-1 ring-line">
                        agent → agent
                      </span>
                    )}
                  </div>
                  <div className={`mt-0.5 text-[15px] ${running ? "text-soft" : "text-ink"}`}>
                    {e.plain}
                    {running && <span className="ml-1 text-mute">…</span>}
                  </div>
                  {e.data?.issue_key ? (
                    e.data.issue_url ? (
                      <a
                        href={String(e.data.issue_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-resolve/40 bg-resolve/10 px-2 py-1 font-mono text-[13px] text-resolve hover:bg-resolve/15"
                      >
                        {String(e.data.issue_key)} · open in Jira ↗
                      </a>
                    ) : (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-1 font-mono text-[13px] text-soft">
                        {String(e.data.issue_key)} · demo data, no live issue
                      </span>
                    )
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
