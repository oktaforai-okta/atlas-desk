"use client";

// Replaces a permanently-hardcoded "Active" badge with something actually
// true: a real signal from the visitor's last live run (via the same
// sessionStorage bridge captureTokenClaims() already writes to), or an
// honest neutral state when there isn't one, never a fake "Active" lie.

import { useEffect, useState } from "react";
import { TOKEN_CLAIMS_KEY } from "@/lib/events";

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export default function AgentStatusBadge({ step }: { step: string }) {
  const [capturedAt, setCapturedAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(TOKEN_CLAIMS_KEY);
      const stored = raw ? JSON.parse(raw)[step] : null;
      if (stored?.captured_at) setCapturedAt(stored.captured_at);
    } catch {
      // fall back to the neutral default below
    }
  }, [step]);

  if (capturedAt === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-2xs text-mute ring-1 ring-line">
        <span className="dot bg-mute" /> No delegation observed this session
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-ok/10 px-2 py-1 text-2xs text-ok ring-1 ring-ok/20">
      <span className="dot bg-ok" /> Real delegation · {formatAgo(capturedAt)}
    </span>
  );
}
