// The delegation chain as a top-to-bottom LADDER that reads in plain language:
// each agent is a step, and the HANDOFF between steps names who authorized whom
// and shows Okta signing/logging it. This is the "connect the dots" view; the
// raw JWT is demoted to a separate "for engineers" toggle in the parent.
//
// Every value maps to a real Okta System Log field (verified end-to-end):
//   token sub            = Intake Service  (id_jag subject / service client)
//   token act.act.sub    = Triage          (actor of hop-1 id_jag grant)
//   token act.sub        = Resolution      (actor of hop-2 id_jag grant)
//   token aud / iss      = Fulfillment     (targetResourceOrn of hop-2 id_jag)
// Two agent workload principals (Triage + Resolution) act inside one token.

import { Bot, Boxes, KeyRound, ShieldCheck } from "lucide-react";
import { identityForId, identityForIssuer, identityForAud, shortId, type Identity } from "@/lib/identities";

interface Hop {
  key: string;
  identity: Identity | null;
  rawId: string;
  role: string;
}

// Plain-language "what this actor does", keyed by real principal id.
const ROLE: Record<string, string> = {
  "0oa10s89mqikXzZo41d8": "Bootstraps the workflow (OAuth service client)",
  "wlp10qjmsgdQROgxE1d8": "Classifies and routes the ticket",
  "wlp10qjml8mNlyBVK1d8": "Decides the fix and drafts the work notes",
  "wlp10tzrk45bDrCMK1d8": "Files the issue in Jira (only agent trusted on prod)",
};

function actChain(claims: Record<string, unknown>): Array<{ id: string; agent: boolean }> {
  const out: Array<{ id: string; agent: boolean }> = [];
  let node: unknown = claims["act"];
  let guard = 0;
  while (node && typeof node === "object" && guard++ < 8) {
    const o = node as Record<string, unknown>;
    if (typeof o["sub"] === "string") out.push({ id: o["sub"] as string, agent: o["sub_profile"] === "ai_agent" });
    node = o["act"];
  }
  return out; // outer -> inner, e.g. [Resolution, Triage, IntakeService]
}

// Forward (initiator -> latest) order: [Intake, Triage, Resolution] + callee Fulfillment.
function buildHops(claims: Record<string, unknown>): Hop[] {
  const actors = actChain(claims);
  const order = actors.slice().reverse();
  const hops: Hop[] = order.map((a, i) => ({
    key: `a${i}`,
    identity: identityForId(a.id),
    rawId: a.id,
    role: i === 0 ? "initiator" : "acting agent",
  }));
  const iss = typeof claims["iss"] === "string" ? (claims["iss"] as string) : "";
  const aud = typeof claims["aud"] === "string" ? (claims["aud"] as string) : "";
  const callee = identityForIssuer(iss) || identityForAud(aud);
  if (callee) hops.push({ key: "callee", identity: callee, rawId: aud || iss, role: "callee agent" });
  return hops.filter((h, i) => i === 0 || h.identity?.id !== hops[i - 1].identity?.id || h.rawId !== hops[i - 1].rawId);
}

type Item = { kind: "actor"; h: Hop } | { kind: "handoff"; i: number; from: Hop; to: Hop };

