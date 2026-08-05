"use client";

// Chain of custody: one card per credential the run in THIS browser produced.
//
// Nothing is shown before a run, and that was arrived at the long way round.
// Illustrative placeholder tokens made the page look static and fabricated.
// Serving the last run by anyone from the orchestrator fixed that but replaced it
// with a worse question: a viewer who had clicked nothing was handed real
// credentials and reasonably asked whose they were.
//
// A credential belongs to the run that produced it and to the person who watched
// it happen. So: no run, no tokens, and an empty state that says what to do.

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Info, ArrowLeft, ShieldCheck, Play } from "lucide-react";
import TokenCard from "@/components/TokenCard";
import { buildChain, isIllustrative, type ChainStep } from "@/lib/chain";
import { readCapturedRun } from "@/lib/events";

export default function TokensPage() {
  // Read on mount rather than during render: sessionStorage does not exist on the
  // server, and seeding state from it directly desynchronises the two renders.
  const [steps, setSteps] = useState<ChainStep[] | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);

  useEffect(() => {
    const run = readCapturedRun();
    setSteps(run?.events?.length ? buildChain(run.events) : []);
    setCapturedAt(run?.capturedAt ?? null);
  }, []);

  const ready = steps !== null;
  const hasRun = ready && steps.length > 0;
  const illustrative = hasRun && isIllustrative(steps);
  const ago = (() => {
    if (!capturedAt) return null;
    const s = Math.max(0, Math.round((Date.now() - capturedAt) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  })();

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="flex items-center gap-2.5">
        <KeyRound className="h-5 w-5 text-accent" />
        <h1 className="text-[22px] font-semibold text-bright">Chain of custody</h1>
      </div>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-soft">
        Every credential issued during the run, in order. One agent can read. One can
        write. Okta decides which, and refuses when the read-only agent asks for more.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs">
        <span className="rounded-full bg-resolve/10 px-2 py-0.5 font-mono text-resolve">
          ticket.read
        </span>
        <span className="text-mute">Agent 1</span>
        <span className="text-line2">·</span>
        <span className="rounded-full bg-fulfill/10 px-2 py-0.5 font-mono text-fulfill">
          ticket.write
        </span>
        <span className="text-mute">Agent 2 only</span>
      </div>

      {/* Nothing has run in this browser yet. Say so and point at the door, rather
          than filling the space with credentials the viewer did not create. */}
      {ready && !hasRun && (
        <div className="mt-8 rounded-xl border border-dashed border-line bg-panel px-6 py-12 text-center">
          <KeyRound className="mx-auto h-7 w-7 text-line2" />
          <h2 className="mt-3 text-[17px] font-semibold text-ink">No run yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-mute">
            Tokens appear here once you run the pipeline. They are the real credentials
            from your own run, so there is nothing to show until there has been one.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-accent to-[#5B86E8] px-3.5 py-2 text-[15px] font-medium text-white shadow-[0_2px_12px_-2px_rgba(122,162,255,0.5)] transition hover:brightness-110"
          >
            <Play className="h-4 w-4" /> Run a simulation
          </Link>
        </div>
      )}

      {hasRun && (
        <>
          {illustrative ? (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/[0.06] px-3.5 py-3 text-[13px] text-warn">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Your run produced unsigned demo tokens, because the orchestrator is not
                configured against a live Okta tenant. Their header says{" "}
                <span className="font-mono">alg: none</span> and their signature segment
                says so in words. The shapes are real; the signatures are not.
              </div>
            </div>
          ) : (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/[0.06] px-3.5 py-3 text-[13px] text-ok">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Real Okta-issued tokens, signed <span className="font-mono">RS256</span>,
                from your run{ago ? ` (${ago})` : ""}.
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {steps.map((step) => (
              <TokenCard key={`${step.n}-${step.title}-${step.kind}`} step={step} />
            ))}
          </div>

          <p className="mt-6 max-w-2xl text-[13px] leading-relaxed text-mute">
            Open any token in{" "}
            <a
              href="https://jwt.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              jwt.io
            </a>
            , then check the <span className="font-mono">scp</span> claim against what
            this page says the agent was allowed to do, and the{" "}
            <span className="font-mono">act</span> claim for who acted on whose
            authority. Nothing here asks you to trust this page.
          </p>
        </>
      )}

      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to the Service Desk
      </Link>
    </div>
  );
}
