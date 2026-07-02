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
  "0oa10s89mqikXzZo41d8": { id: "0oa10s89mqikXzZo41d8", name: "Intake Service", kind: "service client", color: SERVICE_COLOR, isWorkloadPrincipal: false },
  "wlp10qjmsgdQROgxE1d8": { id: "wlp10qjmsgdQROgxE1d8", name: "Triage Agent", kind: "AI agent", color: TRIAGE_COLOR, isWorkloadPrincipal: true },
  "wlp10qjml8mNlyBVK1d8": { id: "wlp10qjml8mNlyBVK1d8", name: "Resolution Agent", kind: "AI agent", color: RESOLVE_COLOR, isWorkloadPrincipal: true },
  "wlp10tzrk45bDrCMK1d8": { id: "wlp10tzrk45bDrCMK1d8", name: "Fulfillment Agent", kind: "AI agent", color: FULFILL_COLOR, isWorkloadPrincipal: true },
};

// Each agent's A2A custom authorization server → the identity it protects.
// A real A2A token's `iss` is the target's CAS; `aud` is its resourceUrl.
const ISSUER_AS_TO_IDENTITY: Record<string, string> = {
  aus10rq0j6dqzBIY51d8: "wlp10qjml8mNlyBVK1d8",
  aus10u0cl35sfAoaU1d8: "wlp10tzrk45bDrCMK1d8",
};
const AUD_TO_IDENTITY: Record<string, string> = {
  "https://atlas.acme.example/resolution": "wlp10qjml8mNlyBVK1d8",
  "https://atlas.acme.example/fulfillment": "wlp10tzrk45bDrCMK1d8",
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
