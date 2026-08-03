"use client";

// Chain of custody: one card per credential, in the order they were obtained.
//
// Read top to bottom and the story is legible without any explanation from us:
// Agent 1 gets ticket.read, Agent 1 is refused ticket.write, Agent 1 delegates,
// Agent 2 gets ticket.write. Every card carries the encoded token so a viewer
// can verify it somewhere we do not control.

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Info, ArrowLeft } from "lucide-react";
import TokenCard from "@/components/TokenCard";
import { buildChain, illustrativeChain, isIllustrative, type ChainStep } from "@/lib/chain";
import { readCapturedRun } from "@/lib/events";

export default function TokensPage() {
  // Read on mount rather than during render: sessionStorage does not exist on the
  // server, and seeding state from it directly desynchronises the two renders.
  const [steps, setSteps] = useState<ChainStep[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const captured = readCapturedRun();
    setSteps(captured?.events?.length ? buildChain(captured.events) : illustrativeChain());
    setReady(true);
  }, []);

  const illustrative = !ready || isIllustrative(steps);

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

      {illustrative && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/[0.06] px-3.5 py-3 text-[13px] text-warn">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            These are illustrative examples, not real tokens. Their header says{" "}
            <span className="font-mono">alg: none</span> and their signature segment says
            so in words.{" "}
            <Link href="/" className="underline hover:opacity-80">
              Simulate a ticket
            </Link>{" "}
            to capture a real signed set.
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {steps.map((step) => (
          <TokenCard key={`${step.n}-${step.title}-${step.kind}`} step={step} />
        ))}
      </div>

      <p className="mt-6 max-w-2xl text-[13px] leading-relaxed text-mute">
        Copy any token above, open{" "}
        <a
          href="https://jwt.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          jwt.io
        </a>
        , and paste it into the Encoded field. Check the <span className="font-mono">scp</span>{" "}
        claim against what this page says the agent was allowed to do, and the{" "}
        <span className="font-mono">act</span> claim for who acted on whose authority.
        Nothing here asks you to trust this page.
      </p>

      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to the Service Desk
      </Link>
    </div>
  );
}
