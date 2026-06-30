// Server-renderable decoded-JWT/claims block with subtle highlighting.
// The `act` claim is emphasized — it is the chain of custody.

function render(obj: Record<string, unknown>, depth = 0): JSX.Element[] {
  return Object.entries(obj).map(([k, v]) => {
    const pad = { paddingLeft: depth * 14 };
    const isAct = k === "act";
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return (
        <div key={k} style={pad}>
          <span className={isAct ? "tok-act font-semibold" : "tok-key"}>&quot;{k}&quot;</span>
          <span className="tok-punc">: {"{"}</span>
          <div className={isAct ? "my-0.5 rounded bg-[#B79CFF]/8 ring-1 ring-[#B79CFF]/25" : ""}>
            {render(v as Record<string, unknown>, depth + 1)}
          </div>
          <span className="tok-punc" style={pad}>{"}"}</span>
        </div>
      );
    }
    const val = Array.isArray(v) ? `[${v.map((x) => `"${x}"`).join(", ")}]` : `"${String(v)}"`;
    return (
      <div key={k} style={pad}>
        <span className="tok-key">&quot;{k}&quot;</span>
        <span className="tok-punc">: </span>
        <span className="tok-str">{val}</span>
      </div>
    );
  });
}

export default function TokenBlock({ claims, caption }: { claims: Record<string, unknown>; caption?: string }) {
  return (
    <div className="card-quiet overflow-hidden">
      {caption && (
        <div className="border-b border-line px-3 py-1.5 font-mono text-2xs text-mute">{caption}</div>
      )}
      <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-relaxed">
        <span className="tok-punc">{"{"}</span>
        <div className="pl-1">{render(claims, 1)}</div>
        <span className="tok-punc">{"}"}</span>
      </pre>
    </div>
  );
}
