import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Atlas Service Desk — refined professional dark (Linear/Vercel grade)
        bg: "#0B0E13",
        panel: "#0F131A",
        surface: "#12161D",
        raised: "#161B24",
        line: "#1E242E",
        line2: "#2A323F",
        mute: "#6B7689",
        soft: "#8B95A6",
        body: "#A8B2C0",
        ink: "#D6DCE6",
        bright: "#EEF2F8",
        accent: "#5B8CFF",   // single professional accent
        ok: "#3FB97A",       // resolved
        warn: "#E0A23D",     // in progress
        bad: "#E5484D",      // failed / denied
        triage: "#5B8CFF",   // Atlas Triage identity
        resolve: "#3FB97A",  // Atlas Resolution identity
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
      },
    },
  },
  plugins: [],
};
export default config;
