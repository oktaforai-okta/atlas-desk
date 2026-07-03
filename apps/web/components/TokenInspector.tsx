"use client";

// The proof-of-no-theater tool: every JWT this pipeline actually mints, one tab
// each, decoded claims + the raw act delegation chain + the actual compact JWT
// string, independently verifiable by anyone who knows what a JWT is. Shows
// the SAME run you just simulated on the Service Desk (sessionStorage bridges
// the two pages); falls back to clearly-labeled illustrative examples on a
// cold landing.

import { useMemo, useState } from "react";
import { Copy, Check, ShieldCheck, KeyRound } from "lucide-react";
import TokenBlock from "@/components/TokenBlock";
import { readCapturedRawTokens, type CapturedRawTokens } from "@/lib/events";
import { TOKEN_TABS, decodeJwt, illustrativeRawTokens, illustrativeVaultData } from "@/lib/tokenInspector";

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function TokenInspector() {
  // Read once on mount — a fresh run overwrites sessionStorage, but this page
  // is a single static snapshot of whatever was captured when it loaded.
  const [captured] = useState<CapturedRawTokens | null>(() => readCapturedRawTokens());
  const isReal = !!captured;
  const illustrative = useMemo(() => (isReal ? null : illustrativeRawTokens()), [isReal]);
  const illustrativeVault = useMemo(() => (isReal ? null : illustrativeVaultData()), [isReal]);

  const [selected, setSelected] = useState(TOKEN_TABS[0].id);
  const [copied, setCopied] = useState(false);

  const tab = TOKEN_TABS.find((t) => t.id === selected)!;

  const rawToken = tab.isVault ? null : (isReal ? captured!.tokens[tab.id] : illustrative![tab.id]) ?? null;
  const decoded = rawToken ? decodeJwt(rawToken) : null;
  const notReached = !tab.isVault && isReal && !rawToken;

  const vaultData = tab.isVault ? (isReal ? captured!.vault : illustrativeVault) : null;
  const vaultNotReached = !!tab.isVault && isReal && !vaultData;

  async function copyRaw(value: string | null) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable, the raw string below is still visible to select manually
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[17px] font-semibold text-bright">Token Inspector</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-soft">
              Every hop in the delegation chain is a real, independently verifiable Okta-issued token, not a claim
              this UI is asking you to trust. Pick a tab, read the decoded claims, or copy the encoded string into
              jwt.io and check it yourself.
            </p>
          </div>
          <a href="https://github.com/oktaforai-okta/atlas-desk/blob/main/docs/ARCHITECTURE.md"
             target="_blank" rel="noopener noreferrer"
             className="shrink-0 whitespace-nowrap rounded-md border border-line px-2.5 py-1.5 text-2xs text-soft hover:border-accent/60 hover:text-accent">
            Read the technical writeup →
          </a>
        </div>
        {!isReal && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/8 px-3 py-2 text-2xs text-warn">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Showing illustrative examples — simulate a ticket on the Service Desk, then come back to inspect your
            own run's real tokens.
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-line p-2">
          {TOKEN_TABS.map((t) => {
            const active = t.id === selected;
            return (
              <button key={t.id} type="button" onClick={() => { setSelected(t.id); setCopied(false); }}
                className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors"
                style={{
                  background: active ? hexA(t.color, 0.12) : "transparent",
                  boxShadow: active ? `inset 0 0 0 1px ${hexA(t.color, 0.45)}` : undefined,
                  color: active ? t.color : "#C9D0DC",
                }}
              >
                {t.title}
                {t.final && (
                  <span className="rounded-full border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warn">
                    final
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {tab.isVault ? (
            <VaultTab data={vaultData} notReached={vaultNotReached} isReal={isReal} />
          ) : notReached ? (
            <div className="py-10 text-center text-[13px] text-mute">
              This step wasn&apos;t reached in your last run.
            </div>
          ) : decoded ? (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-mute">Decoded</p>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <TokenBlock claims={decoded.payload} />
                  </div>
                  {decoded.payload["act"] != null && (
                    <div className="shrink-0 lg:w-[320px]">
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
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-mute">Encoded</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => copyRaw(rawToken)}
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
                  Copy it, open jwt.io, and paste it into the Encoded Token field yourself, or check the signature
                  against Okta&apos;s public JWKS, without trusting anything this UI says about it.
                </p>
              </div>
            </div>
          ) : (
            <p className="py-10 text-center text-[13px] text-bad">Unable to decode this token.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function VaultTab({ data, notReached, isReal }: { data: Record<string, unknown> | null; notReached: boolean; isReal: boolean }) {
  if (notReached) {
    return <div className="py-10 text-center text-[13px] text-mute">This step wasn&apos;t reached in your last run.</div>;
  }
  if (!data) return null;
  const subjectRef = String(data.subject_token_ref ?? "—");
  const resourceOrn = String(data.resource_orn ?? "—");
  const vaulted = Boolean(data.vaulted);
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-soft">
        This is not a claims-bearing JWT like the other five tabs, it's a token-exchange request/response. Okta
        releases the vaulted Jira credential only in exchange for a valid <span className="tok-act font-semibold">subject_token</span>,
        and runs a delegation-policy check against it. The credential value itself is never shown here, or
        anywhere in this app.
      </p>
      <div className="card-quiet overflow-hidden">
        <div className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2.5 p-3 font-mono text-[13px]">
          <span className="text-mute">grant_type</span>
          <span className="text-ink [overflow-wrap:anywhere]">urn:ietf:params:oauth:grant-type:token-exchange</span>
          <span className="text-mute">requested_token_type</span>
          <span className="text-ink [overflow-wrap:anywhere]">urn:okta:params:oauth:token-type:vaulted-secret</span>
          <span className="text-mute">resource</span>
          <span className="text-ink [overflow-wrap:anywhere]">{resourceOrn}</span>
          <span className="text-mute">subject_token</span>
          <span className="[overflow-wrap:anywhere]">
            <span className="tok-act font-semibold">{subjectRef}</span>
            <span className="text-mute"> — Agent 3&apos;s (Fulfillment&apos;s) own inbound token, the delegated authority it was handed, not a token it minted itself</span>
          </span>
          <span className="text-mute">released</span>
          <span className={vaulted ? "text-ok" : "text-warn"}>{vaulted ? "true" : "false (fell back to a static credential)"}</span>
        </div>
      </div>
      <div className="rounded-lg border border-line bg-raised/40 p-3 text-[12px] leading-relaxed text-soft">
        <span className="font-semibold text-ink">Why {subjectRef === "t_res" ? "the hop-1 token, not the hop-2 one" : "this specific subject"}:</span>{" "}
        verified live against a real Okta tenant: presenting Agent 3&apos;s <em>own</em> inbound A2A token (tab 3,
        the one that authorized invoking it) succeeds, presenting the token it mints downstream (tab 5), or the
        raw service-client bootstrap token (tab 1), is rejected with a delegation-policy error. Full write-up in
        the architecture doc linked above.
      </div>
      {!isReal && (
        <p className="text-2xs text-mute">Illustrative example — simulate a ticket to see your own run&apos;s real exchange.</p>
      )}
    </div>
  );
}
