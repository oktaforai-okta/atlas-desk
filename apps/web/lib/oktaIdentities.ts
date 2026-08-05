// The bridge between the Service Desk fabric and the real Okta tenant.
//
// This is the ONE place that maps each node in the Identity Fabric to the actual
// object it is in Okta: the workload principals, the OIDC service client, the
// authorization-server lanes, and the vaulted secret. It exists so the diagram
// can "connect the dots", a viewer can point at a node, read its real Okta name
// and id, see the scope/lane/connection that governs it, and open it in the Okta
// admin console.
//
// These are live objects in the reference tenant `oktaforai.oktapreview.com`.
// They are Okta *preview* identifiers, not secrets, but they ARE tenant-specific,
// so this is the file you edit (or override via NEXT_PUBLIC_* env) to point the
// fabric at a different tenant. Nothing tenant-specific is hardcoded anywhere else
// in the bundle.
//
// Verified live 2026-08-05 via the Workload Principals Management API:
//   Intake Service   OIDC client  0oa10s89mqikXzZo41d8   (grant: client_credentials)
//   Agent 1 (reader) wlp10qjmsgdQROgxE1d8  "Atlas Triage Agent"      ticket.read
//   Agent 2 (writer) wlp10qjml8mNlyBVK1d8  "Atlas Resolution Agent"  ticket.write + vault
//   read lane   AS aus10rq0j6dqzBIY51d8  "Atlas Resolution A2A"
//   write lane  AS aus10u0cl35sfAoaU1d8  "Atlas Fulfillment A2A"
//   bootstrap   AS aus10sd70du8BMzlL1d8  "Atlas Triage A2A"

/** Admin console base for the reference tenant. Override per deployment. */
export const OKTA_ADMIN_URL =
  process.env.NEXT_PUBLIC_OKTA_ADMIN_URL || "https://oktaforai-admin.oktapreview.com";

/** What KIND of Okta object a node is, which drives the panel's type badge. */
export type OktaObjectKind =
  | "workload-principal"
  | "service-client"
  | "authorization-server"
  | "vaulted-secret"
  | "external"
  | "downstream";

export interface NodeIdentity {
  /** Short role shown as the card's sub-label, e.g. "read-only agent". */
  role: string;
  /** Human name of the real Okta object; also the card title. */
  oktaName: string;
  /** The type badge in the detail panel, e.g. "Workload principal · AI agent". */
  kindLabel: string;
  kind: OktaObjectKind;
  /** The real id (wlp… / 0oa… / aus… / orn…). Absent for non-Okta nodes. */
  oktaId?: string;
  /** Where it lives in the admin console, e.g. "Directory ▸ AI Agents". */
  breadcrumb?: string;
  /** Panel bullet lines: the scope, lane, connection, and boundary facts. */
  facts?: string[];
  /** Deep link into the admin console. Falls back to the console root. */
  adminUrl?: string;
  /** false for the two non-Okta endpoints (inbound queue, Jira). */
  hasOktaObject: boolean;
}

const A = OKTA_ADMIN_URL.replace(/\/$/, "");

// Keyed by the fabric node id (see AtlasFabric RAW_NODES).
export const NODE_IDENTITY: Record<string, NodeIdentity> = {
  inbound: {
    role: "external system",
    oktaName: "Inbound Tickets",
    kindLabel: "External system",
    kind: "external",
    hasOktaObject: false,
    facts: ["The ticketing front door. Not an Okta identity; it holds no credential."],
  },

  svc: {
    role: "service client",
    oktaName: "Atlas Intake Service",
    kindLabel: "OIDC service client",
    kind: "service-client",
    oktaId: "0oa10s89mqikXzZo41d8",
    breadcrumb: "Applications ▸ Atlas Intake Service",
    hasOktaObject: true,
    facts: [
      "Grant type: client_credentials",
      "Mints the bootstrap token that starts the chain",
      "The one grant an AI agent may NOT use, so a service client has to originate authority",
    ],
    adminUrl: `${A}/admin/app/oidc_client/instance/0oa10s89mqikXzZo41d8`,
  },

  triage: {
    role: "read-only agent",
    oktaName: "Atlas Triage Agent",
    kindLabel: "Workload principal · AI agent",
    kind: "workload-principal",
    oktaId: "wlp10qjmsgdQROgxE1d8",
    breadcrumb: "Directory ▸ AI Agents ▸ Atlas Triage Agent",
    hasOktaObject: true,
    facts: [
      "Scope: ticket.read",
      "Lane: Atlas Resolution A2A (aus10rq0j…)",
      "Connection: A2A server · INCLUDE_ONLY [agent.invoke, ticket.read]",
      "Cannot obtain ticket.write by any route, it is not a client on the write lane",
    ],
    adminUrl: `${A}/admin/ai-agents`,
  },

  fulfill: {
    role: "write-capable agent",
    oktaName: "Atlas Resolution Agent",
    kindLabel: "Workload principal · AI agent",
    kind: "workload-principal",
    oktaId: "wlp10qjml8mNlyBVK1d8",
    breadcrumb: "Directory ▸ AI Agents ▸ Atlas Resolution Agent",
    hasOktaObject: true,
    facts: [
      "Scope: ticket.write",
      "Lane: Atlas Fulfillment A2A (aus10u0cl…)",
      "Connection: A2A server · INCLUDE_ONLY [agent.invoke, ticket.write]",
      "Also holds the vaulted Jira credential (STS_VAULT_SECRET connection mcn10vw34…)",
      "The only client authorized on the write lane",
    ],
    adminUrl: `${A}/admin/ai-agents`,
  },

  jira: {
    role: "IT Service Desk",
    oktaName: "Jira · ITSD",
    kindLabel: "Downstream system",
    kind: "downstream",
    hasOktaObject: false,
    facts: [
      "Jira Cloud REST v3, the real destination",
      "Reached only with a vaulted credential and a ticket.write token",
    ],
  },

  vault: {
    role: "vaulted secret",
    oktaName: "OPA Vault",
    kindLabel: "Okta Privileged Access · secret",
    kind: "vaulted-secret",
    oktaId: "mcn10vw34bbWut6391d8",
    breadcrumb: "Directory ▸ AI Agents ▸ Atlas Resolution Agent ▸ Resource connections",
    hasOktaObject: true,
    facts: [
      "Holds the Jira API token; never stored in agent code",
      "Released via RFC 8693 vaulted-secret exchange (STS_VAULT_SECRET)",
      "Subject = Agent 2's own inbound delegated token; the machine authorizes itself",
    ],
    adminUrl: `${A}/admin/ai-agents`,
  },
};

/** The Okta identity for a node, or a safe default for unknown ids. */
export function identityFor(nodeId: string): NodeIdentity {
  return (
    NODE_IDENTITY[nodeId] ?? {
      role: "",
      oktaName: nodeId,
      kindLabel: "Unknown",
      kind: "external",
      hasOktaObject: false,
    }
  );
}
