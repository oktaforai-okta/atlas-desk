"use client";

// The hero: a live, three-agent delegation flow.
//
//   Intake Service (service, bootstrap) -> Triage -> Resolution -> Fulfillment -> Jira
//
// Both agent-to-agent hops (Triage->Resolution, Resolution->Fulfillment) are
// brokered by Okta (id_jag), shown by the Okta node + its two connectors. The
// SECOND hop's token nests BOTH agent workload principals in its act claim,
// that's the chain-of-custody source below. Every pulse/particle fires only
// off a real ActivityEvent status transition (verified against the Okta log).

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Inbox, Bot, SquareKanban, ShieldCheck, KeyRound, ChevronDown } from "lucide-react";
import { linkHorizontal, linkVertical, type DefaultLinkObject } from "d3-shape";
import TokenBlock from "@/components/TokenBlock";
import ChainOfCustody from "@/components/ChainOfCustody";
import { deriveAgentFlowState, type FlowStatus } from "@/lib/agentFlow";
import { TRIAGE_COLOR, RESOLVE_COLOR, FULFILL_COLOR } from "@/lib/identities";
import { latestByStep, type ActivityEvent } from "@/lib/events";

const NEUTRAL = "#8B96A8";
const OKTA = "#93B4FF";
const VAULT = "#64BBC8";
const WARN = "#F2B450";
const BAD = "#FF6168";

// ---- fixed geometry (viewBox 0 0 1200 344) ----
const LANE = 202;
const NW = 158;
const NH = 82;
type NodeKey = "intake" | "triage" | "resolve" | "fulfill" | "jira" | "okta" | "vault";
const NODES: Record<NodeKey, { cx: number; cy: number; w: number; h: number; color: string; name: string; kind: string; Icon: typeof Bot }> = {
  intake: { cx: 100, cy: LANE, w: NW, h: NH, color: NEUTRAL, name: "Intake", kind: "external system", Icon: Inbox },
  triage: { cx: 350, cy: LANE, w: NW, h: NH, color: TRIAGE_COLOR, name: "Triage", kind: "AI Agent", Icon: Bot },
  resolve: { cx: 600, cy: LANE, w: NW, h: NH, color: RESOLVE_COLOR, name: "Resolution", kind: "AI Agent", Icon: Bot },
  fulfill: { cx: 850, cy: LANE, w: NW, h: NH, color: FULFILL_COLOR, name: "Fulfillment", kind: "AI Agent", Icon: Bot },
  jira: { cx: 1100, cy: LANE, w: NW, h: NH, color: NEUTRAL, name: "Jira", kind: "IT Service Desk", Icon: SquareKanban },
  okta: { cx: 600, cy: 58, w: 192, h: 56, color: OKTA, name: "Okta", kind: "ID-JAG · both hops", Icon: ShieldCheck },
  vault: { cx: 850, cy: 302, w: 160, h: 52, color: VAULT, name: "OPA Vault", kind: "vaulted secret", Icon: KeyRound },
};

const H = linkHorizontal();
const V = linkVertical();
const linkPath = (gen: typeof H, s: [number, number], t: [number, number]) =>
  gen({ source: s, target: t } as unknown as DefaultLinkObject) ?? "";
