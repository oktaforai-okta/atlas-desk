// Pure derivation of AgentFlowGraph's visual state from the real event stream.
// No React, no DOM.
//
// The chain is TWO agents, not three: Intake Service bootstraps, Agent 1 reads,
// Agent 2 writes. The interesting edge is agent1 -> agent2, because that is
// where the capability changes from ticket.read to ticket.write, and the
// interesting NON-edge is agent1 -> write, which Okta refuses.

import { type ActivityEvent, latestByStep } from "./events";

export type FlowStatus = "idle" | "running" | "ok" | "error";

export interface FlowEdgeState {
  status: FlowStatus;
  scope: string | null;
  claims: Record<string, unknown> | null;
  systemLogId: string | null;
}

/** Which narrative this run told. Derived from the events rather than passed in,
 *  so the graph can never disagree with what actually happened. */
export type FlowPath = "none" | "normal" | "violation";

export interface AgentFlowState {
  path: FlowPath;
  nodes: { inbound: FlowStatus; svc: FlowStatus; agent1: FlowStatus; agent2: FlowStatus; jira: FlowStatus };
  edges: {
    inboundToSvc: FlowEdgeState;    // the trigger reaching the service, no token yet
    svcToAgent1: FlowEdgeState;     // bootstrap, ticket.read minted for Agent 1
    agent1ToAgent2: FlowEdgeState;  // delegation, act chain starts here
    agent2ToJira: FlowEdgeState;    // the write
  };
  /** Agent 1's refused write attempt. Rendered as a struck-through branch. */
  writeDenied: { attempted: boolean; denied: boolean; error: string | null };
  vaultBadge: FlowStatus;
  readCount: number | null;
  complete: boolean;
  errorMessage: string | null;
}

/** Fold several steps into one status.
 *
 *  Reads the last PRESENT step, not the last slot. Previously this filtered for
 *  emptiness and error but then indexed the unfiltered array, so a run missing
 *  its final step pinned the node to "running" forever. */
function foldStatus(steps: Array<ActivityEvent | undefined>): FlowStatus {
  const present = steps.filter((s): s is ActivityEvent => s !== undefined);
  if (present.length === 0) return "idle";
  if (present.some((s) => s.status === "error")) return "error";
  return present[present.length - 1].status === "ok" ? "ok" : "running";
}

function edgeFrom(e: ActivityEvent | undefined): FlowEdgeState {
  const scope = e?.data?.scope;
  return {
    status: foldStatus([e]),
    scope: typeof scope === "string" ? scope : null,
    claims: e?.token_claims ?? null, // never fabricate; only when the real token arrived
    systemLogId: e?.system_log_id ?? null,
  };
}

const forceError = (s: FlowStatus): FlowStatus => (s === "running" ? "error" : s);

export function deriveAgentFlowState(events: ActivityEvent[]): AgentFlowState {
  const by = latestByStep(events);
  const inbound = by.get("inbound");
  const readGrant = by.get("read_grant");
  const jiraRead = by.get("jira_read");
  const classify = by.get("classify");
  const denied = by.get("write_denied");
  const delegate = by.get("a2a_delegate");
  const writeGrant = by.get("write_grant");
  const draft = by.get("draft");
  const vault = by.get("opa_vault");
  const jiraWrite = by.get("jira_write");
  const done = by.get("done");
  const failure = by.get("error");

  const blocked = by.get("blocked");
  const similar = jiraRead?.data?.similar;

  // A violation run is identifiable by the presence of the refusal, and it never
  // reaches Agent 2. Normal runs contain no refusal at all.
  const path: FlowPath = (denied || blocked) ? "violation"
    : (inbound || readGrant) ? "normal" : "none";

  const nodes = {
    inbound: foldStatus([inbound]),
    svc: foldStatus([readGrant]),
    agent1: foldStatus([readGrant, jiraRead, classify]),
    agent2: foldStatus([writeGrant, draft, jiraWrite]),
    jira: foldStatus([jiraWrite]),
  };
  const edges = {
    inboundToSvc: edgeFrom(inbound),
    svcToAgent1: edgeFrom(readGrant),
    agent1ToAgent2: edgeFrom(delegate),
    agent2ToJira: edgeFrom(jiraWrite),
  };

  const writeDenied = {
    attempted: denied !== undefined,
    denied: denied?.data?.denied === true,
    error: typeof denied?.data?.error === "string" ? denied.data.error : null,
  };

  const base = {
    path,
    edges,
    writeDenied,
    vaultBadge: foldStatus([vault]),
    readCount: Array.isArray(similar) ? similar.length : null,
  };

  if (!failure) {
    const terminal = path === "violation" ? blocked : done;
    return { ...base, nodes, complete: terminal?.status === "ok", errorMessage: null };
  }
  return {
    ...base,
    nodes: {
      inbound: forceError(nodes.inbound), svc: forceError(nodes.svc),
      agent1: forceError(nodes.agent1), agent2: forceError(nodes.agent2),
      jira: forceError(nodes.jira),
    },
    edges: {
      inboundToSvc: { ...edges.inboundToSvc, status: forceError(edges.inboundToSvc.status) },
      svcToAgent1: { ...edges.svcToAgent1, status: forceError(edges.svcToAgent1.status) },
      agent1ToAgent2: { ...edges.agent1ToAgent2, status: forceError(edges.agent1ToAgent2.status) },
      agent2ToJira: { ...edges.agent2ToJira, status: forceError(edges.agent2ToJira.status) },
    },
    complete: false,
    errorMessage: failure.plain,
  };
}
