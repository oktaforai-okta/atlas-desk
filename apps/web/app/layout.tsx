import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono, DM_Sans } from "next/font/google";
import "./globals.css";

const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
});
const sans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Atlas Identity Operations Center",
  description: "Okta-secured agentic IT support — chain of custody at every hop.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>
        <div className="ioc-bg" />
        <div className="ioc-scan" />
        <div className="ioc-grain" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
