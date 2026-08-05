"use client";

// The hero: a live two-agent delegation flow, with the capability boundary drawn.
//
//   Intake Service ──ticket.read──▶ Agent 1 ──delegate──▶ Agent 2 ──ticket.write──▶ Jira
//                                     │
//                                     ╳  ticket.write refused by Okta
//
// The diagram renders one of two narratives, derived from the events:
//
//   normal     the delegation path lights end to end and the refusal branch is
//              hidden entirely, because no refusal occurred.
//   violation  the refusal branch is the whole story, and Agent 2, the vault and
//              Jira stay dark, because the run never reached them. That darkness
//              is the evidence: the write did not happen.
//
// Okta brokers the agent-to-agent hop (id-jag), shown by the Okta node and its
// connector.
//
// Every pulse fires off a real ActivityEvent status transition. Raw tokens live
// on /tokens, not duplicated here.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Inbox, Server, Bot, SquareKanban, ShieldCheck, KeyRound, ShieldOff } from "lucide-react";
import { linkHorizontal, linkVertical, type DefaultLinkObject } from "d3-shape";
import { deriveAgentFlowState, type FlowStatus } from "@/lib/agentFlow";
import { latestByStep, type ActivityEvent } from "@/lib/events";
import { useResolvedTheme, vizPalette, withAlpha, type VizPalette } from "@/lib/theme";

// ---- fixed geometry (viewBox 0 0 1360 360) ----
const LANE = 188;
const NW = 208;
const NH = 88;
type NodeKey = "inbound" | "svc" | "agent1" | "agent2" | "jira" | "okta" | "vault" | "denied";
type Hue = keyof Pick<VizPalette, "neutral" | "service" | "triage" | "fulfill" | "okta" | "vault" | "bad">;

/** Geometry and identity are fixed; the actual colour is resolved per theme.
 *  The lane mirrors the Architecture fabric exactly: an inbound event (the
 *  trigger) reaches the Intake Service (a service client, the machine root),
 *  which mints Agent 1's read token. Two agents act; the Intake Service is not
 *  one of them. */
const NODES: Record<NodeKey, {
  cx: number; cy: number; w: number; h: number; hue: Hue;
  name: string; kind: string; Icon: typeof Bot;
}> = {
  inbound: { cx: 165, cy: LANE, w: NW, h: NH, hue: "neutral", name: "Inbound", kind: "external event", Icon: Inbox },
  svc: { cx: 420, cy: LANE, w: NW, h: NH, hue: "service", name: "Intake Service", kind: "service client", Icon: Server },
  agent1: { cx: 675, cy: LANE, w: NW, h: NH, hue: "triage", name: "Triage Agent", kind: "read only", Icon: Bot },
  agent2: { cx: 930, cy: LANE, w: NW, h: NH, hue: "fulfill", name: "Resolution Agent", kind: "write capable", Icon: Bot },
  jira: { cx: 1185, cy: LANE, w: NW, h: NH, hue: "neutral", name: "Jira", kind: "IT Service Desk", Icon: SquareKanban },
  okta: { cx: 803, cy: 52, w: 196, h: 54, hue: "okta", name: "Okta", kind: "brokers the hand-off", Icon: ShieldCheck },
  vault: { cx: 930, cy: 316, w: 176, h: 52, hue: "vault", name: "OPA Vault", kind: "vaulted secret", Icon: KeyRound },
  denied: { cx: 675, cy: 316, w: 196, h: 52, hue: "bad", name: "write refused", kind: "by Okta policy", Icon: ShieldOff },
};

const H = linkHorizontal();
const V = linkVertical();
const linkPath = (gen: typeof H, s: [number, number], t: [number, number]) =>
  gen({ source: s, target: t } as unknown as DefaultLinkObject) ?? "";
