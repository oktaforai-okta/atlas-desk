import { UserCheck, ArrowLeftRight, KeyRound, ShieldCheck } from "lucide-react";
import AtlasFabric from "@/components/AtlasFabric";

export const metadata = { title: "Architecture · Atlas Identity Operations Center" };

export default function Architecture() {
  return (
    <div className="mx-auto max-w-[1600px] px-8 py-8">
      <div className="max-w-3xl">
        <div className="text-2xs uppercase tracking-wider text-accent">Architecture</div>
        <h1 className="mt-1 text-[26px] font-bold text-bright">The Atlas identity fabric</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-body">
          Every node below is a real identity or resource in Okta. A ticket enters through the Intake Service,
          which bootstraps a chain of three governed AI agents, Agent 1, Agent 2, Agent 3, each a
          first-class <span className="text-ink">workload principal</span> that Okta brokers, owns, and can
          revoke. Hover any agent (or watch the replay dot pass it) to reveal its real name alongside its id.
          Explore it: scroll to zoom, drag a node, hover to trace its connections, or replay the
          delegation end to end.
        </p>
      </div>

      <div className="mt-6">
        <AtlasFabric />
      </div>

      <h2 className="mt-9 text-[17px] font-semibold text-bright">What Okta provides at each layer</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: UserCheck, layer: "Identity", v: "Each agent is a first-class workload principal (wlp…) in Universal Directory, its own credentials, human owner, and lifecycle. Not a shared key." },
          { icon: ArrowLeftRight, layer: "Authorization", v: "Agent-to-agent delegation is policy-governed. Each hop mints an id-jag whose act claim records who acted, a verifiable chain of custody across all three agents." },
          { icon: KeyRound, layer: "Runtime", v: "Only Agent 3 can touch prod, and its Jira credential is vaulted in OPA and brokered just-in-time, nothing static lives in agent code." },
          { icon: ShieldCheck, layer: "Governance", v: "Every hop is in the Okta System Log, attributable to a named identity. Deactivate any single agent and the chain provably breaks." },
        ].map((r) => (
          <div key={r.layer} className="glass flex items-start gap-3 p-4">
            <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <div className="text-[15px] font-semibold text-ink">{r.layer}</div>
              <div className="mt-0.5 text-[14px] leading-relaxed text-soft">{r.v}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
