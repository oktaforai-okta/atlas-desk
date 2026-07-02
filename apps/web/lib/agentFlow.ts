// Pure derivation of AgentFlowGraph's visual state from the real event stream.
// No React, no DOM, unit-testable with plain `node`.
//
// The chain is now three agents: Intake Service (service, bootstrap) ->
// Atlas Triage -> Atlas Resolution -> Atlas Fulfillment, with Okta brokering
// each agent-to-agent hop (id_jag). The SECOND hop (resolveToFulfillment) is
// the one whose token nests BOTH agent workload principals in its act claim,
// that's the chain-of-custody source.

import { type ActivityEvent, latestByStep } from "./events";

export type FlowStatus = "idle" | "running" | "ok" | "error";

export interface FlowEdgeState {
  status: FlowStatus;
  claims: Record<string, unknown> | null;
  systemLogId: string | null;
}

export interface AgentFlowState {
  nodes: { intake: FlowStatus; triage: FlowStatus; resolve: FlowStatus; fulfill: FlowStatus; jira: FlowStatus };
  edges: {
    intakeToTriage: FlowEdgeState;
    triageToResolve: FlowEdgeState;      // hop 1, one agent in act
    resolveToFulfillment: FlowEdgeState; // hop 2, TWO agents in act (chain of custody)
    fulfillmentToJira: FlowEdgeState;
  };
  vaultBadge: FlowStatus;
  complete: boolean;
  errorMessage: string | null;
}

function foldStatus(steps: Array<ActivityEvent | undefined>): FlowStatus {
  const present = steps.filter((s): s is ActivityEvent => s !== undefined);
  if (present.length === 0) return "idle";
  if (present.some((s) => s.status === "error")) return "error";
  const last = steps[steps.length - 1];
  return last?.status === "ok" ? "ok" : "running";
}

function edgeFrom(e: ActivityEvent | undefined): FlowEdgeState {
  return {
    status: foldStatus([e]),
    claims: e?.token_claims ?? null, // never fabricate; only present when the real token arrived
    systemLogId: e?.system_log_id ?? null,
  };
}

const forceError = (s: FlowStatus): FlowStatus => (s === "running" ? "error" : s);

export function deriveAgentFlowState(events: ActivityEvent[]): AgentFlowState {
  const by = latestByStep(events);
  const inbound = by.get("inbound");
  const intakeAuth = by.get("intake_auth");
  const intakeClassify = by.get("intake_classify");
  const a2a = by.get("a2a_exchange");
  const draft = by.get("devops_draft");
  const fulfillment = by.get("a2a_fulfillment");
  const vault = by.get("opa_vault");
  const jiraWrite = by.get("jira_write");
  const done = by.get("done");
  const failure = by.get("error");

  const nodes = {
    intake: foldStatus([inbound]),
    triage: foldStatus([intakeAuth, intakeClassify]),
    resolve: foldStatus([draft]),
    fulfill: foldStatus([fulfillment, jiraWrite]),
    jira: foldStatus([jiraWrite]),
  };
  const edges = {
    intakeToTriage: edgeFrom(intakeAuth),
    triageToResolve: edgeFrom(a2a),
    resolveToFulfillment: edgeFrom(fulfillment),
    fulfillmentToJira: edgeFrom(jiraWrite),
  };
  const vaultBadge = foldStatus([vault]);

  if (!failure) {
    return { nodes, edges, vaultBadge, complete: done?.status === "ok", errorMessage: null };
  }
  return {
    nodes: {
      intake: forceError(nodes.intake), triage: forceError(nodes.triage), resolve: forceError(nodes.resolve),
      fulfill: forceError(nodes.fulfill), jira: forceError(nodes.jira),
    },
    edges: {
      intakeToTriage: { ...edges.intakeToTriage, status: forceError(edges.intakeToTriage.status) },
      triageToResolve: { ...edges.triageToResolve, status: forceError(edges.triageToResolve.status) },
      resolveToFulfillment: { ...edges.resolveToFulfillment, status: forceError(edges.resolveToFulfillment.status) },
      fulfillmentToJira: { ...edges.fulfillmentToJira, status: forceError(edges.fulfillmentToJira.status) },
    },
    vaultBadge: forceError(vaultBadge),
    complete: false,
    errorMessage: failure.plain,
  };
}
