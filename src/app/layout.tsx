import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { initAutoScan } from "@/lib/auto-scan";

// Resume the auto-scan schedule if it was enabled before the last restart.
initAutoScan();

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
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans noise-bg antialiased`}>
        <div className="gradient-mesh" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
