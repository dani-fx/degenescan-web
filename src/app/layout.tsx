import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DegeneScan — Live Memecoin Signal Scanner",
  description: "Surface early degen memecoin signals before the crowd. Scan Solana, Base, Ethereum, BSC, and Arbitrum for fresh pairs with high buy pressure, liquidity, and volume velocity.",
  keywords: ["degen", "memecoin", "crypto", "signal scanner", "solana", "base"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Build timestamp pinned at build time (not re-evaluated per request) —
// changes only when the app is rebuilt, so the edge cache can serve the
// shell between deploys and only re-validates on a new build.
const BUILD_STAMP = `<!-- b:${process.env.BUILD_TIMESTAMP || "dev"} -->`;
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans noise-bg antialiased`}>
        <div className="gradient-mesh" aria-hidden="true" />
        <div dangerouslySetInnerHTML={{ __html: BUILD_STAMP }} />
        {children}
      </body>
    </html>
  );
}
