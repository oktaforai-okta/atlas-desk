// jwt.io's own "Claims Breakdown" table: claim -> value -> plain-English
// meaning (+ spec link where a stable IETF RFC actually defines it). Reuses
// the same identity annotation as the JSON view (TokenBlock) so a value that
// resolves to a known workload principal is annotated here too.

import { identityForId, identityForAud, identityForIssuer } from "@/lib/identities";
import { describeClaim, formatClaimValue } from "@/lib/tokenInspector";

function annotatedValue(key: string, value: unknown): { text: string; color?: string; annotation?: string } {
  if (typeof value === "string") {
    const id = identityForId(value) || identityForAud(value) || identityForIssuer(value);
    if (id) return { text: value, color: id.color, annotation: id.name };
  }
  return { text: formatClaimValue(key, value) };
}

export default function ClaimsBreakdown({ claims }: { claims: Record<string, unknown> }) {
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {Object.entries(claims).map(([key, value]) => {
        const info = describeClaim(key);
        const { text, color, annotation } = annotatedValue(key, value);
        return (
          <div key={key} className="grid grid-cols-[110px_minmax(0,240px)_1fr] gap-x-4 px-3 py-2.5 text-[13px]">
            <span className="font-mono text-soft">{key}</span>
            <span className="font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
              <span style={color ? { color } : undefined} className={color ? "" : "text-ink"}>{text}</span>
              {annotation && <span className="ml-1 text-mute">· {annotation}</span>}
            </span>
            <span className="leading-relaxed text-mute">
              {info.description}
              {info.learnMoreUrl && (
                <>
                  {" "}
                  <a href={info.learnMoreUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    Learn more
                  </a>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
