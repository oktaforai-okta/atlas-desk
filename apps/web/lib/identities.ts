// The Atlas identity mesh: maps the opaque Okta IDs that appear in real tokens
// to named, color-coded actors, so the chain of custody reads as people/systems
// rather than `wlp10qj…`. Colors align with the node palette in AgentFlowGraph
// and tailwind.config.ts (accent / resolve), plus a distinct violet for the
// service client (the non-agent root of the machine chain).

export interface Identity {
  id: string; // the Okta principal id, wlp… for agents (workload principals), 0oa… for clients
  name: string;
  kind: string; // "service client" | "AI agent" | "resource"
  color: string; // hex
  isWorkloadPrincipal: boolean;
}

export const SERVICE_COLOR = "#B79CFF";
export const TRIAGE_COLOR = "#7AA2FF";
export const RESOLVE_COLOR = "#4ED492";
export const FULFILL_COLOR = "#E0A34E";

export const IDENTITIES: Record<string, Identity> = {
  "0oaEXAMPLEIntakeSvc1": { id: "0oaEXAMPLEIntakeSvc1", name: "Intake Service", kind: "service client", color: SERVICE_COLOR, isWorkloadPrincipal: false },
  "wlpEXAMPLETriageAgt1": { id: "wlpEXAMPLETriageAgt1", name: "Triage Agent", kind: "AI agent", color: TRIAGE_COLOR, isWorkloadPrincipal: true },
  "wlpEXAMPLEResolveAg1": { id: "wlpEXAMPLEResolveAg1", name: "Resolution Agent", kind: "AI agent", color: RESOLVE_COLOR, isWorkloadPrincipal: true },
  "wlpEXAMPLEFulfillAg1": { id: "wlpEXAMPLEFulfillAg1", name: "Fulfillment Agent", kind: "AI agent", color: FULFILL_COLOR, isWorkloadPrincipal: true },
};

// The illustrative ids above cover the static diagrams and the cold-landing
// fallback, but a REAL captured token carries this tenant's actual workload
// principal ids, which identityForId wouldn't otherwise recognize — every
// wlp/sub value would render as an opaque, unannotated string, exactly the
// "which agent is this" confusion this file exists to prevent. These come
// from env vars (not hardcoded) so the literal tenant-specific ids stay out
// of the public git history, consistent with how the backend already handles
// tenant-specific config. Harmless to leave unset: identityForId falls back
// to "unrecognized" for anything not registered, same as today.
const REAL_INTAKE_CLIENT_ID = process.env.NEXT_PUBLIC_INTAKE_SERVICE_CLIENT_ID;
const REAL_TRIAGE_WLP = process.env.NEXT_PUBLIC_TRIAGE_WLP_ID;
const REAL_RESOLUTION_WLP = process.env.NEXT_PUBLIC_RESOLUTION_WLP_ID;
const REAL_FULFILLMENT_WLP = process.env.NEXT_PUBLIC_FULFILLMENT_WLP_ID;
if (REAL_INTAKE_CLIENT_ID) IDENTITIES[REAL_INTAKE_CLIENT_ID] = { id: REAL_INTAKE_CLIENT_ID, name: "Intake Service", kind: "service client", color: SERVICE_COLOR, isWorkloadPrincipal: false };
if (REAL_TRIAGE_WLP) IDENTITIES[REAL_TRIAGE_WLP] = { id: REAL_TRIAGE_WLP, name: "Triage Agent", kind: "AI agent", color: TRIAGE_COLOR, isWorkloadPrincipal: true };
if (REAL_RESOLUTION_WLP) IDENTITIES[REAL_RESOLUTION_WLP] = { id: REAL_RESOLUTION_WLP, name: "Resolution Agent", kind: "AI agent", color: RESOLVE_COLOR, isWorkloadPrincipal: true };
if (REAL_FULFILLMENT_WLP) IDENTITIES[REAL_FULFILLMENT_WLP] = { id: REAL_FULFILLMENT_WLP, name: "Fulfillment Agent", kind: "AI agent", color: FULFILL_COLOR, isWorkloadPrincipal: true };

// Each agent's A2A custom authorization server → the identity it protects.
// A real A2A token's `iss` is the target's CAS; `aud` is its resourceUrl.
const ISSUER_AS_TO_IDENTITY: Record<string, string> = {
  ausEXAMPLEResolveCA1: "wlpEXAMPLEResolveAg1",
  ausEXAMPLEFulfillCA1: "wlpEXAMPLEFulfillAg1",
};
const AUD_TO_IDENTITY: Record<string, string> = {
  "https://atlas.acme.example/resolution": "wlpEXAMPLEResolveAg1",
  "https://atlas.acme.example/fulfillment": "wlpEXAMPLEFulfillAg1",
};

export function identityForId(id: string): Identity | null {
  return IDENTITIES[id] ?? null;
}

export function identityForIssuer(iss: string): Identity | null {
  if (!iss) return null;
  for (const [asId, wlp] of Object.entries(ISSUER_AS_TO_IDENTITY)) {
    if (iss.includes(asId)) return IDENTITIES[wlp] ?? null;
  }
  return null;
}

export function identityForAud(aud: string): Identity | null {
  return AUD_TO_IDENTITY[aud] ? IDENTITIES[AUD_TO_IDENTITY[aud]] ?? null : null;
}

// Short, stable display for an unknown/opaque id so fallbacks stay honest
// (never invent a friendly name for something we don't recognize).
export function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 13)}…` : id;
}
