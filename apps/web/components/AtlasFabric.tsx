"use client";

// The Identity Fabric, an interactive, force-directed map of the whole Okta A2A
// architecture, built with real d3-force. A graph you *explore*:
//   • d3-force lays it out organically (charge + links + per-column forceX lanes)
//   • d3-zoom: scroll to zoom, drag background to pan, "Fit" to reset
//   • drag any node (d3.pointer stays accurate under zoom); the sim reflows
//   • hover or tap a node to spotlight its connections AND open its Okta identity
//     in the side panel (name, id, scope, lane, connection, admin-console link)
//   • "Replay delegation" sends a token down the real path: service → 2 agents → Jira
//
// Every node is a REAL object in the reference tenant, and it says so: the card
// shows the object's real Okta name (e.g. "Atlas Triage Agent"), and the panel
// connects it the rest of the way, the workload-principal / app / secret id, the
// authorization-server lane, the scope condition on the connection, and a link
// straight into the Okta admin console. The mapping lives in lib/oktaIdentities.ts.
// Okta itself isn't a node; it's the issuer that brokers the agent→agent hop,
// shown as the id-jag shield on that edge (exactly where the token is minted).

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide,
  zoom as d3zoom, zoomIdentity, select, pointer,
  type Simulation, type ZoomTransform, type ZoomBehavior,
} from "d3";
import { ExternalLink, X } from "lucide-react";
import { useResolvedTheme, vizPalette, withAlpha } from "@/lib/theme";
import { identityFor } from "@/lib/oktaIdentities";

type NType = "external" | "service" | "agent" | "resource";
type IconName = "inbox" | "server" | "bot" | "lock" | "kanban";
interface FNode {
  id: string; icon: IconName; type: NType; hue: Hue;
  tx: number; ty: number; x: number; y: number; fx?: number | null; fy?: number | null;
}
interface FLink { source: string | FNode; target: string | FNode; brokered?: boolean; kind?: "branch"; scope?: string }

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

// A left-to-right delegation pipeline; the vault hangs directly BELOW Agent 2
// (the only agent trusted to pull the prod credential) as a governance side-branch.
// Geometry + icon + hue only, every label, id, and Okta fact comes from
// lib/oktaIdentities.ts, so the diagram and the tenant never drift apart.
//
// Two agents, distinguished by what they may do. Agent 1 holds ticket.read;
// Agent 2 is the only client authorized on the write authorization server, so it
// is the only one that can hold ticket.write. Lanes are spaced wide enough that no
// card ever touches another and the arrowheads have room to land.
const RAW_NODES: Omit<FNode, "x" | "y">[] = [
  { id: "inbound", icon: "inbox", type: "external", hue: "external", tx: 150, ty: 180 },
  { id: "svc", icon: "server", type: "service", hue: "service", tx: 470, ty: 180 },
  { id: "triage", icon: "bot", type: "agent", hue: "triage", tx: 790, ty: 180 },
  { id: "fulfill", icon: "bot", type: "agent", hue: "fulfill", tx: 1110, ty: 180 },
  { id: "jira", icon: "kanban", type: "external", hue: "external", tx: 1430, ty: 180 },
  { id: "vault", icon: "lock", type: "resource", hue: "resource", tx: 1110, ty: 445 },
];
const RAW_LINKS: FLink[] = [
  { source: "inbound", target: "svc" },
  { source: "svc", target: "triage", scope: "ticket.read" },
  { source: "triage", target: "fulfill", brokered: true },
  { source: "fulfill", target: "vault", kind: "branch" },
  { source: "fulfill", target: "jira", scope: "ticket.write" },
];
// Replay dips into the OPA Vault (Agent 2 fetching the Jira credential) and back
// up before filing to Jira, so the credential pull is actually shown.
const REPLAY = ["inbound", "svc", "triage", "fulfill", "vault", "fulfill", "jira"];

const NW = 224, NH = 66; // node card size, wide enough to hold a real Okta name
const CHIP_CX = -NW / 2 + 30;      // icon chip centre
const TEXT_X = CHIP_CX + 30;       // where the label text begins
const TEXT_MAXW = NW / 2 - 12 - TEXT_X; // usable text width, right pad = 12

