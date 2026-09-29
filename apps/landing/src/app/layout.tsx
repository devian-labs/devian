import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import "./globals.css";

// Google Analytics is only loaded when an ID is configured (e.g. on devian.app).
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://devian.app"),
  title: "Devian | Stay in control of your AI coding agents",
  description: "See what Claude Code, Codex, Cursor, OpenCode and Antigravity did on your machine: sessions, commands, leftover servers, memory, token usage and cleanup. Free, open source, 100% local.",
  keywords: ["claude code", "codex", "cursor", "opencode", "antigravity", "ai coding agents", "agent observability", "token usage", "mcp server", "developer tools"],
  authors: [{ name: "Devian Labs" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Devian | Stay in control of your AI coding agents",
    description: "See what Claude Code, Codex, Cursor, OpenCode and Antigravity did on your machine: sessions, commands, leftover servers, memory, token usage and cleanup. Free, open source, 100% local.",
    siteName: "Devian",
  },
  twitter: {
    card: "summary_large_image",
    title: "Devian | Stay in control of your AI coding agents",
    description: "See what Claude Code, Codex, Cursor, OpenCode and Antigravity did on your machine: sessions, commands, leftover servers, memory, token usage and cleanup. Free, open source, 100% local.",
    creator: "@devian",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
