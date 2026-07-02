import { Bot, ShieldCheck, KeyRound, ArrowLeftRight, FileCheck2, User } from "lucide-react";
import AgentStatusBadge from "@/components/AgentStatusBadge";

export const metadata = { title: "Agents · Atlas Service Desk" };

const AGENTS = [
  {
    name: "Atlas Triage Agent",
    wlp: "wlp10qjmsgdQROgxE1d8",
    kind: "AI Agent · workload identity",
    color: "text-triage",
    ring: "ring-triage/30 bg-triage/10",
    purpose: "Classifies inbound tickets and routes them to the right team, then delegates filing.",
    access: [
      { icon: ArrowLeftRight, t: "Invoke Atlas Resolution", d: "agent-to-agent delegation · scope agent.invoke" },
    ],
  },
  {
    name: "Atlas Resolution Agent",
    wlp: "wlp10qjml8mNlyBVK1d8",
    kind: "AI Agent · workload identity + A2A resource",
    color: "text-resolve",
    ring: "ring-resolve/30 bg-resolve/10",
    purpose: "Receives delegated tickets, decides the fix, and drafts resolution notes, then delegates execution to Fulfillment. Has no production credential.",
    access: [
      { icon: ShieldCheck, t: "Callable resource (A2A)", d: "protected by the Atlas Resolution A2A authorization server" },
      { icon: ArrowLeftRight, t: "Invoke Atlas Fulfillment", d: "agent-to-agent delegation · scope agent.invoke" },
    ],
  },
  {
    name: "Atlas Fulfillment Agent",
    wlp: "wlp10tzrk45bDrCMK1d8",
    kind: "AI Agent · workload identity + A2A resource",
    color: "text-fulfill",
    ring: "ring-fulfill/30 bg-fulfill/10",
    purpose: "The only agent trusted on production. Executes the privileged action: pulls the OPA-vaulted Jira credential and files/updates the ticket.",
    access: [
      { icon: ShieldCheck, t: "Callable resource (A2A)", d: "protected by the Atlas Fulfillment A2A authorization server" },
      { icon: KeyRound, t: "Jira credential (OPA vault)", d: "released just-in-time · never stored in code" },
      { icon: FileCheck2, t: "Jira, IT Service Desk", d: "create issue · label · comment" },
    ],
  },
];

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="text-2xs uppercase tracking-wider text-accent">Universal Directory</div>
      <h1 className="mt-1 text-[26px] font-bold text-bright">Agents</h1>
      <p className="mt-2 text-[16px] leading-relaxed text-body">
        The agents that run the Service Desk are first-class identities in Okta, each with its own
        credentials, owner, and lifecycle. Not shared service accounts, governed, auditable, revocable.
      </p>

      <div className="mt-6 space-y-4">
        {AGENTS.map((a) => (
          <div key={a.wlp} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${a.ring}`}>
                  <Bot className={`h-5 w-5 ${a.color}`} />
                </div>
                <div>
                  <div className="text-[17px] font-semibold text-bright">{a.name}</div>
                  <div className="text-2xs text-mute">{a.kind}</div>
                </div>
              </div>
              <AgentStatusBadge step="a2a_exchange" />
            </div>

            <p className="mt-3 text-[15px] leading-relaxed text-body">{a.purpose}</p>

            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3 text-[14px]">
              <Meta label="Identity (wlp)" value={a.wlp} mono />
              <Meta label="Owner" value="johnathan.campos@okta.com" icon />
              <Meta label="Credential" value="RSA JWK · active" mono />
              <Meta label="Status" value="Active" />
            </div>

            <div className="mt-4">
              <div className="mb-2 text-2xs uppercase tracking-wider text-mute">Can access</div>
              <div className="space-y-1.5">
                {a.access.map((x, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2">
                    <x.icon className="h-4 w-4 shrink-0 text-accent" />
                    <div>
                      <div className="text-[14px] text-ink">{x.t}</div>
                      <div className="font-mono text-2xs text-mute">{x.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meta({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-mute">{label}</span>
      <span className={`flex items-center gap-1 text-ink ${mono ? "font-mono text-[13px]" : ""}`}>
        {icon && <User className="h-3 w-3 text-mute" />}
        {value}
      </span>
    </div>
  );
}
