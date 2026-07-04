"use client";

// The proof-of-no-theater tool, organized as the delegation chain's FOUR hops.
// Each hop is one agent-to-agent step (so no two tabs share an agent name); an
// A2A hop shows its two legs — the ID-JAG delegation grant, then the access
// token it's redeemed for — each fully decoded, with the raw act chain and a
// real RS256 signature check against Okta's live JWKS. Shows the SAME run you
// just simulated on the Service Desk (sessionStorage bridges the pages); falls
// back to clearly-labeled illustrative examples on a cold landing.

import { useMemo, useState } from "react";
import { ShieldCheck, ArrowRight } from "lucide-react";
import TokenLegView from "@/components/TokenLegView";
import { readCapturedRawTokens, type CapturedRawTokens } from "@/lib/events";
import { TOKEN_TABS, decodeJwt, illustrativeRawTokens, illustrativeVaultData } from "@/lib/tokenInspector";
import { identityForId, identityForAud, shortId } from "@/lib/identities";

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// The literal answer to "which two workload principals is this hop between":
// who actually holds the credential (cid / client_id / sub — read from the real
// claims, NOT assumed from which resource it targets), and which agent it's
// scoped to invoke (resource / aud). Both shown explicitly.
function HolderTargetBanner({ payload }: { payload: Record<string, unknown> }) {
  const holderId = String(payload["cid"] ?? payload["client_id"] ?? payload["sub"] ?? "");
  const targetUrl = String(payload["resource"] ?? payload["aud"] ?? "");
  const holder = holderId ? identityForId(holderId) : null;
  const target = targetUrl ? identityForAud(targetUrl) : null;
  if (!holderId && !targetUrl) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-raised/40 px-3 py-2.5 text-[13px]">
      <span className="text-mute">Held by</span>
      <Party identity={holder} fallbackId={holderId} />
      {targetUrl && (
        <>
          <ArrowRight className="h-3.5 w-3.5 text-mute" />
          <span className="text-mute">scoped to invoke</span>
          <Party identity={target} fallbackId={targetUrl} />
        </>
      )}
    </div>
  );
}

function Party({ identity, fallbackId }: { identity: ReturnType<typeof identityForId>; fallbackId: string }) {
  if (identity) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: identity.color }}>
        <span className="h-2 w-2 rounded-full" style={{ background: identity.color }} />
        {identity.name}
        <span className="font-mono text-2xs text-mute">{shortId(fallbackId)}</span>
      </span>
    );
  }
  return <span className="font-mono text-2xs text-mute [overflow-wrap:anywhere]">{shortId(fallbackId)}</span>;
}

