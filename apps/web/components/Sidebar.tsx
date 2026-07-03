"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, KeyRound, Bot, ShieldCheck, Network } from "lucide-react";
import AtlasMark from "@/components/AtlasMark";

const NAV = [
  { href: "/", label: "Service Desk", icon: Inbox },
  { href: "/architecture", label: "Architecture", icon: Network },
  { href: "/tokens", label: "Token Inspector", icon: KeyRound },
  { href: "/agents", label: "Agents", icon: Bot },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <AtlasMark className="h-7 w-7 shrink-0" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold spectrum">Atlas</div>
          <div className="text-2xs text-mute">Identity Operations Center</div>
        </div>
      </div>

      <nav className="mt-2 flex-1 px-2">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] transition-colors ${
                active ? "bg-raised text-bright" : "text-soft hover:bg-surface hover:text-ink"
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? "text-accent" : "text-mute"}`} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-2 text-2xs text-soft">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-ok/60 live-dot" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          <ShieldCheck className="h-3.5 w-3.5 text-ok" />
          Secured by Okta
        </div>
        <div className="mt-1 font-mono text-2xs text-mute/70">example.oktapreview.com</div>
      </div>
    </aside>
  );
}
