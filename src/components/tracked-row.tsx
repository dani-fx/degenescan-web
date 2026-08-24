"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Trash2, ExternalLink } from "lucide-react";
import { useScannerStore, type TrackedItem, type ChainKey } from "@/lib/store";

const chainColors: Record<ChainKey, string> = {
  solana: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  base: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  ethereum: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  bsc: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  arbitrum: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.00001) return `$${v.toExponential(2)}`;
  if (v < 0.01) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(4)}`;
}

function fmtChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default function TrackedRow({ item, index }: { item: TrackedItem; index: number }) {
  const untrack = useScannerStore((s) => s.untrack);
  const explorerLink = `https://dexscreener.com/${item.chain}/${item.address}`;
  const isUp = item.priceChange >= 0;

  return (
    <motion.tr
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: "easeOut" }}
      className="group border-b border-border/50 hover:bg-muted/40 transition-colors"
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">${item.symbol}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${chainColors[item.chain]}`}>
            {item.chain}
          </span>
        </div>
      </td>
      <td className="py-3 px-4 text-sm text-muted-foreground font-mono">
        {fmtUsd(item.firstPrice)}
      </td>
      <td className="py-3 px-4 text-sm font-mono text-foreground">
        {fmtUsd(item.nowPrice)}
      </td>
      <td className="py-3 px-4">
        <span
          className={`inline-flex items-center gap-1 text-sm font-semibold ${
            isUp ? "text-tier-a" : "text-tier-c"
          }`}
        >
          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {fmtChange(item.priceChange)}
        </span>
      </td>
      <td className="py-3 px-4">
        <a
          href={explorerLink}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors inline-flex items-center"
          aria-label="Open"
        >
          <ExternalLink size={14} />
        </a>
      </td>
      <td className="py-3 px-4">
        <button
          onClick={() => untrack(item.id)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-tier-c hover:bg-tier-c/10 transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Remove"
        >
          <Trash2 size={14} />
        </button>
      </td>
    </motion.tr>
  );
}
