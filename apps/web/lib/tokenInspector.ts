// Token Inspector data: the delegation chain as FOUR hops, a client-side JWT
// decoder + RS256 signature verification, and an illustrative fallback set for
// a cold landing (no run captured yet in this session).
//
// The chain has 6 tokens but only 4 distinct agent-to-agent hops, because each
// A2A hop uses TWO tokens: an ID-JAG (the delegation grant you mint), then the
// access token you redeem it for. Naming 6 per-token tabs by agent inevitably
// produced duplicate "Agent 2 / Agent 3" labels; grouping by hop does not.
// So the tabs are the hops, and each hop shows its leg(s):
//
//   Intake Service → Agent 1   (Bootstrap: t1, client_credentials, no id-jag)
//   Agent 1 → Agent 2          (idjag1 grant, then t_res access token)
//   Agent 2 → Agent 3          (idjag2 grant, then t_ful access token)  [final]
//   Agent 3 → Jira             (OPA vault exchange; releases the Jira credential)
//
// Read left to right the hops chain: every arrow's destination is the next
// arrow's origin. Attribution is by the WLP actually inside each token (cid /
// client_id / act.sub), verified against real captured tokens — the holder is
// the caller, the aud/resource is the callee.

import { SERVICE_COLOR, TRIAGE_COLOR, RESOLVE_COLOR, FULFILL_COLOR } from "@/lib/identities";

export const VAULT_COLOR = "#64BBC8";

// One inspectable token within a hop. `key` matches the raw_tokens map emitted
// by the backend (and illustrativeRawTokens below). `kind` distinguishes the
// two legs of an A2A exchange.
export interface TokenLegMeta {
  key: string; // "t1" | "idjag1" | "t_res" | "idjag2" | "t_ful"
  role: string; // human label, e.g. "Delegation grant" / "Access token"
  kind: "ID-JAG" | "Access Token";
}

export interface HopTabMeta {
  id: string;
  title: string; // the hop, e.g. "Agent 1 → Agent 2" — always a distinct agent pair
  fromColor: string; // origin agent color (tab accent uses `toColor`)
  toColor: string; // destination agent color
  legs?: TokenLegMeta[]; // ordered: grant (if any) then access token
  final?: boolean; // the deepest A2A token in the chain
  isVault?: boolean; // structurally different: token-exchange metadata, not a JWT
}

export const TOKEN_TABS: HopTabMeta[] = [
  {
    id: "bootstrap", title: "Intake Service → Agent 1", fromColor: SERVICE_COLOR, toColor: TRIAGE_COLOR,
    legs: [{ key: "t1", role: "Access token", kind: "Access Token" }],
  },
  {
    id: "hop1", title: "Agent 1 → Agent 2", fromColor: TRIAGE_COLOR, toColor: RESOLVE_COLOR,
    legs: [
      { key: "idjag1", role: "Delegation grant", kind: "ID-JAG" },
      { key: "t_res", role: "Access token", kind: "Access Token" },
    ],
  },
  {
    id: "hop2", title: "Agent 2 → Agent 3", fromColor: RESOLVE_COLOR, toColor: FULFILL_COLOR, final: true,
    legs: [
      { key: "idjag2", role: "Delegation grant", kind: "ID-JAG" },
      { key: "t_ful", role: "Access token", kind: "Access Token" },
    ],
  },
  { id: "vault", title: "Agent 3 → Jira", fromColor: FULFILL_COLOR, toColor: VAULT_COLOR, isVault: true },
];

