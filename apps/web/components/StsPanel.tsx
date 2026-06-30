"use client";

import { User, ArrowRight, ShieldCheck, KeyRound, Terminal } from "lucide-react";

const HOPS = [
  { icon: User, label: "Human signs in", sub: "SSO to Okta — Claude can't exchange tokens itself" },
  { icon: Terminal, label: "Claude Code → MCP Bridge", sub: "tool call: list_my_issues / add_label" },
  { icon: KeyRound, label: "STS brokered consent", sub: "one-time consent → Okta holds the Atlassian refresh token" },
  { icon: ShieldCheck, label: "Acts as the user", sub: "short-lived token · sub = user · act = Claude" },
];

export default function StsPanel() {
  return (
    <div className="panel-edge mx-auto max-w-2xl rounded-xl p-6">
      <div className="kicker text-identity mb-1">Interactive · human in the loop</div>
      <h2 className="font-display text-lg text-bright">Claude Code + MCP Bridge — STS brokered consent</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink/80">
        The mirror image of the autonomous flow: a person is present, consents once, and Claude acts
        <span className="text-identity"> on their behalf</span>. No static credential, the Bridge brokers a
        short-lived Atlassian token through Okta STS.
      </p>

      <div className="mt-5 space-y-2">
        {HOPS.map((h, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-void/50 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-identity/40 bg-identity/10">
              <h.icon className="h-4 w-4 text-identity" />
            </div>
            <div className="flex-1">
              <div className="font-display text-[13px] text-bright">{h.label}</div>
              <div className="font-mono text-[11px] text-mute">{h.sub}</div>
            </div>
            {i < HOPS.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-edge" />}
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-line bg-void/70 p-3 font-mono text-[12px] leading-relaxed">
        <div className="text-mute"># connect Claude Code to the Bridge</div>
        <div className="text-signal">claude mcp add --transport http okta-gateway \</div>
        <div className="pl-4 text-signal">https://admin-oktaforai-poc.bridge.oktaproserv.com</div>
        <div className="mt-2 text-mute"># then, in Claude</div>
        <div className="text-bright">/mcp <span className="text-mute">authenticate → consent once → run a routine</span></div>
        <div className="text-ink/80">&gt; tag all my open ITSD tickets with reviewed-2026</div>
      </div>

      <div className="mt-4 rounded-lg border border-flight/30 bg-flight/5 px-3 py-2.5 text-[12px] text-ink/80">
        <span className="font-display text-flight">The contrast: </span>
        autonomous side anchors on a <span className="text-agent">machine delegation chain</span> (A2A +
        vaulted credential); this side anchors on a <span className="text-identity">consenting human</span> (STS).
        Same Okta. Same audit. Different root of authority.
      </div>
    </div>
  );
}
