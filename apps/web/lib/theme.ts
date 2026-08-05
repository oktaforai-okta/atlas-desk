"use client";

// Theme resolution for the SVG diagrams.
//
// The rest of the app themes itself through CSS variables and Tailwind, but the
// two visualisations compute colours in JavaScript: they interpolate gradients,
// composite alpha, and pick stroke colours from run status. Those need actual
// values, not var() references, so they read the resolved theme and look up a
// palette.
//
// Status colour in these diagrams is information rather than decoration (idle vs
// running vs ok vs error is how you read what happened), so the light palette is
// not a lightened copy of the dark one. Each value is chosen to hold the same
// relative meaning against a white ground, which mostly means darker and more
// saturated, since the dark palette's mid-tones vanish on white.

import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

function read(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("light")) return "light";
  if (cls.contains("dark")) return "dark";
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The theme actually in effect, following both an explicit choice (a class on
 * <html>) and the system preference, and updating when either changes.
 *
 * Starts as "dark" on the server and on first client render, then corrects in an
 * effect. Reading during render would mean touching document during SSR; seeding
 * from matchMedia would desynchronise the two renders and trip hydration.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const sync = () => setTheme(read());
    sync();

    // an explicit choice toggles a class on <html>
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // the system preference can change under us (OS auto light/dark)
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    mq?.addEventListener?.("change", sync);

    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", sync);
    };
  }, []);

  return theme;
}

export interface VizPalette {
  /** page-ground of the diagram card */
  canvas: string;
  /** node with no activity yet */
  idle: string;
  /** in flight */
  warn: string;
  /** failed or refused */
  bad: string;
  /** non-agent infrastructure (intake, Jira) */
  neutral: string;
  /** Okta itself, the broker */
  okta: string;
  /** the vaulted-secret store */
  vault: string;
  /** the read-only agent */
  triage: string;
  /** read capability */
  resolve: string;
  /** the write-capable agent, and write capability */
  fulfill: string;
  /** the non-agent root of the machine chain */
  service: string;
  /** primary label inside a node */
  title: string;
  /** secondary label inside a node */
  sub: string;
  /** a label for something not yet reached */
  dim: string;
  /** the travelling token particle */
  particle: string;
  /** particle halo */
  particleHalo: string;
  /** node card fill, top and bottom stop */
  cardFrom: string;
  cardTo: string;
}

const DARK: VizPalette = {
  canvas: "#0B0E13",
  idle: "#39424F",
  warn: "#F2B450",
  bad: "#FF6168",
  neutral: "#8B96A8",
  okta: "#93B4FF",
  vault: "#64BBC8",
  triage: "#7AA2FF",
  resolve: "#4ED492",
  fulfill: "#E0A34E",
  service: "#B79CFF",
  title: "#F0F3F8",
  sub: "#8B96A8",
  dim: "#4A5462",
  particle: "#F8FAFF",
  particleHalo: "rgba(245,248,252,0.12)",
  cardFrom: "#171C25",
  cardTo: "#0F131A",
};

const LIGHT: VizPalette = {
  canvas: "#FFFFFF",
  idle: "#C8D0DC",       // visible as "not yet" without reading as active
  warn: "#B07408",       // amber is the hardest to keep legible on white
  bad: "#C72D36",
  neutral: "#5F6B7C",
  okta: "#2A5CD6",
  vault: "#0E7C8C",
  triage: "#2A5CD6",
  resolve: "#12805A",
  fulfill: "#9A5E0A",
  service: "#6A45D9",
  title: "#0F1724",
  sub: "#5F6B7C",
  dim: "#A3AEBE",
  particle: "#16202F",
  particleHalo: "rgba(22,32,47,0.10)",
  cardFrom: "#FFFFFF",
  cardTo: "#F4F6FA",
};

export function vizPalette(theme: ResolvedTheme): VizPalette {
  return theme === "light" ? LIGHT : DARK;
}

/** Composite a hex colour with alpha. Accepts #rgb/#rrggbb. */
export function withAlpha(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
