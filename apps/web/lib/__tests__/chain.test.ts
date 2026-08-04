// Chain-of-custody assembly and the illustrative/real distinction.
//
// The properties worth protecting: the page must show one card per credential the
// run actually produced (never one it did not), the refusal must appear even
// though it has no token, and a fake token must be detected as fake so the
// warning banner is driven by what the credential says about itself rather than
// by whether a run happened.

import { describe, expect, it } from "vitest";
import { buildChain, illustrativeChain, isIllustrative } from "@/lib/chain";
import { latestByStep, type ActivityEvent } from "@/lib/events";

const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({
  step: "x", actor: "a", actorKind: "triage", plain: "p", status: "ok", ...over,
});

const READ = "ticket.read";
const WRITE = "ticket.write";

// a signed-looking token: header declares RS256, so it is not illustrative
const signed = (payload: object = {}) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "RS256", kid: "k" })}.${b(payload)}.c2ln`;
};
const unsigned = () => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none" })}.${b({})}.DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN`;
};

function fullRun(): ActivityEvent[] {
  return [
    ev({ step: "read_grant", raw_tokens: { t1: signed() },
         data: { scope: READ, holder: "wlpONE" } }),
    ev({ step: "write_denied",
         data: { denied: true, http_status: 400, error: "invalid_scope",
                 error_description: "not allowed", attempted_scope: WRITE } }),
    ev({ step: "a2a_delegate", raw_tokens: { idjag1: signed(), t_res: signed() },
         data: { scope: READ, caller: "wlpONE", callee: "wlpTWO" } }),
    ev({ step: "write_grant", raw_tokens: { idjag2: signed(), t_ful: signed() },
         data: { scope: WRITE, caller: "wlpTWO" } }),
  ];
}

describe("buildChain", () => {
  it("produces one card per credential plus the refusal", () => {
    const c = buildChain(fullRun());
    expect(c).toHaveLength(6);
    expect(c.map((s) => s.kind)).toEqual([
      "Access Token", "Denied", "ID-JAG", "Access Token", "ID-JAG", "Access Token",
    ]);
  });

  it("numbers the steps in the order they were obtained", () => {
    expect(buildChain(fullRun()).map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("carries the read scope on the read legs and write on the write legs", () => {
    const c = buildChain(fullRun());
    expect(c.filter((s) => s.scope === READ).map((s) => s.kind))
      .toEqual(["Access Token", "ID-JAG", "Access Token"]);
    expect(c.filter((s) => s.scope === WRITE && s.kind !== "Denied")).toHaveLength(2);
  });

  it("keeps the refusal even though it has no token", () => {
    const denial = buildChain(fullRun()).find((s) => s.kind === "Denied")!;
    expect(denial.token).toBeUndefined();
    expect(denial.denial).toMatchObject({ httpStatus: 400, error: "invalid_scope" });
    expect(denial.scope).toBe(WRITE);
  });

  it("reads principal ids from the event rather than inventing them", () => {
    const c = buildChain(fullRun());
    const hop = c.find((s) => s.kind === "ID-JAG")!;
    expect(hop.caller).toBe("wlpONE");
    expect(hop.callee).toBe("wlpTWO");
  });

  it("omits credentials the run did not produce", () => {
    // a degraded run: bootstrap succeeded, delegation never happened
    const c = buildChain([fullRun()[0]]);
    expect(c).toHaveLength(1);
    expect(c[0].title).toContain("Intake Service");
  });

  it("returns nothing for a run that produced no credentials", () => {
    expect(buildChain([ev({ step: "inbound" }), ev({ step: "done" })])).toEqual([]);
  });

  it("ignores a denial event that did not actually deny", () => {
    // the probe can be inconclusive; a card claiming refusal would then be a lie
    const evs = [ev({ step: "write_denied", data: { denied: false } })];
    expect(buildChain(evs)).toEqual([]);
  });

  it("uses the last event per step, since each arrives twice", () => {
    const evs = [
      ev({ step: "read_grant", status: "running", raw_tokens: null, data: { scope: READ } }),
      ev({ step: "read_grant", status: "ok", raw_tokens: { t1: signed() },
           data: { scope: READ, holder: "wlpONE" } }),
    ];
    expect(latestByStep(evs).size).toBe(1);
    expect(buildChain(evs)).toHaveLength(1);
  });
});

describe("isIllustrative", () => {
  it("detects an unsigned demo token", () => {
    expect(isIllustrative(illustrativeChain())).toBe(true);
    expect(isIllustrative(buildChain([
      ev({ step: "read_grant", raw_tokens: { t1: unsigned() }, data: { scope: READ } }),
    ]))).toBe(true);
  });

  it("treats an RS256 token as real", () => {
    expect(isIllustrative(buildChain(fullRun()))).toBe(false);
  });

  it("treats an empty chain as illustrative rather than real", () => {
    // failing open here would label a blank page "real Okta-issued tokens"
    expect(isIllustrative([])).toBe(true);
  });

  it("decides from the header, not from whether a run happened", () => {
    const chain = buildChain([ev({
      step: "read_grant", raw_tokens: { t1: unsigned() }, data: { scope: READ } })]);
    expect(chain).toHaveLength(1);
    expect(isIllustrative(chain)).toBe(true);
  });
});

describe("illustrativeChain", () => {
  it("never contains a real tenant identifier", () => {
    const blob = JSON.stringify(illustrativeChain());
    expect(blob).not.toMatch(/wlp10|0oa10|aus10|oktaforai/);
    expect(blob).toMatch(/EXAMPLE/);
  });

  it("labels every token as unsigned in words as well as in the header", () => {
    for (const s of illustrativeChain()) {
      if (s.token) expect(s.token).toContain("DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN");
    }
  });

  it("mirrors the real chain's shape so the fallback is not misleading", () => {
    expect(illustrativeChain().map((s) => s.kind))
      .toEqual(buildChain(fullRun()).map((s) => s.kind));
  });
});
