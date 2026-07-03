"use client";

// jwt.io-style chrome around a decoded header/payload: a JSON <-> Claims
// Breakdown toggle, copy, and expand — restyled to this app's dark theme and
// color conventions instead of jwt.io's light one.

import { useState, type ReactNode } from "react";
import { Copy, Check, Maximize2, X } from "lucide-react";
import ClaimsBreakdown from "@/components/ClaimsBreakdown";

export default function DecodedCard({ title, claims, jsonView }: {
  title: string;
  claims: Record<string, unknown>;
  jsonView: ReactNode;
}) {
  const [view, setView] = useState<"json" | "breakdown">("json");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(claims, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable, the values are still visible to select manually
    }
  }

  const body = view === "json" ? jsonView : <ClaimsBreakdown claims={claims} />;

  return (
    <div>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-mute">{title}</p>
      <div className="card-quiet overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-2.5 py-2">
          <div className="flex items-center gap-1 rounded-md bg-raised p-0.5">
            {(["json", "breakdown"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`rounded px-2.5 py-1 text-2xs font-medium transition-colors ${
                  view === v ? "bg-panel text-ink" : "text-mute hover:text-soft"
                }`}
              >
                {v === "json" ? "JSON" : "Claims Breakdown"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={copy} title="Copy JSON"
              className="rounded p-1.5 text-mute transition-colors hover:bg-raised hover:text-ink">
              {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => setExpanded(true)} title="Expand"
              className="rounded p-1.5 text-mute transition-colors hover:bg-raised hover:text-ink">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto p-3">{body}</div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setExpanded(false)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl border border-line bg-panel p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-bright">{title}</p>
              <button type="button" onClick={() => setExpanded(false)}
                className="rounded p-1 text-mute hover:bg-raised hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            {body}
          </div>
        </div>
      )}
    </div>
  );
}
