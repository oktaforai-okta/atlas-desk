// Flow-graph state derivation.
//
// The regression these exist for: foldStatus used to filter the step list for
// emptiness and errors, then read the LAST element of the UNFILTERED list. A run
// missing its final step therefore left `last` undefined and pinned the node to
// "running" forever, so a finished pipeline showed a node still spinning.

import { describe, expect, it } from "vitest";
import { deriveAgentFlowState } from "@/lib/agentFlow";
import type { ActivityEvent } from "@/lib/events";

const ev = (step: string, status: ActivityEvent["status"] = "ok",
            over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  step, actor: "a", actorKind: "triage", plain: "p", status, ...over,
});

describe("node status folding", () => {
  it("is idle before anything arrives", () => {
    const s = deriveAgentFlowState([]);
    expect(s.nodes.agent1).toBe("idle");
    expect(s.complete).toBe(false);
  });

  it("is running while a step is in flight", () => {
    expect(deriveAgentFlowState([ev("read_grant", "running")]).nodes.agent1).toBe("running");
  });

  it("is ok once the last present step is ok", () => {
    const s = deriveAgentFlowState([
      ev("read_grant"), ev("jira_read"), ev("classify")]);
    expect(s.nodes.agent1).toBe("ok");
  });

  it("does not hang on running when a later step never arrives", () => {
    // THE REGRESSION. agent1 folds [read_grant, jira_read, classify]; with only
    // the first present, the old code indexed past the end and reported running.
    const s = deriveAgentFlowState([ev("read_grant")]);
    expect(s.nodes.agent1).toBe("ok");
  });

  it("surfaces an error in any folded step", () => {
    expect(deriveAgentFlowState([ev("read_grant"), ev("classify", "error")])
      .nodes.agent1).toBe("error");
  });
});

describe("the refused write", () => {
  it("is absent until the probe runs", () => {
    const d = deriveAgentFlowState([ev("read_grant")]).writeDenied;
    expect(d.attempted).toBe(false);
    expect(d.denied).toBe(false);
  });

  it("records a real refusal with its error code", () => {
    const d = deriveAgentFlowState([ev("write_denied", "ok", {
      data: { denied: true, error: "invalid_scope" } })]).writeDenied;
    expect(d).toEqual({ attempted: true, denied: true, error: "invalid_scope" });
  });

  it("distinguishes attempted-but-inconclusive from denied", () => {
    // if the probe did not actually get refused, the graph must not draw a
    // refusal, or it claims an enforcement that did not occur
    const d = deriveAgentFlowState([ev("write_denied", "ok", {
      data: { denied: false } })]).writeDenied;
    expect(d.attempted).toBe(true);
    expect(d.denied).toBe(false);
  });
});

describe("edges", () => {
  it("expose the scope carried on each hop", () => {
    const s = deriveAgentFlowState([
      ev("read_grant", "ok", { data: { scope: "ticket.read" } }),
      ev("jira_write", "ok", { data: { scope: "ticket.write" } }),
    ]);
    expect(s.edges.intakeToAgent1.scope).toBe("ticket.read");
    expect(s.edges.agent2ToJira.scope).toBe("ticket.write");
  });

  it("never fabricate claims for a hop that produced no token", () => {
    expect(deriveAgentFlowState([ev("a2a_delegate")]).edges.agent1ToAgent2.claims).toBeNull();
  });

  it("carry the system log id only when the backend sent one", () => {
    const withId = deriveAgentFlowState([ev("a2a_delegate", "ok", {
      system_log_id: "app.oauth2.token.grant.id_jag" })]);
    expect(withId.edges.agent1ToAgent2.systemLogId).toBe("app.oauth2.token.grant.id_jag");
    expect(deriveAgentFlowState([ev("a2a_delegate")])
      .edges.agent1ToAgent2.systemLogId).toBeNull();
  });
});

