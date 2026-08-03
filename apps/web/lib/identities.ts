// Colour vocabulary for the two-agent chain, shared by the flow graph, the
// fabric diagram, and the chain-of-custody cards so a colour means the same
// thing everywhere.
//
// Read is green, write is amber, deliberately: the eye should be able to tell
// which half of the CRUD story it is looking at without reading a label.
//
// This file used to also map hardcoded EXAMPLE_* principal ids to friendly
// names, plus issuer- and audience-to-identity lookups. Those were removed:
// they only ever matched placeholder values, so on a live run every lookup
// returned null and the UI showed opaque ids anyway. Real runs now get their
// principal ids from the orchestrator, which reads them off the actual token
// (see lib/chain.ts), so nothing needs a lookup table and no tenant-specific
// identifier is compiled into the bundle.

export const SERVICE_COLOR = "#B79CFF"; // Intake Service (non-agent root)
export const TRIAGE_COLOR = "#7AA2FF";  // Agent 1
export const RESOLVE_COLOR = "#4ED492"; // read capability
export const FULFILL_COLOR = "#E0A34E"; // write capability
export const VAULT_COLOR = "#64BBC8";

export const READ_SCOPE = "ticket.read";
export const WRITE_SCOPE = "ticket.write";

/** Short, stable display for an opaque principal id. Never invents a name. */
export function shortId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 19)}…` : id;
}