const N = NODES;
const EDGE_INTAKE = linkPath(H, [N.intake.cx + NW / 2, LANE], [N.triage.cx - NW / 2, LANE]);
const EDGE_A2A1 = linkPath(H, [N.triage.cx + NW / 2, LANE], [N.resolve.cx - NW / 2, LANE]);
const EDGE_A2A2 = linkPath(H, [N.resolve.cx + NW / 2, LANE], [N.fulfill.cx - NW / 2, LANE]);
const EDGE_JIRA = linkPath(H, [N.fulfill.cx + NW / 2, LANE], [N.jira.cx - NW / 2, LANE]);
const EDGE_VAULT = linkPath(V, [N.vault.cx, N.vault.cy - N.vault.h / 2], [N.fulfill.cx, LANE + NH / 2]);
// Curved governance connectors: Okta drops a soft S-curve into each agent-hop
// midpoint (where it brokers the id-jag). They leave from two offset points on
// Okta's underside so the two feeds read as distinct instead of crossing.
const OKTA_L: [number, number] = [(N.triage.cx + NW / 2 + N.resolve.cx - NW / 2) / 2, LANE];
const OKTA_R: [number, number] = [(N.resolve.cx + NW / 2 + N.fulfill.cx - NW / 2) / 2, LANE];
const OKTA_BOT_L: [number, number] = [N.okta.cx - 34, N.okta.cy + N.okta.h / 2];
const OKTA_BOT_R: [number, number] = [N.okta.cx + 34, N.okta.cy + N.okta.h / 2];
const OKTA_CONN_L = linkPath(V, OKTA_BOT_L, OKTA_L);
const OKTA_CONN_R = linkPath(V, OKTA_BOT_R, OKTA_R);

function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function statusColor(base: string, s: FlowStatus): string {
  return s === "idle" ? "#39424F" : s === "running" ? WARN : s === "error" ? BAD : base;
}
function combine(a: FlowStatus, b: FlowStatus): FlowStatus {
  if (a === "error" || b === "error") return "error";
  if (a === "running" || b === "running") return "running";
  if (a === "ok" || b === "ok") return "ok";
  return "idle";
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

function Edge({ d, gradId, status, reduced }: { d: string; gradId: string; status: FlowStatus; reduced: boolean }) {
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
      {pt && (
        <>
          <circle cx={pt.x} cy={pt.y} r={11} fill={hexA("#F5F8FC", 0.12)} />
          <circle cx={pt.x} cy={pt.y} r={5} fill="#F8FAFF" style={{ filter: "drop-shadow(0 0 6px rgba(180,205,255,0.9))" }} />
        </>
      )}
    </g>
  );
}

// A soft vertical S-curve from Okta into an agent-hop midpoint, dotted so it
// reads as a governance/brokering overlay (not data flow). The dots travel
// downward only while that hop is actively exchanging; once the id-jag is
// issued they settle, lit but still (nothing keeps moving after it lands).
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

// hover detail, the Okta id / mechanism revealed when you hover a node
const NODE_DETAIL: Partial<Record<NodeKey, string>> = {
  intake: "external ticketing system",
  triage: "wlpEXAMPLETriageAgt1",
  resolve: "wlpEXAMPLEResolveAg1",
  fulfill: "wlpEXAMPLEFulfillAg1",
  okta: "id-jag · agent.invoke",
  vault: "STS vaulted-secret",
  jira: "project ITSD",
};