/** SVG-text props that GUARANTEE the label stays inside its card: if the string
 *  is wider than the box, compress it to fit (spacingAndGlyphs) rather than let it
 *  spill past the border; short strings render naturally. */
function fit(text: string, fontSize: number): { textLength?: number; lengthAdjust?: "spacingAndGlyphs" } {
  const approx = text.length * fontSize * 0.56;
  return approx > TEXT_MAXW ? { textLength: TEXT_MAXW, lengthAdjust: "spacingAndGlyphs" } : {};
}

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
  const [selected, setSelected] = useState<string | null>(null);
  const [token, setToken] = useState<{ x: number; y: number } | null>(null);
  const P = vizPalette(useResolvedTheme());
  const H = hues(P);

  useEffect(() => {
    const nodes = nodesRef.current, links = linksRef.current;
    const sim = forceSimulation<FNode>(nodes)
      .force("link", forceLink<FNode, FLink>(links).id((d) => d.id).distance(280).strength(0.55))
      .force("charge", forceManyBody().strength(-1200))
      .force("x", forceX<FNode>((d) => d.tx).strength(0.46))
      .force("y", forceY<FNode>((d) => d.ty).strength(0.28))
      .force("collide", forceCollide(130))
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
    setSelected(id); // a tap pins this node's Okta identity in the panel
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

  function fit_() {
    if (!zoomRef.current) return;
    select(svgRef.current!).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
  }

  function replay() {
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const pts = REPLAY.map((id) => byId.get(id)).filter((n): n is FNode => !!n);
    if (pts.length < 2) return;
    cancelAnimationFrame(rafRef.current); // a second click restarts, never races
    const segMs = 1000; // slower, more deliberate flow, easier to follow
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

  // While the replay dot travels, note whichever node it is passing so the panel
  // can narrate the hop.
  let passingId: string | null = null;
  if (token) {
    let best = 118; // generous radius so a node lights well before + lingers after the dot passes
    for (const n of nodes) {
      const d = Math.hypot(n.x - token.x, n.y - token.y);
      if (d < best) { best = d; passingId = n.id; }
    }
  }

  // What the detail panel shows: live hover wins, then the replay dot's node,
  // then the pinned selection. So you can pin a node and still move the mouse to
  // click its "View in Okta" link.
  const panelId = hovered ?? (token ? passingId : null) ?? selected;
  const panelNode = panelId ? byId.get(panelId) : undefined;
  const ident = panelId ? identityFor(panelId) : null;
  const panelHue = panelNode ? H[panelNode.hue] : P.okta;

  return (
    <div className="card edge-accent hero-mesh relative overflow-hidden">
      <div className="pointer-events-none absolute left-4 top-3 z-10 text-2xs uppercase tracking-wider text-mute">
        Identity Fabric · scroll to zoom · drag nodes · tap a node for its Okta identity
      </div>
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <button onClick={replay} className="rounded-md bg-gradient-to-b from-accent to-[#5B86E8] px-2.5 py-1 text-2xs font-medium text-white shadow-[0_2px_10px_-2px_rgba(122,162,255,0.5)] hover:brightness-110">▷ Replay delegation</button>
        <button onClick={fit_} className="rounded-md border border-line bg-raised px-2.5 py-1 text-2xs text-soft hover:text-ink">Fit</button>
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
            // Agent 2's bottom-center into the Vault's top-center, an intentional
            // governance side-branch, not a stray diagonal arrow.
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
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const scopeColor = l.scope === "ticket.write" ? H.fulfill : H.resolve;
            return (
              <g key={i}>
                <line x1={a.x + ux * off} y1={a.y + uy * off} x2={b.x - ux * off} y2={b.y - uy * off}
                  stroke={H[b.hue]} strokeOpacity={active ? 0.85 : 0.12}
                  strokeWidth={2.4} markerEnd={`url(#${uid}-arw-${b.hue})`} />
                {/* scope carried on this hop, the CRUD story, readable at a glance.
                    Sits in the gap between two cards, well clear of both. */}
                {l.scope && (
                  <text x={mx} y={my - 13} textAnchor="middle" fontSize={11} fontWeight={600}
                    fill={active ? scopeColor : P.dim} style={{ fontFamily: "var(--font-mono)", opacity: active ? 1 : 0.5 }}>
                    {l.scope}
                  </text>
                )}
              </g>
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
                  style={{ filter: `drop-shadow(0 0 6px ${withAlpha(P.okta, 0.4)})` }} />
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
          {/* nodes, premium glass cards. Card = real Okta name + role; the full
              identity (id, lane, scope, connection, admin link) lives in the panel. */}
          {nodes.map((n) => {
            const hl = hovered === n.id || selected === n.id;
            const opacity = neighbors && !neighbors.has(n.id) ? 0.22 : 1;
            const id = identityFor(n.id);
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
                  style={{ filter: `drop-shadow(0 6px 14px rgba(0,0,0,0.28))${hl ? ` drop-shadow(0 0 12px ${withAlpha(H[n.hue], 0.53)})` : ""}` }} />
                {/* icon chip (vertically centered) */}
                <rect x={CHIP_CX - 18} y={-18} width={36} height={36} rx={9} fill={H[n.hue]} opacity={0.14} />
                <rect x={CHIP_CX - 18} y={-18} width={36} height={36} rx={9} fill="none" stroke={H[n.hue]} strokeOpacity={0.42} />
                <g transform={`translate(${CHIP_CX},0) scale(0.75)`} stroke={H[n.hue]} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <g transform="translate(-12,-12)">{glyph(n.icon)}</g>
                </g>
                {/* real Okta name + role, both constrained to stay inside the card */}
                <text x={TEXT_X} y={-4} fontSize={13} fontWeight={700} fill={P.title} {...fit(id.oktaName, 13)}>
                  {id.oktaName}
                </text>
                <text x={TEXT_X} y={15} fontSize={11} fill={hl ? H[n.hue] : P.sub} {...fit(id.role, 11)}>
                  {id.role}
                </text>
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

      {/* Okta identity panel, HTML, so text is always readable and never overlaps
          the SVG. This is the "connect the dots" surface: it names the real Okta
          object behind the highlighted node and links straight into the console. */}
      <div className="pointer-events-none absolute bottom-14 left-4 z-10 w-[336px]">
        {ident ? (
          <div className="pointer-events-auto rounded-xl border bg-panel/95 p-3.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] backdrop-blur"
            style={{ borderColor: withAlpha(panelHue, 0.5) }}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-2xs font-semibold uppercase tracking-wider" style={{ color: panelHue }}>
                {ident.kindLabel}
              </div>
              {selected && (
                <button onClick={() => setSelected(null)} className="text-mute hover:text-ink" title="Clear">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1 text-[15px] font-semibold leading-tight text-bright">{ident.oktaName}</div>
            {ident.hasOktaObject && ident.oktaId && (
              <div className="mt-1 break-all font-mono text-2xs text-soft">{ident.oktaId}</div>
            )}
            {ident.breadcrumb && (
              <div className="mt-1 text-2xs text-mute">{ident.breadcrumb}</div>
            )}
            {ident.facts && ident.facts.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {ident.facts.map((f, i) => (
                  <li key={i} className="flex gap-1.5 text-2xs leading-snug text-body">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full" style={{ background: panelHue }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
            {ident.hasOktaObject && ident.adminUrl ? (
              <a href={ident.adminUrl} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-2xs font-medium transition-colors hover:brightness-110"
                style={{ borderColor: withAlpha(panelHue, 0.5), color: panelHue }}>
                <ExternalLink className="h-3 w-3" /> View in Okta admin
              </a>
            ) : (
              <div className="mt-3 text-2xs italic text-mute">Not an Okta identity.</div>
            )}
          </div>
        ) : (
          <div className="pointer-events-auto rounded-xl border border-dashed border-line bg-panel/80 px-3.5 py-2.5 text-2xs leading-snug text-mute backdrop-blur">
            Tap or hover a node to see the real Okta object behind it, its id, scope,
            authorization-server lane, and a link into the admin console.
          </div>
        )}
      </div>

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
