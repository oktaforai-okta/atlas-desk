// The chain of custody, as a flat list of steps.
//
// Deliberately does NOT decode or verify anything. Every field shown comes
// either from the orchestrator (which read it off the real token) or from the
// encoded string itself. The proof is the encoded string plus jwt.io, not a
// pretty rendering this app controls: anything we decode and display here is
// something a viewer has to take on trust, and the point of the exercise is to
// not ask for trust.
//
// One card per token, so every credential in the run is individually copyable.

import { type ActivityEvent, latestByStep } from "./events";

export type StepKind = "Access Token" | "ID-JAG" | "Denied";

export interface ChainStep {
  n: number;
  /** "Intake Service → Agent 1" */
  title: string;
  /** what this leg is */
  kind: StepKind;
  /** one-line plain explanation of what this credential authorizes */
  purpose: string;
  /** the OAuth scope carried, e.g. "ticket.read" */
  scope?: string;
  /** the workload principal / client that HOLDS this token */
  caller?: string;
  /** who or what it is addressed to */
  callee?: string;
  /** compact JWT, if this step has one */
  token?: string;
  /** populated only for the denied step */
  denial?: {
    httpStatus?: number;
    error?: string;
    description?: string;
    attemptedScope?: string;
  };
}

const s = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/**
 * Build the chain from a real run's events. Order is the order the credentials
 * were actually obtained, so reading top to bottom follows the request.
 */
export function buildChain(events: ActivityEvent[]): ChainStep[] {
  const by = latestByStep(events);
  const out: Omit<ChainStep, "n">[] = [];

  const readGrant = by.get("read_grant");
  const t1 = readGrant?.raw_tokens?.t1;
  if (t1) {
    const d = readGrant?.data ?? {};
    out.push({
      title: "Intake Service → Agent 1",
      kind: "Access Token",
      purpose:
        "Bootstraps the chain. An ordinary service client mints this, because an agent may not use client_credentials at all.",
      scope: s(d.scope),
      caller: "Intake Service",
      callee: s(d.holder) ?? "Agent 1",
      token: t1,
    });
  }

  const denied = by.get("write_denied");
  if (denied?.data?.denied) {
    const d = denied.data;
    out.push({
      title: "Agent 1 ⨯ write lane",
      kind: "Denied",
      purpose:
        "Agent 1 asked Okta for write access and was refused. No token exists for this step, which is the entire point.",
      scope: s(d.attempted_scope),
      caller: "Agent 1",
      callee: "write authorization server",
      denial: {
        httpStatus: typeof d.http_status === "number" ? d.http_status : undefined,
        error: s(d.error),
        description: s(d.error_description),
        attemptedScope: s(d.attempted_scope),
      },
    });
  }

  const delegate = by.get("a2a_delegate");
  if (delegate?.raw_tokens) {
    const d = delegate.data ?? {};
    const scope = s(d.scope);
    if (delegate.raw_tokens.idjag1) {
      out.push({
        title: "Agent 1 → Agent 2",
        kind: "ID-JAG",
        purpose:
          "The delegation grant. Agent 1 cannot write, so it hands the work onward; this is the credential that carries that hand-off.",
        scope,
        caller: s(d.caller) ?? "Agent 1",
        callee: s(d.callee) ?? "Agent 2",
        token: delegate.raw_tokens.idjag1,
      });
    }
    if (delegate.raw_tokens.t_res) {
      out.push({
        title: "Agent 1 → Agent 2",
        kind: "Access Token",
        purpose:
          "Redeemed from the grant above. Its act claim names Agent 1, so whatever happens next stays attributable to it.",
        scope,
        caller: s(d.caller) ?? "Agent 1",
        callee: s(d.callee) ?? "Agent 2",
        token: delegate.raw_tokens.t_res,
      });
    }
  }

  const writeGrant = by.get("write_grant");
  if (writeGrant?.raw_tokens) {
    const d = writeGrant.data ?? {};
    const scope = s(d.scope);
    if (writeGrant.raw_tokens.idjag2) {
      out.push({
        title: "Agent 2 → write lane",
        kind: "ID-JAG",
        purpose:
          "The grant for the capability change. Only Agent 2 is an authorized client on the write authorization server.",
        scope,
        caller: s(d.caller) ?? "Agent 2",
        callee: "write authorization server",
        token: writeGrant.raw_tokens.idjag2,
      });
    }
    if (writeGrant.raw_tokens.t_ful) {
      out.push({
        title: "Agent 2 → Jira",
        kind: "Access Token",
        purpose:
          "The write credential. Same chain, different capability: its act claim still names Agent 1 and the Intake Service.",
        scope,
        caller: s(d.caller) ?? "Agent 2",
        callee: "Jira",
        token: writeGrant.raw_tokens.t_ful,
      });
    }
  }

  return out.map((step, i) => ({ ...step, n: i + 1 }));
}

// ---------------------------------------------------------------------------
// Illustrative fallback for a cold landing (no run captured this session).
//
// Uses EXAMPLE_* placeholder ids and alg=none tokens with a loud third segment,
// so nothing here can be mistaken for a real Okta-issued credential. Real
// tenant identifiers are never hardcoded in this file; on a live run every id
// below is replaced by one the orchestrator read off an actual token.