function Node({ k, status, label, hover, setHover }: {
  k: NodeKey; status: FlowStatus; label?: string | null;
  hover: NodeKey | null; setHover: (k: NodeKey | null) => void;
}) {
  const n = NODES[k];
  const compact = k === "okta" || k === "vault";
  const c = statusColor(n.color, status);
  const active = status === "running" || status === "ok";
  const hovered = hover === k;
  const dimmed = hover !== null && !hovered;
  const tlx = n.cx - n.w / 2, tly = n.cy - n.h / 2;
  const iconC = status === "idle" ? NEUTRAL : c;
  const detail = NODE_DETAIL[k];
  // secondary line: reveal the id/detail on hover; otherwise the live label
  const showDetail = hovered && !!detail;
  const sec = showDetail ? detail : label;
  const secColor = showDetail ? n.color : status === "running" ? WARN : status === "ok" ? n.color : NEUTRAL;
  const glow = hovered ? `drop-shadow(0 0 16px ${hexA(active ? c : n.color, 0.5)})` : active ? `drop-shadow(0 0 12px ${hexA(c, 0.33)})` : undefined;
  return (
    <motion.g className="cursor-pointer" initial={false} animate={{ opacity: dimmed ? 0.4 : 1 }}
      onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} style={{ filter: glow }}>
      <motion.rect x={tlx} y={tly} width={n.w} height={n.h} rx={13} initial={false}
        animate={{ fill: hexA(c, status === "idle" ? 0.05 : 0.12), stroke: hexA(hovered ? n.color : c, status === "idle" && !hovered ? 0.45 : 0.95) }}
        transition={{ duration: 0.3 }} strokeWidth={hovered ? 2.4 : 1.5}
        className={status === "running" ? "animate-pulse" : undefined} />
      {compact ? (
        <>
          <g transform={`translate(${tlx + 16},${n.cy - 12})`}><n.Icon width={24} height={24} color={iconC} strokeWidth={2} /></g>
          <text x={tlx + 48} y={n.cy - 3} fontSize={15} fontWeight={600} fill="#F0F3F8">{n.name}</text>
          {sec ? (
            <g transform={`translate(${tlx + 48},${n.cy + 14})`}>
              {!showDetail && <circle cx={3} cy={-3} r={3.5} fill={secColor} className={status === "running" ? "live-dot" : undefined} />}
              <text x={showDetail ? 0 : 13} y={0} fontSize={showDetail ? 10.5 : 11.5} fontWeight={500} fill={secColor}
                style={showDetail ? { fontFamily: "var(--font-mono)" } : undefined}>{sec}</text>
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
          {sec && (
            <g transform={`translate(${tlx + 16},${tly + 70})`}>
              {!showDetail && <circle cx={3.5} cy={-3.5} r={3.5} fill={secColor} className={status === "running" ? "live-dot" : undefined} />}
              <text x={showDetail ? 0 : 14} y={0} fontSize={showDetail ? 11 : 12} fontWeight={500} fill={secColor}
                style={showDetail ? { fontFamily: "var(--font-mono)" } : undefined}>{sec}</text>
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
  const [showRaw, setShowRaw] = useState(false);
  const [hoverNode, setHoverNode] = useState<NodeKey | null>(null);
  const hop1 = state.edges.triageToResolve.status;
  const hop2 = state.edges.resolveToFulfillment.status;
  const oktaStatus = combine(hop1, hop2);
  const claims = state.edges.resolveToFulfillment.claims; // the TWO-agent token
  const anyRunning = Object.values(state.nodes).some((s) => s === "running") || hop1 === "running" || hop2 === "running";

  const labels = useMemo(() => {
    const by = latestByStep(events);
    const dept = (by.get("intake_classify")?.data?.department as string) || null;
    const jw = by.get("jira_write");
    const key = (jw?.data?.issue_key as string) || null;
    const pr = (jw?.data?.priority as string) || null;
    const run = (s: FlowStatus) => s === "running";
    return {
      intake: state.nodes.intake === "ok" ? "received" : null,
      triage: run(state.nodes.triage) ? "classifying…" : dept ? `→ ${dept.replace(/\bManagement\b/, "Mgmt")}` : null,
      resolve: run(state.nodes.resolve) ? "resolving…" : state.nodes.resolve === "ok" ? "drafted" : null,
      fulfill: run(state.nodes.fulfill) ? "executing…" : state.nodes.fulfill === "ok" ? "filed" : null,
      jira: key ? `${key}${pr ? ` · ${pr}` : ""}` : null,
      okta: oktaStatus === "running" ? "issuing ID-JAG…" : oktaStatus === "ok" ? "ID-JAG issued" : null,
      vault: state.vaultBadge === "ok" ? "secret released" : state.vaultBadge === "running" ? "releasing…" : null,
    };
  }, [events, state, oktaStatus]);

  return (
    <div className={`card edge-accent hero-mesh overflow-hidden p-4 transition-shadow ${anyRunning ? "shadow-[0_0_0_1px_rgba(122,162,255,0.25),0_8px_40px_-12px_rgba(122,162,255,0.25)]" : ""}`}>
      <svg viewBox="0 0 1200 344" className="w-full" role="img"
        aria-label="Three-agent delegation flow: Intake to Triage to Resolution to Fulfillment to Jira, with Okta brokering both agent-to-agent hops. Hover a node to reveal its Okta id.">
        <defs>
          <Grad id="g-in" from={NEUTRAL} to={TRIAGE_COLOR} x1={N.intake.cx} x2={N.triage.cx} />
          <Grad id="g-h1" from={TRIAGE_COLOR} to={RESOLVE_COLOR} x1={N.triage.cx} x2={N.resolve.cx} />
          <Grad id="g-h2" from={RESOLVE_COLOR} to={FULFILL_COLOR} x1={N.resolve.cx} x2={N.fulfill.cx} />
          <Grad id="g-jira" from={FULFILL_COLOR} to={NEUTRAL} x1={N.fulfill.cx} x2={N.jira.cx} />
          <Grad id="g-vault" from={VAULT} to={FULFILL_COLOR} x1={N.vault.cx} x2={N.fulfill.cx} />
        </defs>

        <Edge d={EDGE_INTAKE} gradId="g-in" status={state.edges.intakeToTriage.status} reduced={reduced} />
        <Edge d={EDGE_VAULT} gradId="g-vault" status={state.vaultBadge} reduced={reduced} />
        <Edge d={EDGE_A2A1} gradId="g-h1" status={hop1} reduced={reduced} />
        <Edge d={EDGE_A2A2} gradId="g-h2" status={hop2} reduced={reduced} />
        <Edge d={EDGE_JIRA} gradId="g-jira" status={state.edges.fulfillmentToJira.status} reduced={reduced} />
        <OktaConnector d={OKTA_CONN_L} to={OKTA_L} active={hop1 === "running" || hop1 === "ok"} flowing={hop1 === "running"} reduced={reduced} />
        <OktaConnector d={OKTA_CONN_R} to={OKTA_R} active={hop2 === "running" || hop2 === "ok"} flowing={hop2 === "running"} reduced={reduced} />

        <Node k="okta" status={oktaStatus} label={labels.okta} hover={hoverNode} setHover={setHoverNode} />
        <Node k="vault" status={state.vaultBadge} label={labels.vault} hover={hoverNode} setHover={setHoverNode} />
        <Node k="intake" status={state.nodes.intake} label={labels.intake} hover={hoverNode} setHover={setHoverNode} />
        <Node k="triage" status={state.nodes.triage} label={labels.triage} hover={hoverNode} setHover={setHoverNode} />
        <Node k="resolve" status={state.nodes.resolve} label={labels.resolve} hover={hoverNode} setHover={setHoverNode} />
        <Node k="fulfill" status={state.nodes.fulfill} label={labels.fulfill} hover={hoverNode} setHover={setHoverNode} />
        <Node k="jira" status={state.nodes.jira} label={labels.jira} hover={hoverNode} setHover={setHoverNode} />
      </svg>

      {claims && (
        <div className="mt-2 border-t border-line pt-3.5">
          <div className="mb-2.5 flex items-center gap-2 text-2xs uppercase tracking-wider text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-ok live-dot" /> Chain of custody · every handoff signed by Okta
          </div>
          <ChainOfCustody claims={claims} systemLogId={state.edges.resolveToFulfillment.systemLogId} />
          <button type="button" onClick={() => setShowRaw((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent hover:opacity-80">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRaw ? "rotate-180" : ""}`} />
            {showRaw ? "Hide the raw token" : "For engineers · view the raw token"}
          </button>
          <AnimatePresence initial={false}>
            {showRaw && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                <div className="mt-2">
                  <TokenBlock claims={claims} caption="final A2A token, issued by the Fulfillment A2A authorization server" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {state.errorMessage && <div className="mt-2 text-[13px] text-bad">{state.errorMessage}</div>}
    </div>
  );
}
