import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Atlas IOC palette — deep navy-black SOC console
        void: "#070A12",
        panel: "#0C111D",
        surface: "#111827",
        line: "#1E293B",
        edge: "#2A3A52",
        mute: "#5B6B85",
        ink: "#C7D2E0",
        bright: "#EAF2FF",
        signal: "#39E0A6",   // verified / secure (green)
        identity: "#5B8CFF", // identity / Okta blue
        flight: "#F5B23D",   // in-flight / amber
        alert: "#FF5C6C",    // denied / error
        agent: "#9B7CFF",    // agent / A2A purple-blue
      },
      fontFamily: {
        display: ["var(--font-display)", "monospace"],
        mono: ["var(--font-mono)", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(57,224,166,0.4), 0 0 24px -4px rgba(57,224,166,0.45)",
        "glow-id": "0 0 0 1px rgba(91,140,255,0.45), 0 0 24px -4px rgba(91,140,255,0.5)",
        "glow-amber": "0 0 0 1px rgba(245,178,61,0.45), 0 0 22px -6px rgba(245,178,61,0.5)",
      },
      keyframes: {
        pulseEdge: {
          "0%,100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseEdge: "pulseEdge 1.4s ease-in-out infinite",
        scan: "scan 6s linear infinite",
        riseIn: "riseIn 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
