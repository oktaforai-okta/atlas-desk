import AtlasFabric from "@/components/AtlasFabric";

export const metadata = { title: "Architecture · Atlas Identity Operations Center" };

export default function Architecture() {
  return (
    <div className="mx-auto max-w-[1600px] px-8 py-8">
      <div className="max-w-3xl">
        <div className="text-2xs uppercase tracking-wider text-accent">Architecture</div>
        <h1 className="mt-1 text-[26px] font-bold text-bright">The Atlas identity fabric</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-body">
          Every node below is a real identity or resource in Okta. A ticket enters through the
          Intake Service, which bootstraps two governed AI agents. Agent 1 can{" "}
          <span className="font-mono text-resolve">read</span> and nothing more. Agent 2 can{" "}
          <span className="font-mono text-fulfill">write</span>. Each is a first-class{" "}
          <span className="text-ink">workload principal</span> that Okta brokers, owns, and can
          revoke. Explore it: scroll to zoom, drag a node, hover to trace its connections, or
          replay the delegation end to end.
        </p>
      </div>

      <div className="mt-6">
        <AtlasFabric />
      </div>
    </div>
  );
}
