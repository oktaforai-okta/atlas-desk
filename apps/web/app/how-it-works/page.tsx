import { ArrowLeftRight, KeyRound, UserCheck, ShieldCheck, FileCheck2, Bot } from "lucide-react";
import LiveTokenBlock from "@/components/LiveTokenBlock";

export const metadata = { title: "How it works · Atlas Service Desk" };

function Hop({ n, title, who, children }: { n: string; title: string; who: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line2 bg-raised font-mono text-[13px] text-soft">
          {n}
        </span>
        <span className="mt-1 w-px flex-1 bg-line" />
      </div>
      <div className="flex-1 pb-7">
        <div className="text-[16px] font-semibold text-bright">{title}</div>
        <div className="mt-0.5 font-mono text-[13px] text-accent">{who}</div>
        <div className="mt-2 text-[15px] leading-relaxed text-body">{children}</div>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="text-2xs uppercase tracking-wider text-accent">Deep dive</div>
      <h1 className="mt-1 text-[26px] font-bold text-bright">How Atlas is secured by Okta</h1>
      <p className="mt-2 text-[16px] leading-relaxed text-body">
        On the Service Desk you watched three AI agents (Triage, Resolution, and Fulfillment) take a ticket
        from intake to a filed Jira issue with no human in the loop. Underneath, every hop is a governed Okta
        identity with a verifiable chain of custody. Here is exactly how it comes together, and what Okta provides.
      </p>

      {/* the autonomous chain */}
      <h2 className="mt-9 flex items-center gap-2 text-[17px] font-semibold text-bright">
        <Bot className="h-4 w-4 text-accent" /> The autonomous flow (agent-to-agent)
      </h2>
      <p className="mt-1.5 text-[15px] text-soft">
        No user is present. Authority flows machine-to-machine, and every token records who acted on whose behalf.
      </p>

      <div className="mt-5">
        <Hop n="1" title="Ticket arrives" who="Intake · external system">
          A ticket lands from the external ticketing system via API. No human, no session.
        </Hop>
        <Hop n="2" title="Atlas Triage authenticates" who="Atlas Triage · workload identity (wlp…)">
          The triage agent authenticates to Okta with its own key (<span className="font-mono text-[14px] text-ink">private_key_jwt</span>),
          then uses an LLM to classify the ticket and choose the destination team. It has a real identity in
          Okta Universal Directory, not a shared service account.
        </Hop>
        <Hop n="3" title="Agent-to-agent delegation, hop 1" who="Atlas Triage → Atlas Resolution">
          Triage invokes Resolution over Okta&apos;s agent-to-agent flow (machine context, scope{" "}
          <span className="font-mono text-[14px] text-ink">agent.invoke</span>). The issued token carries an{" "}
          <span className="tok-act font-semibold">act</span> claim, the verifiable record that Triage acted. One
          agent in the chain so far.
          <div className="mt-3">
            <LiveTokenBlock
              step="a2a_exchange"
              caption="hop-1 token, issued by the Atlas Resolution A2A authorization server"
              fallbackClaims={{
                sub: "0oa10s89mqikXzZo41d8",
                act: { sub: "wlp10qjmsgdQROgxE1d8", sub_profile: "ai_agent",
                       act: { sub: "0oa10s89mqikXzZo41d8", sub_profile: "service" } },
                aud: "https://atlas.acme.example/resolution",
                scp: ["agent.invoke"],
                iss: "https://oktaforai.oktapreview.com/oauth2/aus10rq0j6dqzBIY51d8",
              }}
            />
          </div>
        </Hop>
        <Hop n="4" title="Agent-to-agent delegation, hop 2" who="Atlas Resolution → Atlas Fulfillment">
          Resolution drafts the fix but has no production credential, it delegates execution to Fulfillment,
          the only agent trusted on prod. Now the token&apos;s <span className="tok-act font-semibold">act</span>{" "}
          claim nests <span className="font-semibold text-bright">both</span> agents, Resolution ← Triage ← Intake
          Service. Two workload principals in one credential; deactivate either and the chain breaks.
          <div className="mt-3">
            <LiveTokenBlock
              step="a2a_fulfillment"
              caption="final A2A token, issued by the Atlas Fulfillment A2A authorization server"
              fallbackClaims={{
                sub: "0oa10s89mqikXzZo41d8",
                act: { sub: "wlp10qjml8mNlyBVK1d8", sub_profile: "ai_agent",
                       act: { sub: "wlp10qjmsgdQROgxE1d8", sub_profile: "ai_agent",
                              act: { sub: "0oa10s89mqikXzZo41d8", sub_profile: "service" } } },
                aud: "https://atlas.acme.example/fulfillment",
                scp: ["agent.invoke"],
                iss: "https://oktaforai.oktapreview.com/oauth2/aus10u0cl35sfAoaU1d8",
              }}
            />
          </div>
        </Hop>
        <Hop n="5" title="Credential pulled from the vault" who="Atlas Fulfillment · OPA">
          To reach Jira, Fulfillment retrieves its credential from the Okta Privileged Access vault at runtime,
          never stored in the agent&apos;s code or environment. Released only to this verified identity, fully
          revocable.
          <div className="mt-3">
            <LiveTokenBlock
              step="opa_vault"
              caption="STS vaulted-secret exchange"
              fallbackClaims={{ resource: "orn:okta:opa:…:secrets:jira-atlas", requested_token_type: "vaulted-secret" }}
            />
          </div>
        </Hop>
        <Hop n="6" title="Filed in Jira" who="Atlas Fulfillment → Jira">
          Fulfillment creates the real Jira issue, routed to the correct component, priority set from the
          classified urgency, labeled, and commented. Every hop above is in the Okta System Log, attributable to a
          named identity.
        </Hop>
      </div>

      {/* the interactive contrast */}
      <h2 className="mt-6 flex items-center gap-2 text-[17px] font-semibold text-bright">
        <UserCheck className="h-4 w-4 text-accent" /> The interactive flow (human in the loop)
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-body">
        The mirror image: a person opens Claude Code through the Okta MCP Bridge, consents once, and the agent
        acts <span className="text-accent">on their behalf</span> via STS brokered consent, a short-lived token,
        no static credential. Same Okta, same audit; the difference is the root of authority: a{" "}
        <span className="text-resolve">machine delegation chain</span> vs a{" "}
        <span className="text-accent">consenting human</span>. Use the autonomous path for headless work, the
        interactive path for routines a person drives live.
      </p>

      {/* okta value */}
      <h2 className="mt-9 text-[17px] font-semibold text-bright">What Okta provides</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-line">
        {[
          { icon: UserCheck, layer: "Identity", v: "Each agent is a first-class workload identity (wlp…) in Universal Directory, its own credentials, owner, and lifecycle." },
          { icon: ArrowLeftRight, layer: "Authorization", v: "Agent-to-agent delegation is policy-governed; the act claim makes every hop verifiable (chain of custody)." },
          { icon: KeyRound, layer: "Runtime", v: "Credentials are vaulted in OPA and brokered just-in-time; nothing static lives in agent code." },
          { icon: ShieldCheck, layer: "Governance", v: "Every action is in the System Log, attributable and revocable, deactivate an agent and access stops." },
        ].map((r) => (
          <div key={r.layer} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
            <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <div className="text-[15px] font-semibold text-ink">{r.layer}</div>
              <div className="text-[14px] leading-relaxed text-soft">{r.v}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-[14px] text-soft">
        <FileCheck2 className="h-4 w-4 text-ok" />
        The tokens above are the real ones from your last run, when you&apos;ve simulated one, the same claims the Okta System Log recorded.
      </div>
    </div>
  );
}
