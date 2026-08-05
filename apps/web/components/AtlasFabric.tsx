"use client";

// The Identity Fabric, an interactive, force-directed map of the whole Okta A2A
// architecture, built with real d3-force. A graph you *explore*:
//   • d3-force lays it out organically (charge + links + per-column forceX lanes)
//   • d3-zoom: scroll to zoom, drag background to pan, "Fit" to reset
//   • drag any node (d3.pointer stays accurate under zoom); the sim reflows
//   • hover a node to spotlight its connections + reveal its Okta id
//   • "Replay delegation" sends a token down the real path: service → 2 agents → Jira
// Each node mirrors an object in the reference tenant, but the ids shown below are
// EXAMPLE placeholders, not live values: this diagram is static, so it cannot know
// a real tenant's ids. Real ids appear on /tokens, read off actual tokens.
// Okta itself isn't a node, it's the issuer that brokers the agent→agent hop,
// shown as the id-jag shield on that edge (exactly where the token is minted).

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide,
  zoom as d3zoom, zoomIdentity, select, pointer,
  type Simulation, type ZoomTransform, type ZoomBehavior,
} from "d3";
import { useResolvedTheme, vizPalette } from "@/lib/theme";

type NType = "external" | "service" | "agent" | "resource";
type IconName = "inbox" | "server" | "bot" | "lock" | "kanban";
interface FNode {
  id: string; label: string; icon: IconName; type: NType; hue: Hue;
  role: string; idKind?: string; idVal?: string; // role shown in-card; real id (WLP/APP) revealed OUTSIDE on hover/replay
  realName?: string; // for AI agents: the real name (Triage/Resolution/Fulfillment), revealed alongside the id
  tx: number; ty: number; x: number; y: number; fx?: number | null; fy?: number | null;
}
interface FLink { source: string | FNode; target: string | FNode; brokered?: boolean; kind?: "branch" }

type Hue = "external" | "service" | "okta" | "triage" | "resolve" | "fulfill" | "resource";
const HUES: Hue[] = ["external", "service", "okta", "triage", "resolve", "fulfill", "resource"];

/** Hues resolve per theme. Nodes store the hue NAME rather than a hex so the d3
 *  simulation is never re-initialised on a theme change, which would otherwise
 *  reset the layout the user had just dragged into place. */
function hues(P: ReturnType<typeof vizPalette>): Record<Hue, string> {
  return {
    external: P.neutral, service: P.service, okta: P.okta,
    triage: P.triage, resolve: P.resolve, fulfill: P.fulfill, resource: P.vault,
  };
}

// A left-to-right delegation pipeline; the vault hangs directly BELOW Fulfillment
// (the only agent trusted to pull the prod credential) as a governance side-branch.
// No Okta/owner nodes, Okta lives on the id-jag edges. Cards stay clean (generic
// "Agent N" + role, on purpose, see below); each identity node's REAL Okta id
// (WLP ID for agents, APP ID for the service client) is revealed OUTSIDE the card
// on hover, or as the replay dot passes. Every id here is a live principal in the
// deployed tenant.
//
// Two agents, distinguished by what they may do rather than by a role name.
// Agent 1 holds ticket.read; Agent 2 is the only client authorized on the write
// authorization server, so it is the only one that can hold ticket.write.
const RAW_NODES: Omit<FNode, "x" | "y">[] = [
  { id: "inbound", label: "Inbound Tickets", role: "external system", icon: "inbox", type: "external", hue: "external", tx: 150, ty: 180 },
  { id: "svc", label: "Intake Service", role: "service client", idKind: "APP ID", idVal: "0oaEXAMPLEIntakeSvc1", icon: "server", type: "service", hue: "service", tx: 410, ty: 180 },
  { id: "triage", label: "Agent 1", role: "read only", realName: "reader", idVal: "wlpEXAMPLEAgentOne01", icon: "bot", type: "agent", hue: "triage", tx: 700, ty: 180 },
  { id: "fulfill", label: "Agent 2", role: "write capable", realName: "writer", idVal: "wlpEXAMPLEAgentTwo01", icon: "bot", type: "agent", hue: "fulfill", tx: 1010, ty: 180 },
  { id: "jira", label: "Jira · ITSD", role: "IT Service Desk", icon: "kanban", type: "external", hue: "external", tx: 1320, ty: 180 },
  { id: "vault", label: "OPA Vault", role: "vaulted secret", icon: "lock", type: "resource", hue: "resource", tx: 1010, ty: 445 },
];
const RAW_LINKS: FLink[] = [
  { source: "inbound", target: "svc" },
  { source: "svc", target: "triage" },
  { source: "triage", target: "fulfill", brokered: true },
  { source: "fulfill", target: "vault", kind: "branch" },
  { source: "fulfill", target: "jira" },
];
// Replay dips into the OPA Vault (Fulfillment fetching the Jira credential) and
// back up before filing to Jira — so the credential pull is actually shown.
const REPLAY = ["inbound", "svc", "triage", "fulfill", "vault", "fulfill", "jira"];

