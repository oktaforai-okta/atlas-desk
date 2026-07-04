// Token Inspector data: the six inspectable exchanges in this pipeline, a
// client-side JWT decoder (no signature verification — same accepted pattern
// as everywhere else in this app), and an illustrative fallback set for a cold
// landing (no run captured yet in this session).
//
// Six, not five like the reference pattern this was modeled on, because this
// pipeline has two full A2A hops plus a vault exchange: T1 (service-client
// bootstrap) -> ID-JAG#1 -> T_res (Agent 2's token, act nests 1) -> ID-JAG#2 ->
// T_ful (Agent 3's token, act nests 2, final delegation token) -> the vault
// exchange (not a claims-bearing JWT — shows that T_res, not T_ful, is the
// subject presented, per this project's own verified finding).

import { SERVICE_COLOR, TRIAGE_COLOR, RESOLVE_COLOR, FULFILL_COLOR } from "@/lib/identities";

export const VAULT_COLOR = "#64BBC8";

export interface TokenTabMeta {
  id: string;
  title: string;
  subtitle: string;
  agentGeneric: string;
  agentReal?: string;
  color: string;
  final?: boolean;
  isVault?: boolean; // structurally different tab: no claims/raw JWT, exchange metadata only
}

export const TOKEN_TABS: TokenTabMeta[] = [
  { id: "t1", title: "Bootstrap", subtitle: "Access Token", agentGeneric: "Intake Service", color: SERVICE_COLOR },
  // Every tab is named by what it IS, not just who it's about: a handoff
  // between two agents ("Agent 1 -> Agent 2"), or an agent's own token
  // ("Agent 2 Token"). A bare "Agent N" doesn't say which of those it is.
  { id: "idjag1", title: "Agent 1 → Agent 2", subtitle: "ID-JAG", agentGeneric: "Agent 1", agentReal: "Triage", color: TRIAGE_COLOR },
  { id: "t_res", title: "Agent 2 Token", subtitle: "Access Token · act nests 1", agentGeneric: "Agent 2", agentReal: "Resolution", color: RESOLVE_COLOR },
  { id: "idjag2", title: "Agent 2 → Agent 3", subtitle: "ID-JAG", agentGeneric: "Agent 2", agentReal: "Resolution", color: RESOLVE_COLOR },
  { id: "t_ful", title: "Agent 3 Token", subtitle: "Access Token · act nests 2", agentGeneric: "Agent 3", agentReal: "Fulfillment", color: FULFILL_COLOR, final: true },
  { id: "vault", title: "Vault exchange", subtitle: "Credential release", agentGeneric: "Agent 3", agentReal: "Fulfillment", color: VAULT_COLOR, isVault: true },
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
// real Okta-issued token.
function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64urlEncode({ alg: "none", typ: "JWT" })}.${b64urlEncode(payload)}.DEMO-UNSIGNED-NOT-A-REAL-OKTA-TOKEN`;
}

const EXAMPLE_RES_ISS = "https://example.oktapreview.com/oauth2/<resolution-cas-id>";
const EXAMPLE_FUL_ISS = "https://example.oktapreview.com/oauth2/<fulfillment-cas-id>";

const EXAMPLE_RES_CLAIMS = {
  sub: "wlp · Triage",
  act: { sub: "wlp · Triage", scope: "agent.invoke" },
  aud: "https://atlas.acme.example/resolution",
  scp: ["agent.invoke"], iss: EXAMPLE_RES_ISS,
};
const EXAMPLE_FUL_CLAIMS = {
  sub: "wlp · Resolution",
  act: { sub: "wlp · Resolution", scope: "agent.invoke", act: { sub: "wlp · Triage", scope: "agent.invoke" } },
  aud: "https://atlas.acme.example/fulfillment",
  scp: ["agent.invoke"], iss: EXAMPLE_FUL_ISS,
};

// Illustrative-only fallback for a cold landing (no captured run this session).
// Mirrors the backend demo-mode claim shapes exactly, so the "example" story
// told here matches the one told when you actually simulate a ticket without
// live Okta credentials configured.
export function illustrativeRawTokens(): Record<string, string> {
  return {
    t1: fakeJwt({ sub: "svc · Intake Service", aud: "https://atlas.acme.example/triage", scp: ["agent.invoke"], iss: EXAMPLE_RES_ISS }),
    idjag1: fakeJwt({ ...EXAMPLE_RES_CLAIMS, requested_token_type: "id-jag" }),
    t_res: fakeJwt(EXAMPLE_RES_CLAIMS),
    idjag2: fakeJwt({ ...EXAMPLE_FUL_CLAIMS, requested_token_type: "id-jag" }),
    t_ful: fakeJwt(EXAMPLE_FUL_CLAIMS),
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
