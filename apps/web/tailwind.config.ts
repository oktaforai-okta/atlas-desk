import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Atlas Service Desk — refined dark, tuned for projector legibility (brighter text, borders, accents)
        bg: "#0B0E13",
        panel: "#10141C",
        surface: "#141A23",
        raised: "#1A212C",
        line: "#2A323F",     // visible separators when projected
        line2: "#3A4456",
        mute: "#8B96A8",     // secondary text — readable on a projector
        soft: "#AAB4C3",
        body: "#C7D0DD",     // primary reading text
        ink: "#E4E9F1",
        bright: "#F5F8FC",
        accent: "#7AA2FF",   // brighter professional blue
        ok: "#4ED492",       // resolved (brighter green)
        warn: "#F2B450",     // in progress
        bad: "#FF6168",      // failed / denied
        triage: "#7AA2FF",   // Atlas Triage identity
        resolve: "#4ED492",  // Atlas Resolution identity
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
