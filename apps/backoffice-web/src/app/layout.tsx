import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrowserPrintAgentPosHost } from "@/components/printing/browser-print-agent-pos-host";
import { PwaBootstrap } from "@/components/pwa/pwa-bootstrap";
import "./globals.css";
import "./pos-buffet-ui-polish.css";

export const metadata: Metadata = {
  title: "CpIPOS",
  description: "Multi-tenant POS back office and IT admin",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/cpipos-browser-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/icons/cpipos-browser-icon.png",
    apple: "/icons/cpipos-browser-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "CpIPOS",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className="m-0 h-full w-full p-0">
      <body className="m-0 h-full w-full overflow-hidden p-0">
        {children}
        <PwaBootstrap />
        <BrowserPrintAgentPosHost />
      </body>
    </html>
  );
}
