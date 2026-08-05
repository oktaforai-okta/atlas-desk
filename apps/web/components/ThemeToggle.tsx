"use client";

// System / Light / Dark, in that order, because following the OS is the right
// default and should be the first thing offered rather than an afterthought.
//
// The choice is applied to <html> as a class by an inline script in layout.tsx
// that runs before first paint. This component only reflects and updates that
// state; it deliberately does not apply the theme on mount, because doing it in
// React would mean a frame of the wrong colours on every page load.

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "atlas:theme";

const OPTIONS: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: "system", label: "Match system", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Mirror of the logic in layout.tsx's pre-paint script. */
function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (choice !== "system") root.classList.add(choice);
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage unavailable (private mode); the choice still applies this session
  }
}

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  // Read the already-applied state rather than deciding it, so the button
  // reflects what the pre-paint script did.
  useEffect(() => {
    const root = document.documentElement;
    setChoice(root.classList.contains("light") ? "light"
      : root.classList.contains("dark") ? "dark" : "system");
  }, []);

  function pick(next: ThemeChoice) {
    apply(next);
    setChoice(next);
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => pick(value)}
            aria-pressed={active}
            title={label}
            className={`flex flex-1 items-center justify-center rounded-md px-2 py-1 transition-colors ${
              active ? "bg-raised text-ink" : "text-mute hover:text-soft"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
