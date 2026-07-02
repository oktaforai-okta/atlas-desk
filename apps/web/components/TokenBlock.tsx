// Server-renderable decoded-JWT/claims block with subtle highlighting.
// The `act` claim is emphasized, it is the chain of custody. String values
// that are known Okta identities are colored by identity and annotated with a
// friendly name, so the raw token is legible without decoding IDs by hand.

import { identityForId, identityForAud, identityForIssuer } from "@/lib/identities";

function Value({ v }: { v: unknown }) {
  if (Array.isArray(v)) return <span className="tok-str">[{v.map((x) => `"${x}"`).join(", ")}]</span>;
  const s = String(v);
  // sub / act.sub match by raw id; aud + iss (the callee) match by URL.
  const byId = identityForId(s);
  const byResource = byId ? null : identityForAud(s) || identityForIssuer(s);
  const id = byId || byResource;
  if (id) {
    // aud/iss are URLs, surface the resolved agent's wlp id too (a lookup from
    // the A2A resource registration, clearly an annotation, not a token field).
    const suffix = byResource && id.isWorkloadPrincipal ? ` · ${id.id}` : "";
    return (
      <>
        <span style={{ color: id.color }}>&quot;{s}&quot;</span>
        <span className="tok-punc"> // {id.name}{suffix}</span>
      </>
    );
  }
  return <span className="tok-str">&quot;{s}&quot;</span>;
}

function render(obj: Record<string, unknown>, depth = 0): JSX.Element[] {
  return Object.entries(obj).map(([k, v]) => {
    const pad = { paddingLeft: depth * 14 };
    const isAct = k === "act";
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return (
        <div key={k} style={pad}>
          <span className={isAct ? "tok-act font-semibold" : "tok-key"}>&quot;{k}&quot;</span>
          <span className="tok-punc">: {"{"}</span>
          <div className={isAct ? "my-0.5 rounded bg-[#B79CFF]/8 ring-1 ring-[#B79CFF]/25" : ""}>
            {render(v as Record<string, unknown>, depth + 1)}
          </div>
          <span className="tok-punc" style={pad}>{"}"}</span>
        </div>
      );
    }
    return (
      <div key={k} style={pad}>
        <span className="tok-key">&quot;{k}&quot;</span>
        <span className="tok-punc">: </span>
        <Value v={v} />
      </div>
    );
  });
}

// The workload principals present in this token, and where each appears,
// so it's unmistakable that BOTH agents are here (Triage as the act.sub value,
// Resolution resolved from the aud/iss resource URLs).
function workloadPrincipalsIn(claims: Record<string, unknown>) {
  const out: Array<{ id: string; name: string; color: string; where: string }> = [];
  const seen = new Set<string>();
  const wheres = ["act.sub", "act.act.sub", "act.act.act.sub"];
  // walk the full act chain, every acting agent, however deep
  let node: unknown = claims["act"];
  let depth = 0, guard = 0;
  while (node && typeof node === "object" && guard++ < 8) {
    const sub = (node as Record<string, unknown>)["sub"];
    if (typeof sub === "string") {
      const id = identityForId(sub);
      if (id?.isWorkloadPrincipal && !seen.has(id.id)) {
        seen.add(id.id);
        out.push({ id: id.id, name: id.name, color: id.color, where: wheres[Math.min(depth, wheres.length - 1)] });
      }
    }
    node = (node as Record<string, unknown>)["act"];
    depth++;
  }
  // the callee (aud/iss)
  const aud = typeof claims["aud"] === "string" ? (claims["aud"] as string) : "";
  const iss = typeof claims["iss"] === "string" ? (claims["iss"] as string) : "";
  const callee = identityForAud(aud) || identityForIssuer(iss);
  if (callee?.isWorkloadPrincipal && !seen.has(callee.id)) {
    out.push({ id: callee.id, name: callee.name, color: callee.color, where: "aud / iss" });
  }
  return out;
}

// Forward (initiator → latest) chain of custody. The act claim is stored
// newest-actor-outermost (RFC 8693), so we walk it, reverse to initiator-first,
// then append the callee (aud/iss). Derived, so it's correct for both the
// one-agent hop-1 token and the two-agent final token.
function forwardChain(claims: Record<string, unknown>) {
  const ids: string[] = [];
  let node: unknown = claims["act"];
  let guard = 0;
  while (node && typeof node === "object" && guard++ < 8) {
    const sub = (node as Record<string, unknown>)["sub"];
    if (typeof sub === "string") ids.push(sub);
    node = (node as Record<string, unknown>)["act"];
  }
  ids.reverse(); // initiator-first
  const out = ids.map((id) => {
    const i = identityForId(id);
    return { name: i?.name ?? id, color: i?.color ?? "#8B96A8" };
  });
  const aud = typeof claims["aud"] === "string" ? (claims["aud"] as string) : "";
  const iss = typeof claims["iss"] === "string" ? (claims["iss"] as string) : "";
  const callee = identityForAud(aud) || identityForIssuer(iss);
  if (callee) out.push({ name: callee.name, color: callee.color });
  return out;
}

export default function TokenBlock({ claims, caption }: { claims: Record<string, unknown>; caption?: string }) {
  const wlps = workloadPrincipalsIn(claims);
  const chain = forwardChain(claims);
  return (
    <div className="card-quiet overflow-hidden">
      {caption && (
        <div className="border-b border-line px-3 py-1.5 font-mono text-2xs text-mute">{caption}</div>
      )}
      {wlps.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-3 py-2 text-2xs">
          <span className="uppercase tracking-wider text-mute">Workload principals</span>
          {wlps.map((w) => (
            <span key={w.id} className="inline-flex flex-wrap items-baseline gap-1">
              <span className="font-medium" style={{ color: w.color }}>{w.name}</span>
              <span className="font-mono text-mute/80 [overflow-wrap:anywhere]">{w.id}</span>
              <span className="text-mute/60">· {w.where}</span>
            </span>
          ))}
        </div>
      )}
      <div className="p-3 font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]">
        <span className="tok-punc">{"{"}</span>
        <div className="pl-1">{render(claims, 1)}</div>
        <span className="tok-punc">{"}"}</span>
      </div>
      {chain.length > 1 && (
        <div className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-mute">
          The <span className="tok-act font-semibold">act</span> claim nests newest-actor-first (each hop wraps the previous), so it reads backwards. Chain of custody, initiator → latest:{" "}
          {chain.map((n, i) => (
            <span key={i} className="whitespace-nowrap">
              {i > 0 && <span className="text-mute/60"> → </span>}
              <span style={{ color: n.color }}>{n.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
