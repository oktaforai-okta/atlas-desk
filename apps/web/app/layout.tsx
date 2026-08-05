import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Atlas Service Desk",
  description: "Autonomous IT support, secured by Okta.",
};

// Applies a stored theme choice to <html> BEFORE first paint. Doing this in React
// would render one frame in the wrong palette on every load, which is the classic
// theme flash. Absent a stored choice, no class is set and the
// prefers-color-scheme media query in globals.css follows the system.
const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("atlas:theme");
if(c==="light"||c==="dark")document.documentElement.classList.add(c);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-bg text-body">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
