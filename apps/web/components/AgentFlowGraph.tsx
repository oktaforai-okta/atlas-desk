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
import { Inbox, Bot, SquareKanban, ShieldCheck, KeyRound, ShieldOff } from "lucide-react";
import { linkHorizontal, linkVertical, type DefaultLinkObject } from "d3-shape";
import { deriveAgentFlowState, type FlowStatus } from "@/lib/agentFlow";
import { TRIAGE_COLOR, RESOLVE_COLOR, FULFILL_COLOR, VAULT_COLOR } from "@/lib/identities";
import { latestByStep, type ActivityEvent } from "@/lib/events";

const NEUTRAL = "#8B96A8";
const OKTA = "#93B4FF";
const WARN = "#F2B450";
const BAD = "#FF6168";

// ---- fixed geometry (viewBox 0 0 1200 360) ----
const LANE = 188;
const NW = 168;
const NH = 84;
type NodeKey = "intake" | "agent1" | "agent2" | "jira" | "okta" | "vault" | "denied";
const NODES: Record<NodeKey, {
  cx: number; cy: number; w: number; h: number; color: string;
  name: string; kind: string; Icon: typeof Bot;
}> = {
  intake: { cx: 108, cy: LANE, w: NW, h: NH, color: NEUTRAL, name: "Intake", kind: "external system", Icon: Inbox },
  agent1: { cx: 392, cy: LANE, w: NW, h: NH, color: TRIAGE_COLOR, name: "Agent 1", kind: "read only", Icon: Bot },
  agent2: { cx: 706, cy: LANE, w: NW, h: NH, color: FULFILL_COLOR, name: "Agent 2", kind: "write capable", Icon: Bot },
  jira: { cx: 1010, cy: LANE, w: NW, h: NH, color: NEUTRAL, name: "Jira", kind: "IT Service Desk", Icon: SquareKanban },
  okta: { cx: 549, cy: 52, w: 196, h: 54, color: OKTA, name: "Okta", kind: "brokers the hand-off", Icon: ShieldCheck },
  vault: { cx: 880, cy: 316, w: 168, h: 52, color: VAULT_COLOR, name: "OPA Vault", kind: "vaulted secret", Icon: KeyRound },
  denied: { cx: 392, cy: 316, w: 196, h: 52, color: BAD, name: "write refused", kind: "by Okta policy", Icon: ShieldOff },
};

const H = linkHorizontal();
const V = linkVertical();
const linkPath = (gen: typeof H, s: [number, number], t: [number, number]) =>
  gen({ source: s, target: t } as unknown as DefaultLinkObject) ?? "";
