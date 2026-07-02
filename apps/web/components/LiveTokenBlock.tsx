"use client";

import { useEffect, useState } from "react";
import TokenBlock from "@/components/TokenBlock";
import { TOKEN_CLAIMS_KEY } from "@/lib/events";

// Renders the real captured claims from the visitor's last live run when
// present (via sessionStorage, written by app/page.tsx as events stream in);
// falls back to a static example otherwise so the page still reads well cold.
export default function LiveTokenBlock({
  step,
  caption,
  fallbackClaims,
}: {
  step: string;
  caption: string;
  fallbackClaims: Record<string, unknown>;
}) {
  const [live, setLive] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(TOKEN_CLAIMS_KEY);
      const stored = raw ? JSON.parse(raw)[step] : null;
      if (stored?.token_claims) setLive(stored.token_claims);
    } catch {
      // fall back to the example
    }
  }, [step]);

  return (
    <TokenBlock
      caption={live ? `${caption}, real, from your last run` : `${caption} (example, simulate a ticket to see your own)`}
      claims={live ?? fallbackClaims}
    />
  );
}
