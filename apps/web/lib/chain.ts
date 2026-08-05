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

export type StepKind = "Access Token" | "ID-JAG" | "Denied" | "Expired";

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
  /** true when this credential existed but has since lapsed and is withheld.
   *  The card still renders, because the step happened and the surrounding copy
   *  refers to it; only the token value is gone. */
  expired?: boolean;
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

/** Did the orchestrator withhold this token because it lapsed? */
const lapsed = (e: ActivityEvent | undefined, key: string): boolean =>
  Array.isArray((e as { expired_tokens?: unknown } | undefined)?.expired_tokens)
  && ((e as unknown as { expired_tokens: string[] }).expired_tokens).includes(key);

/**
 * Deep link that pre-loads the token into jwt.io.
 *
 * KNOWN TRADEOFF, measured rather than assumed. The token rides in the URL
 * fragment, and a fragment is not part of the HTTP request line, so it is
 * tempting to conclude the credential never leaves the browser. That conclusion
 * is wrong: jwt.io runs Google Analytics, and GA reports the full document
 * location, fragment included, as its `dl` parameter. Verified against the live
 * site with a real token, two POSTs to analytics.google.com per page load, each
 * carrying the whole JWT.
 *
 * Accepted deliberately, because these particular tokens are inert: their
 * audiences sit under `.example` (an IANA-reserved TLD that cannot be
 * registered), every onward use requires an agent private key that never leaves
 * the orchestrator, they expire within the hour, and this project already
 * publishes them at /api/last-run by design. Google receiving a copy is not a
 * new exposure class here.
 *
 * It would be the wrong call for a token that actually authorizes something. If
 * you reuse this pattern, that is the line.
 *
 * JWTs are base64url plus dots, all URL-safe, so encodeURIComponent leaves them
 * untouched. It is applied anyway rather than assuming.
 */
export function jwtIoUrl(token: string): string {
  return `https://jwt.io/#token=${encodeURIComponent(token)}`;
}

export interface DecodedToken {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * base64url -> UTF-8 string.
 *
 * Node's Buffer is UTF-8 by default while atob yields a Latin-1 byte string, so
 * decoding the same segment on the server and in the browser produces different
 * characters for anything non-ASCII (these claims contain "·"). That is a real
 * hydration mismatch, not a cosmetic one, since the rendered JSON would differ.
 * Hence the explicit TextDecoder on the client path.
 */
function b64urlToText(seg: string): string {
  const padded = seg.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (seg.length % 4)) % 4);
  if (typeof window === "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Split, decode, parse. Display only: nothing here verifies a signature, and the
 * UI says so. The encoded string plus jwt.io remains the actual proof, because a
 * decoded view this app renders is a view this app could have fabricated.
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    const [h, p] = token.split(".");
    if (!h || !p) return null;
    const header = JSON.parse(b64urlToText(h));
    const payload = JSON.parse(b64urlToText(p));
    if (typeof header !== "object" || header === null) return null;
    if (typeof payload !== "object" || payload === null) return null;
    return { header, payload };
  } catch {
    return null;
  }
}

/** Claims that are NumericDate, rendered with a readable form alongside. */
const TIME_CLAIMS = new Set(["iat", "exp", "nbf", "auth_time"]);

/** Pretty JSON, with epoch claims annotated so `exp` is legible at a glance. */
export function formatClaims(payload: Record<string, unknown>): string {
  const annotated: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    annotated[k] = TIME_CLAIMS.has(k) && typeof v === "number"
      ? `${v}  (${new Date(v * 1000).toISOString().replace("T", " ").slice(0, 19)}Z)`
      : v;
  }
  return JSON.stringify(annotated, null, 2);
}

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
  if (delegate && (delegate.raw_tokens || lapsed(delegate, "idjag1"))) {
    const d = delegate.data ?? {};
    const scope = s(d.scope);
    if (delegate.raw_tokens?.idjag1 || lapsed(delegate, "idjag1")) {
      out.push({
        title: "Agent 1 → Agent 2",
        kind: delegate.raw_tokens?.idjag1 ? "ID-JAG" : "Expired",
        expired: !delegate.raw_tokens?.idjag1,
        purpose:
          "The delegation grant. Agent 1 cannot write, so it hands the work onward; this is the credential that carries that hand-off.",
        scope,
        caller: s(d.caller) ?? "Agent 1",
        callee: s(d.callee) ?? "Agent 2",
        token: delegate.raw_tokens?.idjag1,
      });
    }
    if (delegate.raw_tokens?.t_res) {
      out.push({
        title: "Agent 1 → Agent 2",
        kind: "Access Token",
        purpose:
          "Redeemed from that grant. Its act claim names Agent 1, so whatever happens next stays attributable to it.",
        scope,
        caller: s(d.caller) ?? "Agent 1",
        callee: s(d.callee) ?? "Agent 2",
        token: delegate.raw_tokens?.t_res,
      });
    }
  }

  const writeGrant = by.get("write_grant");
  if (writeGrant && (writeGrant.raw_tokens || lapsed(writeGrant, "idjag2"))) {
    const d = writeGrant.data ?? {};
    const scope = s(d.scope);
    if (writeGrant.raw_tokens?.idjag2 || lapsed(writeGrant, "idjag2")) {
      out.push({
        title: "Agent 2 → write lane",
        kind: writeGrant.raw_tokens?.idjag2 ? "ID-JAG" : "Expired",
        expired: !writeGrant.raw_tokens?.idjag2,
        purpose:
          "The grant for the capability change. Only Agent 2 is an authorized client on the write authorization server.",
        scope,
        caller: s(d.caller) ?? "Agent 2",
        callee: "write authorization server",
        token: writeGrant.raw_tokens?.idjag2,
      });
    }
    if (writeGrant.raw_tokens?.t_ful) {
      out.push({
        title: "Agent 2 → Jira",
        kind: "Access Token",
        purpose:
          "The write credential. Same chain, different capability: its act claim still names Agent 1 and the Intake Service.",
        scope,
        caller: s(d.caller) ?? "Agent 2",
        callee: "Jira",
        token: writeGrant.raw_tokens?.t_ful,
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
        "Redeemed from that grant. Its act claim names Agent 1, so whatever happens next stays attributable to it.",
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
