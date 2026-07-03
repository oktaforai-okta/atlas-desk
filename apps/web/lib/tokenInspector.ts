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
  { id: "t1", title: "1 · Bootstrap", subtitle: "Access Token", agentGeneric: "Intake Service", color: SERVICE_COLOR },
  { id: "idjag1", title: "2 · Delegation grant", subtitle: "ID-JAG", agentGeneric: "Agent 1", agentReal: "Triage", color: TRIAGE_COLOR },
  { id: "t_res", title: "3 · Agent 2's token", subtitle: "Access Token · act nests 1", agentGeneric: "Agent 2", agentReal: "Resolution", color: RESOLVE_COLOR },
  { id: "idjag2", title: "4 · Delegation grant", subtitle: "ID-JAG", agentGeneric: "Agent 2", agentReal: "Resolution", color: RESOLVE_COLOR },
  { id: "t_ful", title: "5 · Agent 3's token", subtitle: "Access Token · act nests 2", agentGeneric: "Agent 3", agentReal: "Fulfillment", color: FULFILL_COLOR, final: true },
  { id: "vault", title: "6 · Vault exchange", subtitle: "Credential release", agentGeneric: "Agent 3", agentReal: "Fulfillment", color: VAULT_COLOR, isVault: true },
];

export interface DecodedJWT {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function b64urlDecode(seg: string): string {
  const padded = seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4);
  return typeof window !== "undefined" ? atob(padded) : Buffer.from(padded, "base64").toString("utf-8");
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
  const s = typeof window !== "undefined" ? btoa(json) : Buffer.from(json).toString("base64");
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