export default function ChainOfCustody({
  claims,
  systemLogId,
}: {
  claims: Record<string, unknown>;
  systemLogId?: string | null;
}) {
  const hops = buildHops(claims);
  if (hops.length === 0) return null;
  const logId = systemLogId || "app.oauth2.token.grant.id_jag";

  // interleave actors with the handoff that authorized each one
  const items: Item[] = [];
  hops.forEach((h, i) => {
    if (i > 0) items.push({ kind: "handoff", i, from: hops[i - 1], to: h });
    items.push({ kind: "actor", h });
  });

  return (
    <div>
      <div>
        {items.map((it, idx) => {
          const last = idx === items.length - 1;
          const rail = !last && <div className="my-1 w-px flex-1 bg-line2" />;

          if (it.kind === "actor") {
            const h = it.h;
            const color = h.identity?.color ?? "#8B96A8";
            const isAgent = h.identity?.isWorkloadPrincipal ?? false;
            const Icon = isAgent ? Bot : Boxes;
            return (
              <div key={idx} className="flex gap-3">
                <div className="flex w-8 shrink-0 flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}66` }}>
                    <Icon width={17} height={17} style={{ color }} />
                  </div>
                  {rail}
                </div>
                <div className={`min-w-0 flex-1 pt-0.5 ${last ? "" : "pb-3"}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] font-semibold leading-tight" style={{ color }}>{h.identity?.name ?? shortId(h.rawId)}</span>
                    <span className="rounded bg-raised px-1.5 py-px text-[10px] text-mute">{isAgent ? "workload principal" : "service client"}</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-soft">{ROLE[h.identity?.id ?? ""] ?? ""}</div>
                  <div className="font-mono text-2xs text-mute/70 [overflow-wrap:anywhere]">{h.identity?.id ?? shortId(h.rawId)}</div>
                </div>
              </div>
            );
          }

          // handoff row: hop into Resolution (i=2) and Fulfillment (i=3) are id_jag;
          // the first hand-in (i=1, into Triage) is the client_credentials bootstrap.
          const idJag = it.i >= 2;
          const hopNo = it.i - 1;
          const fromC = it.from.identity?.color ?? "#8B96A8";
          const toC = it.to.identity?.color ?? "#8B96A8";
          return (
            <div key={idx} className="flex gap-3">
              <div className="flex w-8 shrink-0 flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border"
                  style={{ background: "#0F131A", borderColor: idJag ? "#93B4FF" : "#2A323F" }}>
                  {idJag
                    ? <ShieldCheck width={13} height={13} style={{ color: "#93B4FF" }} />
                    : <KeyRound width={12} height={12} className="text-mute" />}
                </div>
                {rail}
              </div>
              <div className="min-w-0 flex-1 pb-3">
                {idJag ? (
                  <>
                    <div className="text-[12px] font-semibold" style={{ color: "#93B4FF" }}>Okta ID-JAG handoff · hop {hopNo} of 2</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-soft">
                      <span style={{ color: fromC }}>{it.from.identity?.name}</span> asks Okta to authorize{" "}
                      <span style={{ color: toC }}>{it.to.identity?.name}</span> to act on its behalf{it.i === hops.length - 1 ? ", carrying the full history" : ""}.
                    </div>
                    <div className="mt-0.5 font-mono text-2xs text-mute">✓ Okta signs &amp; logs it · {logId}</div>
                  </>
                ) : (
                  <>
                    <div className="text-[12px] font-semibold text-soft">client_credentials grant</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-mute">
                      <span style={{ color: fromC }}>{it.from.identity?.name}</span> bootstraps{" "}
                      <span style={{ color: toC }}>{it.to.identity?.name}</span>. No agent-to-agent delegation yet.
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* plain-language proof summary (forward order, colored) */}
      <div className="mt-1 rounded-lg border border-line bg-panel px-3 py-2.5 text-[12.5px] leading-relaxed">
        <span className="text-soft">Fulfillment&apos;s final token cryptographically proves the whole chain: </span>
        {hops.map((h, i) => (
          <span key={h.key} className="whitespace-nowrap">
            {i > 0 && <span className="text-mute/60"> → </span>}
            <span className="font-semibold" style={{ color: h.identity?.color }}>{h.identity?.name}</span>
          </span>
        ))}
      </div>

      {/* governance footer */}
      <div className="mt-2 flex items-start gap-1.5 text-2xs text-ok">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>Both agent-to-agent handoffs are in the Okta System Log (<span className="font-mono text-mute">{logId}</span> ×2). Deactivate any agent in Okta and the next handoff fails.</span>
      </div>
    </div>
  );
}
