# Why this matters

This document is for the reader who is not going to build this. No token mechanics, no code. Just what problem this solves and why the usual answer is not good enough.

## The situation

You are going to run AI agents that do real work: file tickets, update records, move money, provision access. Those agents will call other agents, because that is how useful systems get built. A triage agent will hand work to a remediation agent, which will hand work to a fulfillment agent.

Now something goes wrong. A ticket gets closed that should not have been. A record gets overwritten. Someone gets access they should not have.

**Three questions arrive immediately:**

1. Which agent did it?
2. Was it allowed to?
3. Who authorized it to act at all?

If you cannot answer all three with evidence, you do not have a governable system. You have a system that happens to be working.

## Why the usual answer fails

The common pattern today is an API key. One credential, copied into the environment of every agent that needs it.

This fails all three questions at once:

**Which agent did it?** The downstream system saw one caller: whoever holds the key. Every agent looks identical. Your logs say "the service account did it," which is another way of saying you do not know.

**Was it allowed to?** An API key is not scoped to an agent's job. It carries whatever permissions the key has. If the triage agent's key can also write, then triage can write, whether or not you intended that, and whether or not it ever does. Capability is determined by what you copied, not by what you decided.

**Who authorized it?** Nothing recorded that. The remediation agent's call looks exactly like a call the triage agent would have made. The chain of causation exists only in your application logs, which your application wrote, which means anyone who can change your application can change the record.

There is a fourth failure that shows up later. When you need to revoke one agent's access, you rotate the shared key, and everything using it breaks at once. So in practice, nobody revokes anything.

## What this demo does instead

**Each agent is its own identity in Okta.** Not a name in a config file. A directory object with its own cryptographic key, its own human owner, and its own lifecycle. Deactivating one agent stops that agent and nothing else.

**Capability is a permission, granted centrally.** In this demo, Agent 1 holds `ticket.read` and Agent 2 holds `ticket.write`. That is not a code path or a feature flag. It is an authorization policy in Okta. Changing what an agent is allowed to do is an administrative decision, made in one place, auditable, and effective immediately, without touching or redeploying the agent.

**Over-reach is refused by the identity provider, not by the application.** When Agent 1 asks for write access, Okta returns an error. Not because the application declined to make the call, but because the request was denied before any token existed. The distinction matters enormously: application-layer checks are only as trustworthy as the application, and the application is the thing you are trying to constrain.

**Delegation is recorded in the credential itself.** When Agent 1 hands work to Agent 2, the token Agent 2 receives carries a claim naming Agent 1, and naming whoever authorized Agent 1. It is a chain of custody that travels with the request rather than living in a log file. An auditor can read it out of the token, cryptographically signed by Okta, without asking your application anything.

That last point is the one people underestimate. A log entry is a claim your system makes about itself, after the fact. A signed token is evidence produced by a third party at the moment of the action. Those are not the same kind of thing.

## The counter-intuitive part

The read-only agent is not a lesser agent. It still gets the work done. It simply cannot perform the dangerous operation itself, so it asks an agent that can.

This is worth sitting with, because it is the opposite of how people usually resolve the tension between capability and safety. The instinct is to give the agent enough permission to finish its job. The better answer is to give it very little permission and a legitimate way to ask.

The result is a system where the blast radius of any single compromised or misbehaving agent is bounded by policy rather than by hope, and where the request that caused a change is still attributable to the agent that initiated it, even though that agent could never have made the change itself.

## What you should take away

- Agents need identities, for the same reasons people do. Shared credentials destroy attribution.
- Capability should be a permission you grant, not a consequence of which secret you copied where.
- "It cannot do that" is only meaningful if something outside the agent enforces it.
- Delegation needs to be recorded in the credential, because logs are self-reported.
- Revocation has to be per-agent, or it will never actually be used.

None of this is specific to AI. It is ordinary identity practice, applied to non-human actors that now act with real autonomy and real speed. The reason it feels new is that most organizations never had to attribute the actions of software that decides things on its own.

Now they do.

---

If you want to see the mechanics, read [ARCHITECTURE.md](ARCHITECTURE.md). If you want to build it in your own tenant, read [OKTA_SETUP.md](OKTA_SETUP.md).