const N = NODES;
const EDGE_INBOUND = linkPath(H, [N.inbound.cx + NW / 2, LANE], [N.svc.cx - NW / 2, LANE]);
const EDGE_READ = linkPath(H, [N.svc.cx + NW / 2, LANE], [N.agent1.cx - NW / 2, LANE]);
const EDGE_DELEGATE = linkPath(H, [N.agent1.cx + NW / 2, LANE], [N.agent2.cx - NW / 2, LANE]);
const EDGE_JIRA = linkPath(H, [N.agent2.cx + NW / 2, LANE], [N.jira.cx - NW / 2, LANE]);
const EDGE_VAULT = linkPath(V, [N.vault.cx, N.vault.cy - N.vault.h / 2], [N.agent2.cx, LANE + NH / 2]);
// the refused branch: straight down out of Agent 1, going nowhere
const EDGE_DENIED = linkPath(V, [N.agent1.cx, LANE + NH / 2], [N.denied.cx, N.denied.cy - N.denied.h / 2]);
// Okta drops a dotted connector into the delegation hop's midpoint.
const OKTA_MID: [number, number] = [(N.agent1.cx + NW / 2 + N.agent2.cx - NW / 2) / 2, LANE];
const OKTA_CONN = linkPath(V, [N.okta.cx, N.okta.cy + N.okta.h / 2], OKTA_MID);

const hexA = withAlpha;

/** Keep a label inside its card: compress it only if it would otherwise spill
 *  past the box (this is what stops "→ Access Mgmt · 4 similar" overflowing). */
function fitText(text: string, fontSize: number, avail: number): { textLength?: number; lengthAdjust?: "spacingAndGlyphs" } {
  return text.length * fontSize * 0.56 > avail
    ? { textLength: Math.max(1, avail), lengthAdjust: "spacingAndGlyphs" }
    : {};
}

function statusColor(base: string, s: FlowStatus, P: VizPalette): string {
  return s === "idle" ? P.idle : s === "running" ? P.warn : s === "error" ? P.bad : base;
}

function useTokenTravel(ref: React.RefObject<SVGPathElement>, status: FlowStatus, reduced: boolean, ms = 900) {
  const prev = useRef<FlowStatus>(status);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const rose = prev.current === "running" && status === "ok";
    prev.current = status;
    if (!rose || reduced || !ref.current) return;
    const el = ref.current;
    const total = el.getTotalLength();
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const p = el.getPointAtLength(k * total);
      setPt({ x: p.x, y: p.y });
      if (k < 1) raf = requestAnimationFrame(step);
      else setPt(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [status, reduced, ref, ms]);
  return pt;
}

function Edge({ d, gradId, status, reduced, label, P }: {
  d: string; gradId: string; status: FlowStatus; reduced: boolean; label?: string | null; P: VizPalette;
}) {
  const ref = useRef<SVGPathElement>(null);
  const pt = useTokenTravel(ref, status, reduced);
  return (
    <g>
      <path ref={ref} d={d} fill="none" strokeWidth={2}
        stroke={status === "error" ? P.bad : `url(#${gradId})`}
        strokeOpacity={status === "idle" ? 0.25 : status === "ok" ? 0.85 : 0.9} strokeLinecap="round" />
      {status === "running" && !reduced && (
        <path d={d} fill="none" strokeWidth={2.5} stroke={`url(#${gradId})`} strokeLinecap="round"
          style={{ strokeDasharray: "5 10", animation: "flowdash .7s linear infinite" }} />
      )}
      {label && (
        <text textAnchor="middle" fontSize={11} fontWeight={600} fill={status === "idle" ? P.dim : P.sub}
          style={{ fontFamily: "var(--font-mono)" }}
          x={(ref.current?.getPointAtLength(0).x ?? 0)} y={LANE - 14}>
          {label}
        </text>
      )}
      {pt && (
        <>
          <circle cx={pt.x} cy={pt.y} r={11} fill={P.particleHalo} />
          <circle cx={pt.x} cy={pt.y} r={5} fill={P.particle}
            style={{ filter: `drop-shadow(0 0 6px ${hexA(P.okta, 0.9)})` }} />
        </>
      )}
    </g>
  );
}