function b64url(obj: object): string {
  const json = JSON.stringify(obj);
  const b =
    typeof window === "undefined"
      ? Buffer.from(json, "utf-8").toString("base64")
      : btoa(
          Array.from(new TextEncoder().encode(json), (c) =>
            String.fromCharCode(c),
          ).join(""),
        );
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeJwt(payload: Record<string, unknown>, typ = "JWT"): string {
  return `${b64url({ alg: "none", typ })}.${b64url(payload)}.DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN`;
}

const EX = {
  intake: "0oaEXAMPLEIntakeSvc1",
  a1: "wlpEXAMPLEAgentOne01",
  a2: "wlpEXAMPLEAgentTwo01",
};
const ORG = "https://example.oktapreview.com";
const READ_CAS = `${ORG}/oauth2/<read-lane-cas-id>`;
const WRITE_CAS = `${ORG}/oauth2/<write-lane-cas-id>`;
const READ_RES = "https://atlas.example/triage";
const WRITE_RES = "https://atlas.example/write";
// Fixed epoch so server- and client-rendered output match exactly (no hydration drift).
const IAT = 1783120519;
const EXP = IAT + 3600;
const IJ_EXP = IAT + 300;
const READ = "ticket.read";
const WRITE = "ticket.write";

const ACT1 = { sub: EX.a1, sub_profile: "ai_agent", act: { sub: EX.intake, sub_profile: "service" } };
const ACT2 = { sub: EX.a2, sub_profile: "ai_agent", act: ACT1 };

/** Same shape buildChain produces, for the empty state. */
export function illustrativeChain(): ChainStep[] {
  const steps: Omit<ChainStep, "n">[] = [
    {
      title: "Intake Service → Agent 1",
      kind: "Access Token",
      purpose:
        "Bootstraps the chain. An ordinary service client mints this, because an agent may not use client_credentials at all.",
      scope: READ,
      caller: EX.intake,
      callee: EX.a1,
      token: fakeJwt({
        ver: 1, jti: "AT.EXAMPLE-read", iss: READ_CAS, aud: READ_RES, iat: IAT,
        exp: EXP, cid: EX.intake, scp: [READ], sub: EX.intake,
      }),
    },
    {
      title: "Agent 1 ⨯ write lane",
      kind: "Denied",
      purpose:
        "Agent 1 asked Okta for write access and was refused. No token exists for this step, which is the entire point.",
      scope: WRITE,
      caller: EX.a1,
      callee: "write authorization server",
      denial: {
        httpStatus: 401,
        error: "access_denied",
        description:
          "Policy evaluation failed for this request, please check the policy configurations.",
        attemptedScope: WRITE,
      },
    },
    {
      title: "Agent 1 → Agent 2",
      kind: "ID-JAG",
      purpose:
        "The delegation grant. Agent 1 cannot write, so it hands the work onward; this is the credential that carries that hand-off.",
      scope: READ,
      caller: EX.a1,
      callee: EX.a2,
      token: fakeJwt({
        jti: "IDAAG.EXAMPLE-1", iss: ORG, aud: READ_CAS, iat: IAT, exp: IJ_EXP,
        sub: EX.intake, resource: READ_RES, client_id: EX.a1,
        sub_profile: "service", scope: READ, act: ACT1,
      }, "oauth-id-jag+jwt"),
    },
    {
      title: "Agent 1 → Agent 2",
      kind: "Access Token",
      purpose:
        "Redeemed from the grant above. Its act claim names Agent 1, so whatever happens next stays attributable to it.",
      scope: READ,
      caller: EX.a1,
      callee: EX.a2,
      token: fakeJwt({
        ver: 1, jti: "AT.EXAMPLE-a2", iss: READ_CAS, aud: READ_RES, iat: IAT, exp: EXP,
        cid: EX.a1, scp: [READ], auth_time: IAT, sub: EX.intake,
        act: ACT1, sub_profile: "service",
      }),
    },
    {
      title: "Agent 2 → write lane",
      kind: "ID-JAG",
      purpose:
        "The grant for the capability change. Only Agent 2 is an authorized client on the write authorization server.",
      scope: WRITE,
      caller: EX.a2,
      callee: "write authorization server",
      token: fakeJwt({
        jti: "IDAAG.EXAMPLE-2", iss: ORG, aud: WRITE_CAS, iat: IAT, exp: IJ_EXP,
        sub: EX.intake, resource: WRITE_RES, client_id: EX.a2,
        sub_profile: "service", scope: WRITE, act: ACT2,
      }, "oauth-id-jag+jwt"),
    },
    {
      title: "Agent 2 → Jira",
      kind: "Access Token",
      purpose:
        "The write credential. Same chain, different capability: its act claim still names Agent 1 and the Intake Service.",
      scope: WRITE,
      caller: EX.a2,
      callee: "Jira",
      token: fakeJwt({
        ver: 1, jti: "AT.EXAMPLE-write", iss: WRITE_CAS, aud: WRITE_RES, iat: IAT, exp: EXP,
        cid: EX.a2, scp: [WRITE], auth_time: IAT, sub: EX.intake,
        act: ACT2, sub_profile: "service",
      }),
    },
  ];
  return steps.map((step, i) => ({ ...step, n: i + 1 }));
}

/** An illustrative token self-identifies: alg=none in the header. */
export function isIllustrative(steps: ChainStep[]): boolean {
  const first = steps.find((s) => s.token)?.token;
  if (!first) return true;
  try {
    const header = JSON.parse(
      atob(first.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return header?.alg === "none" || !header?.alg;
  } catch {
    return true;
  }
}