export interface DecodedJWT {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

// Per-claim descriptions for the "Claims Breakdown" table, jwt.io's own framing
// (claim name -> plain-English meaning -> spec link). Links only where a stable,
// well-known IETF RFC section actually defines the claim; Okta/O4AA-specific
// claims (sub_profile, client_id-as-delegator, requested_token_type) get a
// plain description instead of a guessed doc URL.
export const CLAIM_INFO: Record<string, { description: string; learnMoreUrl?: string }> = {
  // JWT registered claims, RFC 7519 §4.1
  iss: { description: "The issuer of the JWT.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.1" },
  sub: { description: "The subject of the JWT — the principal (user, service, or agent) it's about.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.2" },
  aud: { description: "The recipients that the JWT is intended for.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.3" },
  exp: { description: "The expiration time on or after which the JWT MUST NOT be accepted for processing.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.4" },
  nbf: { description: "The time before which the JWT MUST NOT be accepted for processing.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.5" },
  iat: { description: "The time at which the JWT was issued.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.6" },
  jti: { description: "The unique identifier for this JWT.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.7" },
  // JWS registered header params, RFC 7515 §4.1
  alg: { description: "The cryptographic algorithm used to sign this token.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7515.html#section-4.1.1" },
  kid: { description: "A hint indicating which signing key was used, matched against the issuer's published JWKS.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7515.html#section-4.1.4" },
  typ: { description: "The media type of this JWT.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc7515.html#section-4.1.9" },
  // Delegation / token exchange, RFC 8693
  act: { description: "The actor claim — the party (if any) acting on behalf of the subject. This is the delegation chain: it can nest, one layer per hop.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc8693.html#section-4.1" },
  // Resource indicators, RFC 8707
  resource: { description: "The protected resource this token is scoped to access.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc8707.html" },
  // OAuth 2.0 scope, RFC 6749 §3.3
  scp: { description: "The OAuth 2.0 scopes granted to this token.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc6749.html#section-3.3" },
  scope: { description: "The OAuth 2.0 scope granted to this token.", learnMoreUrl: "https://www.rfc-editor.org/rfc/rfc6749.html#section-3.3" },
  // Okta / O4AA-specific — no external registered spec to cite, plain description only
  ver: { description: "Okta's internal token format version." },
  cid: { description: "The OAuth client that requested this token." },
  client_id: { description: "The OAuth client that requested this token." },
  sub_profile: { description: "What kind of principal the subject is — e.g. service (a client credential) or ai_agent (a registered workload principal)." },
  requested_token_type: { description: "Identifies this as an ID-JAG (an Identity Assertion JWT Authorization Grant), not a standard access token." },
  auth_time: { description: "When the root of this delegation chain originally authenticated." },
  uid: { description: "Okta's internal identifier for the human user, if this chain traces back to one." },
};

export function describeClaim(key: string): { description: string; learnMoreUrl?: string } {
  return CLAIM_INFO[key] ?? { description: "A custom claim specific to this token." };
}

const NUMERIC_DATE_CLAIMS = new Set(["iat", "exp", "nbf", "auth_time"]);

// jwt.io's own presentation: "1783120519 (Fri Jul 03 2026 19:15:19 GMT-0400 ...)".
// Only for the top-level Claims Breakdown table — the JSON view stays raw numbers,
// matching how the token itself actually encodes them (NumericDate, RFC 7519 §2).
export function formatClaimValue(key: string, value: unknown): string {
  if (NUMERIC_DATE_CLAIMS.has(key) && typeof value === "number") {
    return `${value} (${new Date(value * 1000).toString()})`;
  }
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

// atob/btoa work in terms of Latin-1 "binary strings" (one byte per char code),
// while claim values are UTF-8 (this pipeline's illustrative claims use "·").
// Node's Buffer defaults to UTF-8, so decoding/encoding without going through
// TextDecoder/TextEncoder here produces different bytes server- vs client-side
// for any non-ASCII character, a real SSR/CSR hydration mismatch, not just a
// cosmetic one, since the resulting JSON differs by more than whitespace.
function b64urlDecode(seg: string): string {
  const padded = seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4);
  if (typeof window === "undefined") return Buffer.from(padded, "base64").toString("utf-8");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Split on ".", base64url-decode header + payload, parse as JSON. No signature
// verification — this app treats Okta as an already-authenticated first party
// and only ever decodes for display, documented in docs/ARCHITECTURE.md.
export function decodeJwt(raw: string): DecodedJWT | null {
  try {
    const [h, p] = raw.split(".");
    if (!h || !p) return null;
    return { header: JSON.parse(b64urlDecode(h)), payload: JSON.parse(b64urlDecode(p)) };
  } catch {
    return null;
  }
}

function b64urlEncode(obj: object): string {
  const json = JSON.stringify(obj);
  const s = typeof window === "undefined"
    ? Buffer.from(json, "utf-8").toString("base64")
    : btoa(Array.from(new TextEncoder().encode(json), (b) => String.fromCharCode(b)).join(""));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Client-side twin of the backend's _fake_jwt (apps/orchestrator/main.py):
// alg=none is the real RFC 7515 vocabulary for an unsecured JWS, plus a loud
// non-cryptographic third segment, so nothing here could be mistaken for a
// real Okta-issued token. `typ` is overridable so an illustrative ID-JAG
// carries the real "oauth-id-jag+jwt" header marker that distinguishes it
// from a plain access token, exactly as a real one does.
function fakeJwt(payload: Record<string, unknown>, typ = "JWT"): string {
  return `${b64urlEncode({ alg: "none", typ })}.${b64urlEncode(payload)}.DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN`;
}

// Illustrative identities — the same EXAMPLE_* placeholder ids registered in
// identities.ts, so the fallback tokens annotate to friendly agent names and
// carry the real Okta id SHAPE (0oa… client, wlp… workload principals) rather
// than a human label. Kept out of any real tenant's namespace on purpose.
const EX = {
  intake: "0oaEXAMPLEIntakeSvc1", // Intake Service (service client, the root subject)
  triage: "wlpEXAMPLETriageAgt1", // Agent 1
  resolve: "wlpEXAMPLEResolveAg1", // Agent 2
  fulfill: "wlpEXAMPLEFulfillAg1", // Agent 3
};
const EX_ORG = "https://example.oktapreview.com"; // ID-JAGs are issued by the bare org
const EX_TRIAGE_CAS = `${EX_ORG}/oauth2/<triage-cas-id>`;
const EX_RESOLVE_CAS = `${EX_ORG}/oauth2/<resolution-cas-id>`;
const EX_FULFILL_CAS = `${EX_ORG}/oauth2/<fulfillment-cas-id>`;
const EX_TRIAGE_RES = "https://atlas.acme.example/triage";
const EX_RESOLVE_RES = "https://atlas.acme.example/resolution";
const EX_FULFILL_RES = "https://atlas.acme.example/fulfillment";
// Fixed illustrative window (a real July 2026 epoch) — constant so server- and
// client-rendered output match exactly (no hydration drift). ID-JAGs are short-
// lived (5 min); access tokens an hour, same as the real ones.
const EX_IAT = 1783120519, EX_EXP = EX_IAT + 3600, EX_IDJAG_EXP = EX_IAT + 300;

// The nested actor chain, newest-actor-outermost, each node {sub, sub_profile,
// act}, terminating in the Intake Service root — exactly the real shape.
const EX_ACT_TRIAGE = { sub: EX.triage, sub_profile: "ai_agent", act: { sub: EX.intake, sub_profile: "service" } };
const EX_ACT_RESOLVE = { sub: EX.resolve, sub_profile: "ai_agent", act: EX_ACT_TRIAGE };

// Illustrative-only fallback for a cold landing (no captured run this session).
// Every field mirrors the real token shapes verified from live runs: sub is
// ALWAYS the Intake Service root, cid/client_id is the holding agent, act nests
// the full chain, ID-JAGs use a bare-org iss + AS-URL aud + a resource claim.
export function illustrativeRawTokens(): Record<string, string> {
  return {
    // Bootstrap: Intake Service's client_credentials token, audience = Agent 1. No act (it's the root).
    t1: fakeJwt({
      ver: 1, jti: "AT.EXAMPLE-bootstrap", iss: EX_TRIAGE_CAS, aud: EX_TRIAGE_RES,
      iat: EX_IAT, exp: EX_EXP, cid: EX.intake, scp: ["agent.invoke"], sub: EX.intake,
    }),
    // Hop 1 grant: Agent 1's ID-JAG targeting Agent 2's AS. act nests Triage ← Intake.
    idjag1: fakeJwt({
      jti: "IDAAG.EXAMPLE-1", iss: EX_ORG, aud: EX_RESOLVE_CAS, iat: EX_IAT, exp: EX_IDJAG_EXP,
      sub: EX.intake, resource: EX_RESOLVE_RES, client_id: EX.triage, sub_profile: "service",
      scope: "agent.invoke", act: EX_ACT_TRIAGE,
    }, "oauth-id-jag+jwt"),
    // Hop 1 token: the access token Agent 1 holds to call Agent 2. cid = Triage.
    t_res: fakeJwt({
      ver: 1, jti: "AT.EXAMPLE-res", iss: EX_RESOLVE_CAS, aud: EX_RESOLVE_RES, iat: EX_IAT, exp: EX_EXP,
      cid: EX.triage, scp: ["agent.invoke"], auth_time: EX_IAT, sub: EX.intake,
      act: EX_ACT_TRIAGE, sub_profile: "service",
    }),
    // Hop 2 grant: Agent 2's ID-JAG targeting Agent 3's AS. act nests Resolution ← Triage ← Intake.
    idjag2: fakeJwt({
      jti: "IDAAG.EXAMPLE-2", iss: EX_ORG, aud: EX_FULFILL_CAS, iat: EX_IAT, exp: EX_IDJAG_EXP,
      sub: EX.intake, resource: EX_FULFILL_RES, client_id: EX.resolve, sub_profile: "service",
      scope: "agent.invoke", act: EX_ACT_RESOLVE,
    }, "oauth-id-jag+jwt"),
    // Hop 2 token: the access token Agent 2 holds to call Agent 3. cid = Resolution. The final A2A token.
    t_ful: fakeJwt({
      ver: 1, jti: "AT.EXAMPLE-ful", iss: EX_FULFILL_CAS, aud: EX_FULFILL_RES, iat: EX_IAT, exp: EX_EXP,
      cid: EX.resolve, scp: ["agent.invoke"], auth_time: EX_IAT, sub: EX.intake,
      act: EX_ACT_RESOLVE, sub_profile: "service",
    }),
  };
}

export function illustrativeVaultData(): Record<string, unknown> {
  return { resource_orn: "orn:okta:opa:…:secrets:jira-atlas", subject_token_ref: "t_res", vaulted: true };
}

// --- JWT signature verification (RS256, WebCrypto) ---
//
// Verified live against this pipeline's real captured tokens before shipping:
// every one of the 5 real JWTs (both access-token and ID-JAG shapes) verifies
// true against Okta's live JWKS, and a tampered signing input is correctly
// rejected (not a rubber stamp). Two issuer shapes exist in practice —
// access tokens are issued by a Custom AS ("{org}/oauth2/{asId}"), ID-JAGs by
// the bare org issuer ("{org}") — so the JWKS URL is derived accordingly.

export type VerifyStatus = "verified" | "failed" | "no-signature" | "error";
export interface VerifyResult {
  status: VerifyStatus;
  detail: string;
  kid?: string;
  jwksUrl?: string;
}

function jwksUrlForIssuer(iss: string): string {
  return iss.includes("/oauth2/") ? `${iss}/v1/keys` : `${iss}/oauth2/v1/keys`;
}

function b64urlDecodeBytes(seg: string): Uint8Array {
  const padded = seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function rsaVerify(key: CryptoKey, raw: string): Promise<boolean> {
  const [h, p, s] = raw.split(".");
  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  const signature = b64urlDecodeBytes(s);
  return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signingInput);
}

// Primary path: no key to paste, no jwt.io round-trip — fetch the issuer's own
// live, public signing keys and verify right here. This is the strongest proof
// this UI can offer: not "trust us," a real cryptographic check against Okta.
export async function verifyJwtSignature(raw: string): Promise<VerifyResult> {
  const decoded = decodeJwt(raw);
  if (!decoded) return { status: "error", detail: "Could not decode this token." };
  const { header, payload } = decoded;
  if (header["alg"] === "none" || String(header["alg"] ?? "").length === 0) {
    return { status: "no-signature", detail: "This is an illustrative example (alg: none) — there's no real signature to verify. Simulate a ticket to inspect an actual signed token." };
  }
  const kid = String(header["kid"] ?? "");
  const iss = String(payload["iss"] ?? "");
  if (!kid || !iss) return { status: "error", detail: "This token has no kid/iss to look up a signing key with." };
  const jwksUrl = jwksUrlForIssuer(iss);
  try {
    const res = await fetch(jwksUrl);
    if (!res.ok) return { status: "error", detail: `Okta's JWKS endpoint returned HTTP ${res.status}.`, jwksUrl };
    const jwks = (await res.json()) as { keys?: Array<Record<string, unknown>> };
    const jwk = jwks.keys?.find((k) => k["kid"] === kid);
    if (!jwk) return { status: "error", detail: `No key with kid "${kid}" in ${jwksUrl} — it may have rotated since this token was issued.`, kid, jwksUrl };
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await rsaVerify(key, raw);
    return ok
      ? { status: "verified", detail: `Signature verified against Okta's live signing key (kid ${kid.slice(0, 12)}…).`, kid, jwksUrl }
      : { status: "failed", detail: "The signature does not match this key. This token may have been tampered with.", kid, jwksUrl };
  } catch (e) {
    return { status: "error", detail: `Could not reach ${jwksUrl}: ${e instanceof Error ? e.message : String(e)}`, jwksUrl };
  }
}

// Fallback path, matching jwt.io's own manual-key UX: paste an SPKI PEM
// ("-----BEGIN PUBLIC KEY-----...") or a raw JWK (JSON, exactly what Okta's
// /v1/keys returns per-key) and verify against that instead of a live fetch.
export async function verifyJwtSignatureWithKey(raw: string, keyInput: string): Promise<VerifyResult> {
  const trimmed = keyInput.trim();
  if (!trimmed) return { status: "error", detail: "Paste a public key first." };
  try {
    let key: CryptoKey;
    if (trimmed.includes("BEGIN PUBLIC KEY")) {
      const der = trimmed.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
      const bytes = Uint8Array.from(atob(der), (c) => c.charCodeAt(0));
      key = await crypto.subtle.importKey("spki", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    } else {
      const jwk = JSON.parse(trimmed) as JsonWebKey;
      key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    }
    const ok = await rsaVerify(key, raw);
    return ok
      ? { status: "verified", detail: "Signature verified against the key you provided." }
      : { status: "failed", detail: "The signature does not match this key." };
  } catch (e) {
    return { status: "error", detail: `Could not use this key: ${e instanceof Error ? e.message : String(e)}. Paste an SPKI PEM ("-----BEGIN PUBLIC KEY-----") or a JWK (JSON).` };
  }
}