/** The refused branch. Dashed, red, and crossed, so it reads as "this did not
 *  happen" rather than as another step that did. */
function DeniedBranch({ d, active, reduced, P }: {
  d: string; active: boolean; reduced: boolean; P: VizPalette;
}) {
  const stroke = active ? hexA(P.bad, 0.75) : P.idle;
  const mx = N.agent1.cx;
  const my = (LANE + NH / 2 + N.denied.cy - N.denied.h / 2) / 2;
  return (
    <g>
      <path d={d} fill="none" strokeWidth={1.8} strokeDasharray="4 5" strokeLinecap="round" stroke={stroke} />
      {active && (
        <g stroke={hexA(P.bad, 0.95)} strokeWidth={2.2} strokeLinecap="round"
          style={reduced ? undefined : { filter: `drop-shadow(0 0 6px ${hexA(P.bad, 0.6)})` }}>
          <line x1={mx - 7} y1={my - 7} x2={mx + 7} y2={my + 7} />
          <line x1={mx + 7} y1={my - 7} x2={mx - 7} y2={my + 7} />
        </g>
      )}
    </g>
  );
}

function OktaConnector({ d, to, active, flowing, reduced, P }: {
  d: string; to: [number, number]; active: boolean; flowing: boolean; reduced: boolean; P: VizPalette;
}) {
  const stroke = active ? hexA(P.okta, 0.8) : P.idle;
  return (
    <g>
      <path d={d} fill="none" strokeWidth={1.6} strokeDasharray="1.5 6" strokeLinecap="round" stroke={stroke}
        style={flowing && !reduced ? { animation: "flowdash 1.1s linear infinite" } : undefined} />
      <circle cx={to[0]} cy={to[1]} r={2.8} fill={stroke}
        style={active ? { filter: `drop-shadow(0 0 5px ${hexA(P.okta, 0.7)})` } : undefined} />
    </g>
  );
}

function Node({ k, status, label, hover, setHover, P }: {
  k: NodeKey; status: FlowStatus; label?: string | null;
  hover: NodeKey | null; setHover: (k: NodeKey | null) => void; P: VizPalette;
}) {
  const n = NODES[k];
  const base = P[n.hue];
  const compact = k === "okta" || k === "vault" || k === "denied";
  const c = statusColor(base, status, P);
  const active = status === "running" || status === "ok";
  const hovered = hover === k;
  const dimmed = hover !== null && !hovered;
  const tlx = n.cx - n.w / 2, tly = n.cy - n.h / 2;
  const iconC = status === "idle" ? P.sub : c;
  const secColor = status === "running" ? P.warn : status === "ok" ? base : P.sub;
  const glow = hovered
    ? `drop-shadow(0 0 16px ${hexA(active ? c : base, 0.5)})`
    : active ? `drop-shadow(0 0 12px ${hexA(c, 0.33)})` : undefined;
  return (
    <motion.g className="cursor-default" initial={false} animate={{ opacity: dimmed ? 0.45 : 1 }}
      onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} style={{ filter: glow }}>
      <motion.rect x={tlx} y={tly} width={n.w} height={n.h} rx={13} initial={false}
        animate={{
          fill: hexA(c, status === "idle" ? 0.05 : 0.12),
          stroke: hexA(hovered ? base : c, status === "idle" && !hovered ? 0.45 : 0.95),
        }}
        transition={{ duration: 0.3 }} strokeWidth={hovered ? 2.4 : 1.5}
        className={status === "running" ? "animate-pulse" : undefined} />
      {compact ? (
        <>
          <g transform={`translate(${tlx + 16},${n.cy - 12})`}><n.Icon width={24} height={24} color={iconC} strokeWidth={2} /></g>
          <text x={tlx + 48} y={n.cy - 3} fontSize={15} fontWeight={600} fill={P.title} {...fitText(n.name, 15, n.w - 60)}>{n.name}</text>
          {label ? (
            <g transform={`translate(${tlx + 48},${n.cy + 14})`}>
              <circle cx={3} cy={-3} r={3.5} fill={secColor} className={status === "running" ? "live-dot" : undefined} />
              <text x={13} y={0} fontSize={11.5} fontWeight={500} fill={secColor} {...fitText(label, 11.5, n.w - 73)}>{label}</text>
            </g>
          ) : (
            <text x={tlx + 48} y={n.cy + 14} fontSize={11.5} fill={P.sub} {...fitText(n.kind, 11.5, n.w - 60)}>{n.kind}</text>
          )}
        </>
      ) : (
        <>
          <g transform={`translate(${tlx + 16},${tly + 16})`}><n.Icon width={26} height={26} color={iconC} strokeWidth={2} /></g>
          <text x={tlx + 52} y={tly + 31} fontSize={16.5} fontWeight={600} fill={P.title} {...fitText(n.name, 16.5, n.w - 64)}>{n.name}</text>
          <text x={tlx + 52} y={tly + 50} fontSize={12} fill={P.sub} {...fitText(n.kind, 12, n.w - 64)}>{n.kind}</text>
          {label && (
            <g transform={`translate(${tlx + 16},${tly + 70})`}>
              <circle cx={3.5} cy={-3.5} r={3.5} fill={secColor} className={status === "running" ? "live-dot" : undefined} />
              <text x={14} y={0} fontSize={12} fontWeight={500} fill={secColor} {...fitText(label, 12, n.w - 42)}>{label}</text>
            </g>
          )}
        </>
      )}
    </motion.g>
  );
}

