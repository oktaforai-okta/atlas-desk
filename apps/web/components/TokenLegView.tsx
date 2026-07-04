"use client";

// One inspectable token, rendered jwt.io-style: decoded header + payload cards
// (each with a JSON / Claims Breakdown toggle), the raw act delegation chain,
// the encoded compact string (copy + open jwt.io), and a real RS256 signature
// verification against Okta's live JWKS. A hop tab renders one of these per leg
// (the ID-JAG grant, then the access token).

import { useState } from "react";
import { Copy, Check, KeyRound } from "lucide-react";
import TokenBlock from "@/components/TokenBlock";
import DecodedCard from "@/components/DecodedCard";
import SignatureVerification from "@/components/SignatureVerification";
import { decodeJwt } from "@/lib/tokenInspector";

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function TokenLegView({ rawToken, role, kind, accent }: {
  rawToken: string;
  role: string;   // e.g. "Delegation grant" / "Access token"
  kind: string;   // "ID-JAG" | "Access Token"
  accent: string; // hop destination color
}) {
  const [copied, setCopied] = useState(false);
  const decoded = decodeJwt(rawToken);

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(rawToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable, the raw string below is still selectable
    }
  }

  if (!decoded) {
    return <p className="py-6 text-center text-[13px] text-bad">Unable to decode this token.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">{role}</span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: hexA(accent, 0.14), color: accent }}>
          {kind}
        </span>
      </div>

      <DecodedCard title="Decoded Header" claims={decoded.header} jsonView={<TokenBlock claims={decoded.header} />} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <DecodedCard title="Decoded Payload" claims={decoded.payload} jsonView={<TokenBlock claims={decoded.payload} />} />
        </div>
        {decoded.payload["act"] != null && (
          <div className="shrink-0 lg:w-[300px]">
            <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-mute">
              <span className="h-3 w-1 rounded-full bg-[#B79CFF]" /> Delegation chain <span className="tok-act">(act)</span>
            </p>
            <div className="rounded-lg border-2 p-3" style={{ borderColor: hexA("#B79CFF", 0.35), background: hexA("#B79CFF", 0.06) }}>
              <pre className="font-mono text-[11px] leading-relaxed text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">
                {JSON.stringify(decoded.payload["act"], null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-2xs font-semibold uppercase tracking-wider text-mute">Encoded</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={copyRaw}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-2xs text-soft transition-colors hover:border-accent/60 hover:text-accent">
              {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a href="https://jwt.io/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-2xs text-soft transition-colors hover:border-accent/60 hover:text-accent">
              Open jwt.io ↗
            </a>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-[#0B0E13] p-3">
          <p className="font-mono text-[11px] leading-relaxed text-ok [overflow-wrap:anywhere]">{rawToken}</p>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mute">
          <KeyRound className="h-3 w-3 shrink-0" />
          Copy it, open jwt.io, and paste it into the Encoded Token field yourself, or check the signature against
          Okta&apos;s public JWKS below, without trusting anything this UI says about it.
        </p>
      </div>

      <SignatureVerification rawToken={rawToken} />
    </div>
  );
}