export default function TokenInspector() {
  // Read once on mount — a fresh run overwrites sessionStorage, but this page
  // is a single static snapshot of whatever was captured when it loaded.
  const [captured] = useState<CapturedRawTokens | null>(() => readCapturedRawTokens());
  const isReal = !!captured;
  const illustrative = useMemo(() => (isReal ? null : illustrativeRawTokens()), [isReal]);
  const illustrativeVault = useMemo(() => (isReal ? null : illustrativeVaultData()), [isReal]);

  const [selected, setSelected] = useState(TOKEN_TABS[0].id);
  const hop = TOKEN_TABS.find((t) => t.id === selected)!;

  const tokenFor = (key: string): string | null =>
    (isReal ? captured!.tokens[key] : illustrative![key]) ?? null;

  const legs = hop.legs ?? [];
  const presentLegs = legs.filter((l) => !!tokenFor(l.key));
  // Banner reads from the access token (last leg) when present, else whatever leg we have.
  const bannerRaw = presentLegs.length ? tokenFor(presentLegs[presentLegs.length - 1].key) : null;
  const bannerPayload = bannerRaw ? decodeJwt(bannerRaw)?.payload ?? null : null;
  const hopNotReached = !hop.isVault && isReal && presentLegs.length === 0;

  const vaultData = hop.isVault ? (isReal ? captured!.vault : illustrativeVault) : null;
  const vaultNotReached = !!hop.isVault && isReal && !vaultData;
  const isExchange = legs.length > 1;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[17px] font-semibold text-bright">Token Inspector</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-soft">
              The delegation chain, one hop per tab: Intake Service → Agent 1 → Agent 2 → Agent 3 → Jira. Every
              token is a real, independently verifiable Okta-issued JWT, not a claim this UI is asking you to
              trust. Pick a hop, read the decoded claims, or verify the signature against Okta&apos;s live keys.
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
            own run&apos;s real tokens.
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-line p-2">
          {TOKEN_TABS.map((t) => {
            const active = t.id === selected;
            return (
              <button key={t.id} type="button" onClick={() => setSelected(t.id)}
                className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors"
                style={{
                  background: active ? hexA(t.toColor, 0.12) : "transparent",
                  boxShadow: active ? `inset 0 0 0 1px ${hexA(t.toColor, 0.45)}` : undefined,
                  color: active ? t.toColor : "#C9D0DC",
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

        <div className="space-y-5 p-4">
          {hop.isVault ? (
            <VaultTab data={vaultData} notReached={vaultNotReached} isReal={isReal} />
          ) : hopNotReached ? (
            <div className="py-10 text-center text-[13px] text-mute">
              This hop wasn&apos;t reached in your last run.
            </div>
          ) : (
            <>
              {bannerPayload && <HolderTargetBanner payload={bannerPayload} />}
              {isExchange && (
                <p className="text-[12px] leading-relaxed text-mute">
                  A2A hop = a token exchange in two legs: the caller mints an <span className="tok-act font-semibold">ID-JAG</span> (the
                  delegation grant), then redeems it for the <span className="font-semibold text-soft">access token</span> it actually
                  calls with. Both carry the same nested <span className="tok-act">act</span> chain of custody.
                </p>
              )}
              {legs.map((leg, i) => {
                const raw = tokenFor(leg.key);
                return (
                  <div key={leg.key} className={i > 0 ? "border-t border-line pt-5" : ""}>
                    {raw ? (
                      <TokenLegView rawToken={raw} role={leg.role} kind={leg.kind} accent={hop.toColor} />
                    ) : (
                      <p className="py-4 text-[13px] text-mute">{leg.role} ({leg.kind}) wasn&apos;t captured in this run.</p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VaultTab({ data, notReached, isReal }: { data: Record<string, unknown> | null; notReached: boolean; isReal: boolean }) {
  if (notReached) {
    return <div className="py-10 text-center text-[13px] text-mute">This hop wasn&apos;t reached in your last run.</div>;
  }
  if (!data) return null;
  const subjectRef = String(data.subject_token_ref ?? "—");
  const resourceOrn = String(data.resource_orn ?? "—");
  const vaulted = Boolean(data.vaulted);
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-soft">
        The last hop isn&apos;t a claims-bearing JWT like the others — it&apos;s a token-exchange. Agent 3
        (Fulfillment) trades a token for the vaulted Jira credential, which it then uses to write the ticket.
        Okta releases the secret only in exchange for a valid <span className="tok-act font-semibold">subject_token</span> that
        passes a delegation-policy check. The credential value itself is never shown here, or anywhere in this app.
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
            <span className="text-mute">
              {" "}— the access token from the <span className="text-soft">Agent 1 → Agent 2</span> hop, i.e. Agent
              1 (Triage)&apos;s own token, the very first A2A token issued in this chain. Not Agent 2&apos;s token,
              and not a credential Fulfillment minted itself, even though Fulfillment is the one calling the vault.
            </span>
          </span>
          <span className="text-mute">released</span>
          <span className={vaulted ? "text-ok" : "text-warn"}>{vaulted ? "true" : "false (fell back to a static credential)"}</span>
        </div>
      </div>
      <div className="rounded-lg border border-line bg-raised/40 p-3 text-[12px] leading-relaxed text-soft">
        <span className="font-semibold text-ink">Why this specific subject:</span>{" "}
        verified live against a real Okta tenant — presenting the <span className="text-soft">Agent 1 → Agent 2</span> hop&apos;s
        access token succeeds; presenting the <span className="text-soft">Agent 2 → Agent 3</span> hop&apos;s token,
        or the raw service-client bootstrap token, is rejected with a delegation-policy error. The vaulted
        secret&apos;s policy is anchored to a specific agent&apos;s chain of custody — Okta&apos;s policy, not this
        app deciding who gets the secret. Full write-up in the architecture doc linked above.
      </div>
      {!isReal && (
        <p className="text-2xs text-mute">Illustrative example — simulate a ticket to see your own run&apos;s real exchange.</p>
      )}
    </div>
  );
}