function Grad({ id, from, to, x1, x2 }: { id: string; from: string; to: string; x1: number; x2: number }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={LANE} x2={x2} y2={LANE}>
      <stop offset="0%" stopColor={from} /><stop offset="100%" stopColor={to} />
    </linearGradient>
  );
}

/** A scope label lifted ABOVE the lane, with a short dashed arrow pointing down to
 *  the hop it governs. Keeps the scope name out of the tight gap between two cards,
 *  so the boxes can breathe and grow. */
function ScopeTag({ x, label, color }: { x: number; label: string; color: string }) {
  return (
    <g className="pointer-events-none">
      <text x={x} y={116} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={color}
        style={{ fontFamily: "var(--font-mono)" }}>{label}</text>
      <line x1={x} y1={124} x2={x} y2={LANE - 10} stroke={color} strokeOpacity={0.65}
        strokeWidth={1.3} strokeDasharray="2 3" />
      <path d={`M ${x - 4} ${LANE - 11} L ${x + 4} ${LANE - 11} L ${x} ${LANE - 3} Z`}
        fill={color} fillOpacity={0.85} />
    </g>
  );
}

export default function AgentFlowGraph({ events }: { events: ActivityEvent[] }) {
  const state = useMemo(() => deriveAgentFlowState(events), [events]);
  const reduced = useReducedMotion() ?? false;
  const P = vizPalette(useResolvedTheme());
  const [hoverNode, setHoverNode] = useState<NodeKey | null>(null);
  const delegate = state.edges.agent1ToAgent2.status;
  const anyRunning = Object.values(state.nodes).some((s) => s === "running") || delegate === "running";

  const labels = useMemo(() => {
    const by = latestByStep(events);
    const dept = (by.get("classify")?.data?.department as string) || null;
    const jw = by.get("jira_write");
    const key = (jw?.data?.issue_key as string) || null;
    const pr = (jw?.data?.priority as string) || null;
    const run = (s: FlowStatus) => s === "running";
    const reads = state.readCount;
    return {
      inbound: state.nodes.inbound === "ok" ? "received" : null,
      svc: run(state.nodes.svc) ? "minting…" : state.nodes.svc === "ok" ? "read token minted" : null,
      agent1: run(state.nodes.agent1)
        ? "reading…"
        : dept
          ? `→ ${dept.replace(/\bManagement\b/, "Mgmt")}${reads !== null ? ` · ${reads} similar` : ""}`
          : null,
      agent2: run(state.nodes.agent2) ? "writing…" : state.nodes.agent2 === "ok" ? "filed" : null,
      jira: key ? `${key}${pr ? ` · ${pr}` : ""}` : null,
      okta: delegate === "running" ? "issuing ID-JAG…" : delegate === "ok" ? "ID-JAG issued" : null,
      vault: state.vaultBadge === "ok" ? "secret released" : state.vaultBadge === "running" ? "releasing…" : null,
      denied: state.writeDenied.denied ? state.writeDenied.error ?? "access_denied" : null,
    };
  }, [events, state, delegate]);

  const violation = state.path === "violation";
  const deniedActive = violation && state.writeDenied.denied;

  return (
    <div className={`card edge-accent hero-mesh overflow-hidden p-4 transition-shadow ${anyRunning ? "shadow-[0_0_0_1px_rgba(122,162,255,0.25),0_8px_40px_-12px_rgba(122,162,255,0.25)]" : ""}`}>
      <svg viewBox="0 0 1360 360" className="w-full" role="img"
        aria-label={violation
          ? "Blocked run. The Triage Agent holds ticket.read and asked Okta for ticket.write. Okta refused, so the run stopped: the Resolution Agent, the vault and Jira were never reached and nothing was written."
          : "Delegation flow. An inbound ticket, the trigger, reaches the Atlas Intake Service, a service client that mints the Triage Agent's ticket.read token. The Triage Agent delegates to the Resolution Agent, which holds ticket.write and files to Jira using a credential released from the Okta Privileged Access vault."}>
        <defs>
          <Grad id="g-in" from={P.neutral} to={P.service} x1={N.inbound.cx} x2={N.svc.cx} />
          <Grad id="g-read" from={P.service} to={P.triage} x1={N.svc.cx} x2={N.agent1.cx} />
          <Grad id="g-del" from={P.triage} to={P.fulfill} x1={N.agent1.cx} x2={N.agent2.cx} />
          <Grad id="g-jira" from={P.fulfill} to={P.neutral} x1={N.agent2.cx} x2={N.jira.cx} />
          <Grad id="g-vault" from={P.vault} to={P.fulfill} x1={N.vault.cx} x2={N.agent2.cx} />
        </defs>

        <Edge d={EDGE_INBOUND} gradId="g-in" status={state.edges.inboundToSvc.status} reduced={reduced} P={P} />
        {!violation && <Edge d={EDGE_VAULT} gradId="g-vault" status={state.vaultBadge} reduced={reduced} P={P} />}
        <Edge d={EDGE_READ} gradId="g-read" status={state.edges.svcToAgent1.status} reduced={reduced} P={P} />
        <Edge d={EDGE_DELEGATE} gradId="g-del" status={delegate} reduced={reduced} P={P} />
        <Edge d={EDGE_JIRA} gradId="g-jira" status={state.edges.agent2ToJira.status} reduced={reduced} P={P} />
        {violation && <DeniedBranch d={EDGE_DENIED} active={deniedActive} reduced={reduced} P={P} />}
        <OktaConnector d={OKTA_CONN} to={OKTA_MID}
          active={delegate === "running" || delegate === "ok"} flowing={delegate === "running"} reduced={reduced} P={P} />

        {/* scope labels, lifted above the lane with an arrow pointing down to the
            hop they govern, so they never crowd the gap between the boxes. The read
            token is minted by the Intake Service for Agent 1. */}
        <ScopeTag x={(N.svc.cx + N.agent1.cx) / 2}
          label={state.edges.svcToAgent1.scope ?? "ticket.read"}
          color={state.edges.svcToAgent1.scope ? P.resolve : P.dim} />
        <ScopeTag x={(N.agent2.cx + N.jira.cx) / 2}
          label={state.edges.agent2ToJira.scope ?? "ticket.write"}
          color={state.edges.agent2ToJira.scope ? P.fulfill : P.dim} />
        {violation && (
          <text x={N.agent1.cx + 14} y={(LANE + NH / 2 + N.denied.cy) / 2 + 4} fontSize={10.5}
            fontWeight={600} fill={deniedActive ? P.bad : P.dim}
            style={{ fontFamily: "var(--font-mono)" }}>
            ticket.write
          </text>
        )}

        <Node k="okta" status={delegate} label={labels.okta} hover={hoverNode} setHover={setHoverNode} P={P} />
        {!violation && <Node k="vault" status={state.vaultBadge} label={labels.vault} hover={hoverNode} setHover={setHoverNode} P={P} />}
        {violation && <Node k="denied" status={deniedActive ? "error" : "idle"} label={labels.denied} hover={hoverNode} setHover={setHoverNode} P={P} />}
        {/* Trigger callout: name WHERE the run starts. The inbound event is the
            trigger and carries no identity; authority begins one hop later, at the
            Intake Service. This is the piece customers most often miss. */}
        <g className="pointer-events-none">
          <rect x={N.inbound.cx - 52} y={92} width={104} height={22} rx={11}
            fill={hexA(P.warn, 0.14)} stroke={hexA(P.warn, 0.75)} strokeWidth={1} />
          <text x={N.inbound.cx} y={104} textAnchor="middle" fontSize={10.5} fontWeight={700}
            fill={P.warn} dominantBaseline="middle"
            style={{ letterSpacing: "0.1em", fontFamily: "var(--font-mono)" }}>▶ TRIGGER</text>
          <line x1={N.inbound.cx} y1={114} x2={N.inbound.cx} y2={LANE - NH / 2}
            stroke={hexA(P.warn, 0.5)} strokeWidth={1.2} strokeDasharray="3 3" />
        </g>
        <Node k="inbound" status={state.nodes.inbound} label={labels.inbound} hover={hoverNode} setHover={setHoverNode} P={P} />
        <Node k="svc" status={state.nodes.svc} label={labels.svc} hover={hoverNode} setHover={setHoverNode} P={P} />
        <Node k="agent1" status={state.nodes.agent1} label={labels.agent1} hover={hoverNode} setHover={setHoverNode} P={P} />
        <Node k="agent2" status={state.nodes.agent2} label={labels.agent2} hover={hoverNode} setHover={setHoverNode} P={P} />
        <Node k="jira" status={state.nodes.jira} label={labels.jira} hover={hoverNode} setHover={setHoverNode} P={P} />
      </svg>

      {/* The piece customers miss: the trigger is an event, not an identity. */}
      <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2 text-2xs leading-snug text-soft">
        <span className="mt-px shrink-0 font-mono font-bold tracking-wider text-warn">▶ TRIGGER</span>
        <span>
          The inbound ticket is the trigger: an <span className="text-ink">event, not an identity</span>, so it
          carries no token or scope. Authority begins one hop later, at the{" "}
          <span className="text-ink">Intake Service</span> (a service client, the machine root), which mints the{" "}
          <span className="font-mono text-resolve">ticket.read</span> token the Triage Agent holds. Everything
          after that is a signed, attributable delegation, not a shared key.
        </span>
      </div>

      {/* Answer the "is that three agents?" question head on: two agents act, and
          the Intake Service is a service client, not an agent. */}
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-2xs leading-snug text-soft">
        <span className="mt-px shrink-0 font-mono font-bold tracking-wider text-ink">2 AGENTS</span>
        <span>
          Two AI agents act, each its own Okta workload principal:{" "}
          <span className="font-medium text-resolve">the Triage Agent</span> can only read
          (<span className="font-mono text-resolve">ticket.read</span>) and hands off to{" "}
          <span className="font-medium text-fulfill">the Resolution Agent</span>, which can write
          (<span className="font-mono text-fulfill">ticket.write</span>). The{" "}
          <span className="text-ink">Intake Service</span> ahead of them is a service client that starts the
          chain, not an agent. Okta brokers the hand-off and refuses any scope an agent was not granted.
        </span>
      </div>

      {state.errorMessage && <div className="mt-2 text-[13px] text-bad">{state.errorMessage}</div>}
    </div>
  );
}
