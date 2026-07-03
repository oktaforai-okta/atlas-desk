"use client";

// The strongest proof this UI can offer: not "trust us," a real cryptographic
// RS256 check against Okta's own live, public signing keys, computed in the
// browser via WebCrypto. Falls back to a manual paste-a-key flow (SPKI PEM or
// JWK), matching jwt.io's own UX, for when the live fetch isn't available.

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from "lucide-react";
import { verifyJwtSignature, verifyJwtSignatureWithKey, type VerifyResult } from "@/lib/tokenInspector";

type State = VerifyResult | "loading" | null;

export default function SignatureVerification({ rawToken }: { rawToken: string }) {
  const [result, setResult] = useState<State>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKey, setManualKey] = useState("");
  const [manualResult, setManualResult] = useState<State>(null);

  useEffect(() => {
    let alive = true;
    setResult("loading");
    setManualOpen(false);
    setManualResult(null);
    setManualKey("");
    verifyJwtSignature(rawToken).then((r) => { if (alive) setResult(r); });
    return () => { alive = false; };
  }, [rawToken]);

  async function runManual() {
    setManualResult("loading");
    setManualResult(await verifyJwtSignatureWithKey(rawToken, manualKey));
  }

  return (
    <div>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-mute">
        JWT Signature Verification <span className="text-mute/60">(optional)</span>
      </p>
      <div className="card-quiet p-3">
        <StatusRow state={result} onRetry={() => { setResult("loading"); verifyJwtSignature(rawToken).then(setResult); }} />
        <button type="button" onClick={() => setManualOpen((v) => !v)}
          className="mt-3 text-[12px] text-accent hover:opacity-80">
          {manualOpen ? "Hide manual key entry" : "Or paste a public key manually"}
        </button>
        {manualOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              placeholder={'-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n\nor a JWK: {"kty":"RSA","n":"...","e":"AQAB",...}'}
              rows={5}
              className="w-full rounded-lg border border-line bg-[#0B0E13] p-2.5 font-mono text-[11px] text-ink placeholder:text-mute/50"
            />
            <button type="button" onClick={runManual}
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-soft transition-colors hover:border-accent/60 hover:text-accent">
              Verify with this key
            </button>
            <StatusRow state={manualResult} />
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<VerifyResult["status"], { icon: typeof ShieldCheck; color: string }> = {
  verified: { icon: ShieldCheck, color: "text-ok" },
  failed: { icon: ShieldAlert, color: "text-bad" },
  "no-signature": { icon: ShieldQuestion, color: "text-warn" },
  error: { icon: ShieldQuestion, color: "text-warn" },
};

function StatusRow({ state, onRetry }: { state: State; onRetry?: () => void }) {
  if (state === null) return null;
  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-mute">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking against Okta&apos;s live signing keys…
      </div>
    );
  }
  const { icon: Icon, color } = STATUS_STYLE[state.status];
  return (
    <div className={`flex items-start gap-2 text-[13px] ${color}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <div>{state.detail}</div>
        {state.jwksUrl && state.status !== "no-signature" && (
          <div className="mt-1 font-mono text-[11px] text-mute [overflow-wrap:anywhere]">{state.jwksUrl}</div>
        )}
        {state.status === "error" && onRetry && (
          <button type="button" onClick={onRetry} className="mt-1 text-[11px] text-accent hover:underline">Retry</button>
        )}
      </div>
    </div>
  );
}
