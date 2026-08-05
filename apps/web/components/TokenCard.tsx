"use client";

// One credential, one card: encoded string, Copy, jwt.io, and a decoded view
// that is collapsed by default.
//
// The ordering is deliberate. A decoded view rendered by this app proves nothing,
// because this app drew it; the encoded string handed to a tool we do not control
// is the proof. So the encoded box and the jwt.io link stay primary, and the
// parsed claims are a convenience tucked behind a disclosure rather than the
// headline.
//
// The jwt.io link pre-loads the token via the URL fragment, which browsers do not
// transmit to the server. jwt.io therefore parses it locally and never receives a
// request containing the credential.

import { useState } from "react";
import { Copy, Check, ExternalLink, ShieldOff, ChevronRight } from "lucide-react";
import { decodeToken, formatClaims, jwtIoUrl, type ChainStep } from "@/lib/chain";

function DecodedBlock({ label, json }: { label: string; json: string }) {
  return (
    <div>
      <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-mute">
        {label}
      </div>
      <pre className="overflow-x-auto rounded-lg border border-line bg-[var(--code-bg)] p-3 font-mono text-[11px] leading-relaxed text-soft">
        {json}
      </pre>
    </div>
  );
}

const KIND_STYLE: Record<ChainStep["kind"], string> = {
  "Access Token": "border-accent/40 text-accent",
  "ID-JAG": "border-triage/40 text-triage",
  Denied: "border-bad/40 text-bad",
};

function shorten(id?: string): string {
  if (!id) return "";
  return id.length > 28 ? `${id.slice(0, 25)}…` : id;
}

export default function TokenCard({ step }: { step: ChainStep }) {
  const [copied, setCopied] = useState<"token" | "error" | null>(null);
  const [open, setOpen] = useState(false);
  const decoded = step.token ? decodeToken(step.token) : null;

  async function copy(text: string, what: "token" | "error") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard blocked (insecure context / permissions); the text is
      // selectable in the page, so this is a convenience failure only
    }
  }

  const denied = step.kind === "Denied";

  return (
    <div
      className={`rounded-xl border bg-panel p-4 ${
        denied ? "border-bad/30 bg-bad/[0.04]" : "border-line"
      }`}
    >
      {/* header: who → whom, what kind, what scope */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-2xs text-mute">
          {step.n}
        </span>
        <span className="text-[15px] font-semibold text-bright">{step.title}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-2xs ${KIND_STYLE[step.kind]}`}
        >
          {step.kind}
        </span>
        {step.scope && (
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-2xs ${
              denied
                ? "bg-bad/10 text-bad line-through"
                : step.scope.endsWith(".write")
                  ? "bg-fulfill/10 text-fulfill"
                  : "bg-resolve/10 text-resolve"
            }`}
          >
            scp: {step.scope}
          </span>
        )}
      </div>

      {/* the chain of custody itself: principal ids, not friendly names */}
      {(step.caller || step.callee) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-2xs text-mute">
          <span title={step.caller}>{shorten(step.caller)}</span>
          <span className="text-line2">{denied ? "⨯" : "→"}</span>
          <span title={step.callee}>{shorten(step.callee)}</span>
        </div>
      )}

      <p className="mt-2 text-[13px] leading-relaxed text-soft">{step.purpose}</p>

      {/* denial: Okta's own words, copyable */}
      {denied && step.denial && (
        <div className="mt-3 rounded-lg border border-bad/30 bg-[var(--code-bg)] p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-bad">
              <ShieldOff className="h-3.5 w-3.5" /> Refused by Okta
            </span>
            <button
              type="button"
              onClick={() =>
                copy(
                  `HTTP ${step.denial?.httpStatus ?? ""} ${step.denial?.error ?? ""}\n${
                    step.denial?.description ?? ""
                  }`,
                  "error",
                )
              }
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-2xs text-soft transition-colors hover:border-accent/60 hover:text-accent"
            >
              {copied === "error" ? (
                <Check className="h-3 w-3 text-ok" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied === "error" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="font-mono text-[12px] leading-relaxed text-bad/90">
            HTTP {step.denial.httpStatus} · {step.denial.error}
          </div>
          <div className="mt-1 font-mono text-[12px] leading-relaxed text-mute [overflow-wrap:anywhere]">
            {step.denial.description}
          </div>
        </div>
      )}

      {/* the token: encoded, copyable, exportable */}
      {step.token && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-mute">
              Encoded
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => copy(step.token!, "token")}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-2xs text-soft transition-colors hover:border-accent/60 hover:text-accent"
              >
                {copied === "token" ? (
                  <Check className="h-3 w-3 text-ok" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied === "token" ? "Copied" : "Copy"}
              </button>
              <a
                href={jwtIoUrl(step.token)}
                target="_blank"
                rel="noopener noreferrer"
                title="Opens jwt.io with this token already loaded. The token travels in the URL fragment, which is never sent to jwt.io's server."
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-2xs text-soft transition-colors hover:border-accent/60 hover:text-accent"
              >
                <ExternalLink className="h-3 w-3" /> Open in jwt.io
              </a>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-[var(--code-bg)] p-3 font-mono text-[11px] leading-relaxed text-resolve/90 [overflow-wrap:anywhere]">
            {step.token}
          </div>

          {decoded && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 text-2xs text-mute transition-colors hover:text-soft"
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                />
                {open ? "Hide decoded" : "Show decoded"}
              </button>
              {open && (
                <div className="mt-2 space-y-2">
                  <DecodedBlock label="Header" json={JSON.stringify(decoded.header, null, 2)} />
                  <DecodedBlock label="Payload" json={formatClaims(decoded.payload)} />
                  <p className="text-2xs leading-relaxed text-mute/80">
                    Decoded in your browser for convenience. It is not verified here, and
                    nothing about it should be taken on this page&apos;s word. Use the
                    jwt.io link above to check the signature against Okta&apos;s published
                    keys yourself.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