describe("read count", () => {
  it("is null when no read happened", () => {
    expect(deriveAgentFlowState([]).readCount).toBeNull();
  });

  it("counts the duplicates Agent 1 found", () => {
    const s = deriveAgentFlowState([ev("jira_read", "ok", {
      data: { similar: [{ key: "ITSD-1" }, { key: "ITSD-2" }] } })]);
    expect(s.readCount).toBe(2);
  });

  it("reports zero duplicates as zero, not as absent", () => {
    expect(deriveAgentFlowState([ev("jira_read", "ok", { data: { similar: [] } })])
      .readCount).toBe(0);
  });
});

describe("terminal states", () => {
  it("completes only when done is ok", () => {
    expect(deriveAgentFlowState([ev("done")]).complete).toBe(true);
    expect(deriveAgentFlowState([ev("done", "running")]).complete).toBe(false);
  });

  it("an error event forces in-flight nodes to error and blocks completion", () => {
    const s = deriveAgentFlowState([
      ev("read_grant", "running"),
      ev("done"),
      ev("error", "error", { plain: "Pipeline error: boom" }),
    ]);
    expect(s.nodes.agent1).toBe("error");
    expect(s.complete).toBe(false);
    expect(s.errorMessage).toBe("Pipeline error: boom");
  });

  it("leaves already-ok nodes ok when a later step errors", () => {
    const s = deriveAgentFlowState([
      ev("read_grant"), ev("jira_read"), ev("classify"),
      ev("error", "error", { plain: "boom" }),
    ]);
    expect(s.nodes.agent1).toBe("ok");
  });
});

// --- the two narratives ---
//
// The graph reads its path from the events rather than being told, so it can
// never disagree with what actually happened. These pin that mapping, and pin
// the property that matters most on a violation: the downstream nodes stay dark,
// because staying dark is how the diagram says "the write did not happen".

describe("run path", () => {
  const normal = [
    ev("inbound"), ev("read_grant", "ok", { data: { scope: "ticket.read" } }),
    ev("jira_read"), ev("classify"), ev("a2a_delegate"),
    ev("write_grant", "ok", { data: { scope: "ticket.write" } }),
    ev("opa_vault"), ev("jira_write"), ev("done"),
  ];
  const violation = [
    ev("inbound"), ev("read_grant", "ok", { data: { scope: "ticket.read" } }),
    ev("jira_read"), ev("classify"),
    ev("write_denied", "ok", { data: { denied: true, error: "invalid_scope" } }),
    ev("blocked", "ok", { data: { blocked: true, wrote_to_jira: false } }),
  ];

  it("is none before anything runs", () => {
    expect(deriveAgentFlowState([]).path).toBe("none");
  });

  it("is normal for a run with no refusal", () => {
    expect(deriveAgentFlowState(normal).path).toBe("normal");
  });

  it("is violation as soon as a refusal appears", () => {
    expect(deriveAgentFlowState(violation).path).toBe("violation");
  });

  it("leaves the write side dark on a violation", () => {
    // this is the evidence that nothing was written; if these light up the
    // diagram is claiming work that did not happen
    const s = deriveAgentFlowState(violation);
    expect(s.nodes.agent2).toBe("idle");
    expect(s.nodes.jira).toBe("idle");
    expect(s.vaultBadge).toBe("idle");
    expect(s.edges.agent2ToJira.status).toBe("idle");
  });

  it("lights the whole path on a normal run", () => {
    const s = deriveAgentFlowState(normal);
    expect(s.nodes.agent2).toBe("ok");
    expect(s.nodes.jira).toBe("ok");
    expect(s.writeDenied.attempted).toBe(false);
  });

  it("completes on blocked for a violation, not on done", () => {
    // a violation run never emits `done`, so keying completion off it would
    // leave the graph permanently mid-flight
    expect(deriveAgentFlowState(violation).complete).toBe(true);
    expect(deriveAgentFlowState(normal).complete).toBe(true);
  });

  it("does not complete while the refusal is still in flight", () => {
    const partial = violation.slice(0, 5).concat(ev("write_denied", "running"));
    expect(deriveAgentFlowState(partial).complete).toBe(false);
  });
});