const NW = 186, NH = 62; // node card size — tighter (less empty space; wider gaps = bolder arrows)

// lucide-style 24×24 stroke glyphs, drawn in the node color.
function glyph(name: IconName): ReactNode {
  switch (name) {
    case "inbox":
      return <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>;
    case "server":
      return <><rect x="2" y="3" width="20" height="8" rx="2" /><rect x="2" y="13" width="20" height="8" rx="2" /><line x1="6" x2="6.01" y1="7" y2="7" /><line x1="6" x2="6.01" y1="17" y2="17" /></>;
    case "bot":
      return <><path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>;
    case "lock":
      return <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>;
    case "kanban":
      return <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v7" /><path d="M12 7v4" /><path d="M16 7v9" /></>;
  }
}

export default function AtlasFabric() {
  const uid = useId().replace(/:/g, ""); // scope SVG def ids so two instances never clobber
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simRef = useRef<Simulation<FNode, undefined> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodesRef = useRef<FNode[]>(RAW_NODES.map((n) => ({ ...n, x: n.tx, y: n.ty })));
  const linksRef = useRef<FLink[]>(RAW_LINKS.map((l) => ({ ...l })));
  const dragId = useRef<string | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const rafRef = useRef(0);
  const [, tick] = useState(0);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hovered, setHovered] = useState<string | null>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);
  const P = vizPalette(useResolvedTheme());
  const H = hues(P);

  useEffect(() => {
    const nodes = nodesRef.current, links = linksRef.current;
    const sim = forceSimulation<FNode>(nodes)
      .force("link", forceLink<FNode, FLink>(links).id((d) => d.id).distance(260).strength(0.55))
      .force("charge", forceManyBody().strength(-1100))
      .force("x", forceX<FNode>((d) => d.tx).strength(0.44))
      .force("y", forceY<FNode>((d) => d.ty).strength(0.28))
      .force("collide", forceCollide(120))
      .on("tick", () => tick((v) => v + 1));
    simRef.current = sim;

    const zoomB = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.4])
      .filter((e) => !(e.target as Element)?.closest?.(".fabric-node"))
      .on("zoom", (e) => setTransform(e.transform));
    zoomRef.current = zoomB;
    select(svgRef.current!).call(zoomB);
    return () => { sim.stop(); dragCleanup.current?.(); cancelAnimationFrame(rafRef.current); };
  }, []);

  function onNodeDown(id: string) {
    dragId.current = id;
    simRef.current?.alphaTarget(0.3).restart();
    const move = (ev: PointerEvent) => {
      const n = nodesRef.current.find((x) => x.id === dragId.current);
      if (!n || !gRef.current) return;
      const [x, y] = pointer(ev, gRef.current);
      n.fx = x; n.fy = y;
    };
    const up = () => {
      const n = nodesRef.current.find((x) => x.id === dragId.current);
      if (n) { n.fx = null; n.fy = null; }
      dragId.current = null;
      simRef.current?.alphaTarget(0);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragCleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // let the unmount cleanup tear these down if a drag is still in flight
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }

  function fit() {
    if (!zoomRef.current) return;
    select(svgRef.current!).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
  }

  function replay() {
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const pts = REPLAY.map((id) => byId.get(id)).filter((n): n is FNode => !!n);
    if (pts.length < 2) return;
    cancelAnimationFrame(rafRef.current); // a second click restarts, never races
    const segMs = 1000; // slower, more deliberate flow (was 600) — easier to follow + pills dwell longer
    const start = performance.now();
    const stepFn = (now: number) => {
      const t = (now - start) / segMs;
      const i = Math.floor(t);
      if (i >= pts.length - 1) { setToken(null); return; }
      const f = t - i, a = pts[i], b = pts[i + 1];
      setToken({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      rafRef.current = requestAnimationFrame(stepFn);
    };
    rafRef.current = requestAnimationFrame(stepFn);
  }

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const endp = (s: string | FNode): FNode | undefined => (typeof s === "object" ? s : byId.get(s));
  const neighbors = useMemo(() => {
    if (!hovered) return null;
    const nid = (s: string | FNode) => (typeof s === "object" ? s.id : byId.get(s)?.id);
    const set = new Set<string>([hovered]);
    links.forEach((l) => {
      const a = nid(l.source), b = nid(l.target);
      if (a === hovered && b) set.add(b);
      if (b === hovered && a) set.add(a);
    });
    return set;
  }, [hovered, links, byId]);

  // While the replay dot travels, light up the id pill of whichever node it's passing.
  let passingId: string | null = null;
  if (token) {
    let best = 118; // generous radius so each pill lights well before + lingers after the dot passes
    for (const n of nodes) {
      const d = Math.hypot(n.x - token.x, n.y - token.y);
      if (d < best) { best = d; passingId = n.id; }
    }
  }

  return (
    <div className="card edge-accent hero-mesh relative overflow-hidden">
      <div className="pointer-events-none absolute left-4 top-3 z-10 text-2xs uppercase tracking-wider text-mute">
        Identity Fabric · scroll to zoom · drag nodes · hover to trace
      </div>
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <button onClick={replay} className="rounded-md bg-gradient-to-b from-accent to-[#5B86E8] px-2.5 py-1 text-2xs font-medium text-white shadow-[0_2px_10px_-2px_rgba(122,162,255,0.5)] hover:brightness-110">▷ Replay delegation</button>
        <button onClick={fit} className="rounded-md border border-line bg-raised px-2.5 py-1 text-2xs text-soft hover:text-ink">Fit</button>
      </div>

      <svg ref={svgRef} viewBox="0 0 1600 540" className="h-[540px] w-full cursor-grab active:cursor-grabbing">
        <defs>
          <linearGradient id={`${uid}-card`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={P.cardFrom} />
            <stop offset="1" stopColor={P.cardTo} />
          </linearGradient>
          {HUES.map((k) => (
            <marker key={k} id={`${uid}-arw-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={H[k]} />
            </marker>
          ))}
        </defs>
        <g ref={gRef} transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* edges, trimmed to the card boundary so the arrowhead lands at the
              target's edge (pointing in), never buried at center where it would
              bleed through a dimmed card as a stray glyph */}
          {links.map((l, i) => {
            const a = endp(l.source), b = endp(l.target);
            if (!a || !b) return null;
            const active = !neighbors || (neighbors.has(a.id) && neighbors.has(b.id));
            // OPA Vault "credential pull": a smooth vertical cubic-bezier drop from
            // Fulfillment's bottom-center into the Vault's top-center — an intentional
            // governance side-branch, not the stray diagonal arrow it used to be.
            if (l.kind === "branch") {
              const x1 = a.x, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y - NH / 2;
              const cy = (y1 + y2) / 2;
              const d = `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
              return (
                <g key={i} style={{ opacity: active ? 1 : 0.16 }}>
                  <path d={d} fill="none" stroke={H[b.hue]} strokeOpacity={0.7} strokeWidth={2}
                    strokeDasharray="5 5" strokeLinecap="round" />
                  <text x={(x1 + x2) / 2 + 12} y={cy} fontSize={10} fill={H[b.hue]} dominantBaseline="middle"
                    style={{ letterSpacing: "0.02em" }}>credential</text>
                </g>
              );
            }
            const vx = b.x - a.x, vy = b.y - a.y;
            const len = Math.hypot(vx, vy) || 1;
            const ux = vx / len, uy = vy / len;
            const edgeDist = Math.min(vx ? (NW / 2) / Math.abs(vx) : Infinity, vy ? (NH / 2) / Math.abs(vy) : Infinity) * len;
            const off = Math.min(edgeDist + 7, len * 0.45); // clamp so short edges never cross
            return (
              <line key={i} x1={a.x + ux * off} y1={a.y + uy * off} x2={b.x - ux * off} y2={b.y - uy * off}
                stroke={H[b.hue]} strokeOpacity={active ? 0.85 : 0.12}
                strokeWidth={2.4} markerEnd={`url(#${uid}-arw-${b.hue})`} />
            );
          })}
          {/* id-jag broker badges, sit on the agent→agent hops, where Okta mints the token */}
          {links.filter((l) => l.brokered).map((l, i) => {
            const a = endp(l.source), b = endp(l.target);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const active = !neighbors || (neighbors.has(a.id) && neighbors.has(b.id));
            return (
              <g key={`bk-${i}`} style={{ opacity: active ? 1 : 0.12 }} className="pointer-events-none">
                <circle cx={mx} cy={my} r={16} fill={P.canvas} stroke={P.okta} strokeWidth={1.4}
                  style={{ filter: `drop-shadow(0 0 6px ${P.okta}66)` }} />
                <g transform={`translate(${mx},${my}) scale(0.64)`} stroke={P.okta} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <g transform="translate(-12,-12)">
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                    <path d="m9 12 2 2 4-4" />
                  </g>
                </g>
                <text textAnchor="middle" y={my + 31} x={mx} fontSize={10.5} fontWeight={700} fill={P.okta} style={{ letterSpacing: "0.04em" }}>id-jag</text>
              </g>
            );
          })}
          {/* nodes, premium glass cards */}
          {nodes.map((n) => {
            const hl = hovered === n.id;
            const opacity = neighbors && !neighbors.has(n.id) ? 0.22 : 1;
            const chipCX = -NW / 2 + 30;
            return (
              <g key={n.id} className="fabric-node cursor-pointer" style={{ opacity }}
                onPointerDown={() => onNodeDown(n.id)} onPointerEnter={() => setHovered(n.id)} onPointerLeave={() => setHovered(null)}
                transform={`translate(${n.x},${n.y}) scale(${hl ? 1.04 : 1})`}>
                {/* ambient color glow */}
                <rect x={-NW / 2 - 3} y={-NH / 2 - 3} width={NW + 6} height={NH + 6} rx={16}
                  fill={H[n.hue]} opacity={hl ? 0.18 : 0.06} />
                {/* card body */}
                <rect x={-NW / 2} y={-NH / 2} width={NW} height={NH} rx={14}
                  fill={`url(#${uid}-card)`} stroke={H[n.hue]} strokeOpacity={hl ? 1 : 0.55} strokeWidth={hl ? 2 : 1.3}
                  style={{ filter: `drop-shadow(0 6px 14px rgba(0,0,0,0.28))${hl ? ` drop-shadow(0 0 12px ${H[n.hue]}88)` : ""}` }} />
                {/* icon chip (vertically centered) */}
                <rect x={chipCX - 18} y={-18} width={36} height={36} rx={9} fill={H[n.hue]} opacity={0.14} />
                <rect x={chipCX - 18} y={-18} width={36} height={36} rx={9} fill="none" stroke={H[n.hue]} strokeOpacity={0.42} />
                <g transform={`translate(${chipCX},0) scale(0.75)`} stroke={H[n.hue]} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <g transform="translate(-12,-12)">{glyph(n.icon)}</g>
                </g>
                {/* clean card: name + role only; the real Okta id lives outside the box now */}
                <text x={chipCX + 30} y={-3} fontSize={15} fontWeight={700} fill={P.title}>{n.label}</text>
                <text x={chipCX + 30} y={16} fontSize={11} fill={hl ? H[n.hue] : P.sub}>{n.role}</text>
              </g>
            );
          })}
          {/* the REAL Okta id, revealed OUTSIDE the card — floats in above it and lights
              up on hover, or as the replay dot passes the node (never crammed in the box).
              For agent nodes, the real name (Triage/Resolution/Fulfillment) reveals here
              too, paired with the id, that pairing is the whole point: the static card
              only ever says "Agent N," learning who it really is means looking at the id. */}
          {nodes.filter((n) => n.idVal).map((n) => {
            const active = hovered === n.id || passingId === n.id;
            const pillW = n.realName ? 226 : 208, top = n.y - NH / 2 - 34, left = n.x - pillW / 2;
            const labelText = n.realName ?? n.idKind;
            const idX = left + (n.realName ? 68 : 56);
            return (
              <g key={`id-${n.id}`} className="pointer-events-none"
                style={{ opacity: active ? 1 : 0, transition: "opacity 0.45s ease" }}>
                <rect x={left} y={top} width={pillW} height={24} rx={12} fill={P.canvas}
                  stroke={H[n.hue]} strokeOpacity={0.7}
                  style={{ filter: active ? `drop-shadow(0 0 8px ${H[n.hue]}66)` : undefined }} />
                <text x={left + 14} y={top + 13} fontSize={n.realName ? 10.5 : 8.5} fontWeight={n.realName ? 700 : 600}
                  fill={n.realName ? P.title : P.dim}
                  dominantBaseline="middle" style={{ letterSpacing: n.realName ? "0.01em" : "0.08em" }}>{labelText}</text>
                <text x={idX} y={top + 13} fontSize={10} fill={H[n.hue]}
                  dominantBaseline="middle" style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.02em" }}>{n.idVal}</text>
              </g>
            );
          })}
          {token && (
            <>
              <circle cx={token.x} cy={token.y} r={13} fill={P.particleHalo} />
              <circle cx={token.x} cy={token.y} r={6} fill={P.particle} />
            </>
          )}
        </g>
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5 text-2xs">
        {([["external", "External system"], ["service", "Service client"], ["agent", "AI agent (WLP)"], ["resource", "Resource"]] as const).map(([t, lbl]) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-soft">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t === "agent" ? H.triage : H[t as Hue] }} /> {lbl}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-mute">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.okta} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          id-jag hop · brokered by Okta
        </span>
      </div>
    </div>
  );
}
