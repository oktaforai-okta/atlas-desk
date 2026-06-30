"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, BookOpen, Bot, ShieldCheck } from "lucide-react";

const NAV = [
  { href: "/", label: "Service Desk", icon: Inbox },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/how-it-works", label: "How it works", icon: BookOpen },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 ring-1 ring-accent/30">
          <span className="font-mono text-[15px] font-bold text-accent">A</span>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-bright">Atlas</div>
          <div className="text-2xs text-mute">Service Desk</div>
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
        <div className="flex items-center gap-2 text-2xs text-mute">
          <ShieldCheck className="h-3.5 w-3.5 text-ok" />
          Secured by Okta
        </div>
        <div className="mt-1 font-mono text-2xs text-mute/70">oktaforai.oktapreview.com</div>
      </div>
    </aside>
  );
}