const N = NODES;
const EDGE_INTAKE = linkPath(H, [N.intake.cx + NW / 2, LANE], [N.agent1.cx - NW / 2, LANE]);
const EDGE_DELEGATE = linkPath(H, [N.agent1.cx + NW / 2, LANE], [N.agent2.cx - NW / 2, LANE]);
const EDGE_JIRA = linkPath(H, [N.agent2.cx + NW / 2, LANE], [N.jira.cx - NW / 2, LANE]);
const EDGE_VAULT = linkPath(V, [N.vault.cx, N.vault.cy - N.vault.h / 2], [N.agent2.cx + 40, LANE + NH / 2]);
// the refused branch: straight down out of Agent 1, going nowhere
const EDGE_DENIED = linkPath(V, [N.agent1.cx, LANE + NH / 2], [N.denied.cx, N.denied.cy - N.denied.h / 2]);
// Okta drops a dotted connector into the delegation hop's midpoint.
const OKTA_MID: [number, number] = [(N.agent1.cx + NW / 2 + N.agent2.cx - NW / 2) / 2, LANE];
const OKTA_CONN = linkPath(V, [N.okta.cx, N.okta.cy + N.okta.h / 2], OKTA_MID);

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function statusColor(base: string, s: FlowStatus): string {
  return s === "idle" ? "#39424F" : s === "running" ? WARN : s === "error" ? BAD : base;
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

function Edge({ d, gradId, status, reduced, label }: {
  d: string; gradId: string; status: FlowStatus; reduced: boolean; label?: string | null;
}) {
  const ref = useRef<SVGPathElement>(null);
  const pt = useTokenTravel(ref, status, reduced);
  return (
    <g>
      <path ref={ref} d={d} fill="none" strokeWidth={2}
        stroke={status === "error" ? BAD : `url(#${gradId})`}
        strokeOpacity={status === "idle" ? 0.25 : status === "ok" ? 0.85 : 0.9} strokeLinecap="round" />
      {status === "running" && !reduced && (
        <path d={d} fill="none" strokeWidth={2.5} stroke={`url(#${gradId})`} strokeLinecap="round"
          style={{ strokeDasharray: "5 10", animation: "flowdash .7s linear infinite" }} />
      )}
      {label && (
        <text textAnchor="middle" fontSize={11} fontWeight={600} fill={status === "idle" ? "#4A5462" : "#9AA6B8"}
          style={{ fontFamily: "var(--font-mono)" }}
          x={(ref.current?.getPointAtLength(0).x ?? 0)} y={LANE - 14}>
          {label}
        </text>
      )}
      {pt && (
        <>
          <circle cx={pt.x} cy={pt.y} r={11} fill={hexA("#F5F8FC", 0.12)} />
          <circle cx={pt.x} cy={pt.y} r={5} fill="#F8FAFF" style={{ filter: "drop-shadow(0 0 6px rgba(180,205,255,0.9))" }} />
        </>
      )}
    </g>
  );
}

/** The refused branch. Dashed, red, and crossed, so it reads as "this did not
 *  happen" rather than as another step that did. */
function DeniedBranch({ d, active, reduced }: { d: string; active: boolean; reduced: boolean }) {
  const stroke = active ? hexA(BAD, 0.75) : "#2A323F";
  const mx = N.agent1.cx;
  const my = (LANE + NH / 2 + N.denied.cy - N.denied.h / 2) / 2;
  return (
    <g>
      <path d={d} fill="none" strokeWidth={1.8} strokeDasharray="4 5" strokeLinecap="round" stroke={stroke} />
      {active && (
        <g stroke={hexA(BAD, 0.95)} strokeWidth={2.2} strokeLinecap="round"
          style={reduced ? undefined : { filter: `drop-shadow(0 0 6px ${hexA(BAD, 0.6)})` }}>
          <line x1={mx - 7} y1={my - 7} x2={mx + 7} y2={my + 7} />
          <line x1={mx + 7} y1={my - 7} x2={mx - 7} y2={my + 7} />
        </g>
      )}
    </g>
  );
}

function OktaConnector({ d, to, active, flowing, reduced }: {
  d: string; to: [number, number]; active: boolean; flowing: boolean; reduced: boolean;
}) {
  const stroke = active ? hexA(OKTA, 0.8) : "#2A323F";
  return (
    <g>
      <path d={d} fill="none" strokeWidth={1.6} strokeDasharray="1.5 6" strokeLinecap="round" stroke={stroke}
        style={flowing && !reduced ? { animation: "flowdash 1.1s linear infinite" } : undefined} />
      <circle cx={to[0]} cy={to[1]} r={2.8} fill={stroke}
        style={active ? { filter: `drop-shadow(0 0 5px ${hexA(OKTA, 0.7)})` } : undefined} />
    </g>
  );
}

function Node({ k, status, label, hover, setHover }: {
  k: NodeKey; status: FlowStatus; label?: string | null;
  hover: NodeKey | null; setHover: (k: NodeKey | null) => void;
}) {
  const n = NODES[k];
  const compact = k === "okta" || k === "vault" || k === "denied";
  const c = statusColor(n.color, status);
  const active = status === "running" || status === "ok";
  const hovered = hover === k;
  const dimmed = hover !== null && !hovered;
  const tlx = n.cx - n.w / 2, tly = n.cy - n.h / 2;
  const iconC = status === "idle" ? NEUTRAL : c;
  const secColor = status === "running" ? WARN : status === "ok" ? n.color : NEUTRAL;
  const glow = hovered
    ? `drop-shadow(0 0 16px ${hexA(active ? c : n.color, 0.5)})`
    : active ? `drop-shadow(0 0 12px ${hexA(c, 0.33)})` : undefined;
  return (
    <motion.g className="cursor-default" initial={false} animate={{ opacity: dimmed ? 0.45 : 1 }}
      onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} style={{ filter: glow }}>
      <motion.rect x={tlx} y={tly} width={n.w} height={n.h} rx={13} initial={false}
        animate={{
          fill: hexA(c, status === "idle" ? 0.05 : 0.12),
          stroke: hexA(hovered ? n.color : c, status === "idle" && !hovered ? 0.45 : 0.95),
        }}
        transition={{ duration: 0.3 }} strokeWidth={hovered ? 2.4 : 1.5}
        className={status === "running" ? "animate-pulse" : undefined} />
      {compact ? (
        <>
          <g transform={`translate(${tlx + 16},${n.cy - 12})`}><n.Icon width={24} height={24} color={iconC} strokeWidth={2} /></g>
          <text x={tlx + 48} y={n.cy - 3} fontSize={15} fontWeight={600} fill="#F0F3F8">{n.name}</text>
          {label ? (
            <g transform={`translate(${tlx + 48},${n.cy + 14})`}>
              <circle cx={3} cy={-3} r={3.5} fill={secColor} className={status === "running" ? "live-dot" : undefined} />
              <text x={13} y={0} fontSize={11.5} fontWeight={500} fill={secColor}>{label}</text>
            </g>
          ) : (
            <text x={tlx + 48} y={n.cy + 14} fontSize={11.5} fill="#8B96A8">{n.kind}</text>
          )}
        </>
      ) : (
        <>
          <g transform={`translate(${tlx + 16},${tly + 16})`}><n.Icon width={26} height={26} color={iconC} strokeWidth={2} /></g>
          <text x={tlx + 52} y={tly + 31} fontSize={16.5} fontWeight={600} fill="#F0F3F8">{n.name}</text>
          <text x={tlx + 52} y={tly + 50} fontSize={12} fill="#8B96A8">{n.kind}</text>
          {label && (
            <g transform={`translate(${tlx + 16},${tly + 70})`}>
              <circle cx={3.5} cy={-3.5} r={3.5} fill={secColor} className={status === "running" ? "live-dot" : undefined} />
              <text x={14} y={0} fontSize={12} fontWeight={500} fill={secColor}>{label}</text>
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

export default function AgentFlowGraph({ events }: { events: ActivityEvent[] }) {
  const state = useMemo(() => deriveAgentFlowState(events), [events]);
  const reduced = useReducedMotion() ?? false;
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
      intake: state.nodes.intake === "ok" ? "received" : null,
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
      <svg viewBox="0 0 1200 360" className="w-full" role="img"
        aria-label={violation
          ? "Blocked run. Agent 1 holds ticket.read and asked Okta for ticket.write. Okta refused, so the run stopped: Agent 2, the vault and Jira were never reached and nothing was written."
          : "Delegation flow. Intake hands to Agent 1, which holds ticket.read. Agent 1 delegates to Agent 2, which holds ticket.write and files to Jira using a credential released from the Okta Privileged Access vault."}>
        <defs>
          <Grad id="g-in" from={NEUTRAL} to={TRIAGE_COLOR} x1={N.intake.cx} x2={N.agent1.cx} />
          <Grad id="g-del" from={TRIAGE_COLOR} to={FULFILL_COLOR} x1={N.agent1.cx} x2={N.agent2.cx} />
          <Grad id="g-jira" from={FULFILL_COLOR} to={NEUTRAL} x1={N.agent2.cx} x2={N.jira.cx} />
          <Grad id="g-vault" from={VAULT_COLOR} to={FULFILL_COLOR} x1={N.vault.cx} x2={N.agent2.cx} />
        </defs>

        <Edge d={EDGE_INTAKE} gradId="g-in" status={state.edges.intakeToAgent1.status} reduced={reduced} />
        {!violation && <Edge d={EDGE_VAULT} gradId="g-vault" status={state.vaultBadge} reduced={reduced} />}
        <Edge d={EDGE_DELEGATE} gradId="g-del" status={delegate} reduced={reduced} />
        <Edge d={EDGE_JIRA} gradId="g-jira" status={state.edges.agent2ToJira.status} reduced={reduced} />
        {violation && <DeniedBranch d={EDGE_DENIED} active={deniedActive} reduced={reduced} />}
        <OktaConnector d={OKTA_CONN} to={OKTA_MID}
          active={delegate === "running" || delegate === "ok"} flowing={delegate === "running"} reduced={reduced} />

        {/* scope labels: the CRUD story, readable without hovering anything */}
        <text x={(N.intake.cx + N.agent1.cx) / 2} y={LANE - 16} textAnchor="middle" fontSize={11}
          fontWeight={600} fill={state.edges.intakeToAgent1.scope ? RESOLVE_COLOR : "#4A5462"}
          style={{ fontFamily: "var(--font-mono)" }}>
          {state.edges.intakeToAgent1.scope ?? "ticket.read"}
        </text>
        <text x={(N.agent2.cx + N.jira.cx) / 2} y={LANE - 16} textAnchor="middle" fontSize={11}
          fontWeight={600} fill={state.edges.agent2ToJira.scope ? FULFILL_COLOR : "#4A5462"}
          style={{ fontFamily: "var(--font-mono)" }}>
          {state.edges.agent2ToJira.scope ?? "ticket.write"}
        </text>
        {violation && (
          <text x={N.agent1.cx + 14} y={(LANE + NH / 2 + N.denied.cy) / 2 + 4} fontSize={10.5}
            fontWeight={600} fill={deniedActive ? BAD : "#4A5462"}
            style={{ fontFamily: "var(--font-mono)" }}>
            ticket.write
          </text>
        )}

        <Node k="okta" status={delegate} label={labels.okta} hover={hoverNode} setHover={setHoverNode} />
        {!violation && <Node k="vault" status={state.vaultBadge} label={labels.vault} hover={hoverNode} setHover={setHoverNode} />}
        {violation && <Node k="denied" status={deniedActive ? "error" : "idle"} label={labels.denied} hover={hoverNode} setHover={setHoverNode} />}
        <Node k="intake" status={state.nodes.intake} label={labels.intake} hover={hoverNode} setHover={setHoverNode} />
        <Node k="agent1" status={state.nodes.agent1} label={labels.agent1} hover={hoverNode} setHover={setHoverNode} />
        <Node k="agent2" status={state.nodes.agent2} label={labels.agent2} hover={hoverNode} setHover={setHoverNode} />
        <Node k="jira" status={state.nodes.jira} label={labels.jira} hover={hoverNode} setHover={setHoverNode} />
      </svg>

      {state.errorMessage && <div className="mt-2 text-[13px] text-bad">{state.errorMessage}</div>}
    </div>
  );
}
