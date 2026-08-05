// Chain-of-custody assembly and the illustrative/real distinction.
//
// The properties worth protecting: the page must show one card per credential the
// run actually produced (never one it did not), the refusal must appear even
// though it has no token, and a fake token must be detected as fake so the
// warning banner is driven by what the credential says about itself rather than
// by whether a run happened.

import { describe, expect, it } from "vitest";
import { buildChain, decodeToken, formatClaims, isIllustrative, jwtIoUrl } from "@/lib/chain";
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

// --- the violation path's chain ---
//
// A blocked run produces exactly one credential (the read token it was given)
// plus the refusal. If a write token ever appeared here, the boundary failed.

describe("buildChain on a violation run", () => {
  const violation = [
    ev({ step: "read_grant", raw_tokens: { t1: signed() },
         data: { scope: READ, holder: "wlpONE" } }),
    ev({ step: "write_denied",
         data: { denied: true, http_status: 400, error: "invalid_scope",
                 error_description: "The following scopes are not allowed for this request: [ticket.write].",
                 attempted_scope: WRITE } }),
  ];

  it("yields the read token and the refusal, nothing more", () => {
    const c = buildChain(violation);
    expect(c).toHaveLength(2);
    expect(c.map((s) => s.kind)).toEqual(["Access Token", "Denied"]);
  });

  it("contains no write credential", () => {
    const c = buildChain(violation);
    expect(c.filter((s) => s.token && s.scope === WRITE)).toHaveLength(0);
  });

  it("surfaces Okta's own refusal text", () => {
    const d = buildChain(violation).find((s) => s.kind === "Denied")!.denial!;
    expect(d.error).toBe("invalid_scope");
    expect(d.description).toContain("not allowed for this request");
  });

  it("is shorter than a normal run's chain", () => {
    expect(buildChain(violation).length).toBeLessThan(buildChain(fullRun()).length);
  });
});

// --- jwt.io deep link + decoded view ---

describe("jwtIoUrl", () => {
  it("puts the token in the fragment, not the query", () => {
    // a fragment is never transmitted to the server, so jwt.io parses the token
    // locally and never receives a request containing the credential. A query
    // string would send it.
    const u = jwtIoUrl(signed({ scp: [READ] }));
    expect(u.startsWith("https://jwt.io/#token=")).toBe(true);
    expect(u).not.toContain("?");
  });

  it("round-trips the token unchanged", () => {
    const t = signed({ scp: [WRITE], sub: "0oaEXAMPLEIntakeSvc1" });
    const back = decodeURIComponent(jwtIoUrl(t).split("#token=")[1]);
    expect(back).toBe(t);
  });

  it("leaves base64url characters untouched", () => {
    // base64url uses - and _ which encodeURIComponent does not escape; if it did,
    // jwt.io would receive a corrupted token
    const t = "aGVhZGVy-x_y.cGF5bG9hZA-_.c2ln";
    expect(jwtIoUrl(t)).toBe(`https://jwt.io/#token=${t}`);
  });
});

describe("decodeToken", () => {
  it("returns header and payload", () => {
    const d = decodeToken(signed({ scp: [READ], sub: "x" }))!;
    expect(d.header.alg).toBe("RS256");
    expect(d.payload.scp).toEqual([READ]);
  });

  it("decodes non-ASCII claim values correctly", () => {
    // these claims contain "·"; a Latin-1 vs UTF-8 mismatch here would render
    // mojibake and, worse, differ between server and client render
    const d = decodeToken(signed({ note: "routed · Hardware" }))!;
    expect(d.payload.note).toBe("routed · Hardware");
  });

  it("reads an unsigned demo token too", () => {
    const d = decodeToken(unsigned())!;
    expect(d.header.alg).toBe("none");
  });

  it("returns null rather than throwing on junk", () => {
    for (const bad of ["", "abc", "a.b", "...", "!!!.???.zzz"]) {
      expect(decodeToken(bad)).toBeNull();
    }
  });

  it("returns null when a segment is not JSON", () => {
    const b = (x: string) => Buffer.from(x).toString("base64url");
    expect(decodeToken(`${b("notjson")}.${b("{}")}.s`)).toBeNull();
  });
});

describe("formatClaims", () => {
  it("annotates epoch claims with a readable time", () => {
    const out = formatClaims({ exp: 1783124119, sub: "x" });
    expect(out).toContain("1783124119");
    expect(out).toMatch(/2026-\d\d-\d\d \d\d:\d\d:\d\dZ/);
  });

  it("leaves non-time claims alone", () => {
    const out = JSON.parse(formatClaims({ scp: ["ticket.read"], ver: 1 }));
    expect(out.scp).toEqual(["ticket.read"]);
    expect(out.ver).toBe(1);
  });

  it("preserves the nested act chain", () => {
    const act = { sub: "wlpTWO", act: { sub: "wlpONE" } };
    expect(JSON.parse(formatClaims({ act })).act).toEqual(act);
  });
});

// --- expired grants keep their card ---
//
// ID-JAGs live 5 minutes while access tokens live an hour, so a run fifteen
// minutes old legitimately has live access tokens and dead grants. Dropping the
// grant's card entirely broke the narrative and left the next card's copy
// referring to "the grant above", which was no longer rendered.
