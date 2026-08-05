import type { Config } from "tailwindcss";

/** Colours resolve to CSS variables so light and dark can swap without touching
 *  a single className. The rgb(var(--x) / <alpha-value>) form is what preserves
 *  Tailwind's opacity modifiers, which this codebase uses constantly
 *  (bg-ok/10, border-bad/40, bg-accent/[0.06]). A plain var(--x) would break
 *  every one of them silently. Palettes live in app/globals.css. */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // an explicit choice sets .light / .dark on <html>; absent that, the media
  // query in globals.css follows the system
  darkMode: ["class", ":root.dark"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        panel: v("panel"),
        surface: v("surface"),
        raised: v("raised"),
        line: v("line"),
        line2: v("line2"),
        mute: v("mute"),
        soft: v("soft"),
        body: v("body"),
        ink: v("ink"),
        bright: v("bright"),
        accent: v("accent"),
        ok: v("ok"),
        warn: v("warn"),
        bad: v("bad"),
        triage: v("triage"),
        resolve: v("resolve"),
        fulfill: v("fulfill"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["12px", "16px"],
      },
    },
  },
  plugins: [],
};
export default config;
