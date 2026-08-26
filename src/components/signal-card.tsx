"use client";

import { motion } from "framer-motion";
import { ExternalLink, Star, Sparkles, GraduationCap, Users, TrendingUp } from "lucide-react";
import { useScannerStore, type SignalItem, type TierKey } from "@/lib/store";

const tierStyles: Record<TierKey, { bg: string; text: string; border: string }> = {
  A: { bg: "bg-tier-a/15", text: "text-tier-a", border: "border-tier-a/40" },
  B: { bg: "bg-tier-b/15", text: "text-tier-b", border: "border-tier-b/40" },
  C: { bg: "bg-tier-c/15", text: "text-tier-c", border: "border-tier-c/40" },
  D: { bg: "bg-muted/15", text: "text-muted-foreground", border: "border-muted-foreground/40" },
};

function scoreGradient(score: number): string {
  if (score >= 65) return "from-tier-a to-emerald-400";
  if (score >= 55) return "from-tier-b to-indigo-400";
  return "from-tier-c to-amber-400";
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtAge(min: number): string {
  if (min < 60) return `${min}m`;
  return `${(min / 60).toFixed(1)}h`;
}

/** Source badge — shows which lane produced this signal. */
function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    classic: { icon: null, label: "CLASSIC", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    narrative: { icon: <Sparkles size={10} />, label: "NARRATIVE", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    graduation: { icon: <GraduationCap size={10} />, label: "GRADUATION", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  };
  const c = config[source] ?? config.classic;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${c.color}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

/** Narrative-only stats row: buyer velocity metrics. */
function NarrativeStats({ item }: { item: SignalItem }) {
  if (item.source !== "narrative") return null;
  return (
    <div className="grid grid-cols-2 gap-3 pt-1">
      <Stat
        label="1h Buyers"
        value={
          <span className="flex items-center gap-1 text-tier-b">
            <Users size={11} />
            {item.h1Buyers?.toLocaleString() ?? "?"}
          </span>
        }
      />
      <Stat
        label="$/Buyer 1h"
        value={
          <span className="flex items-center gap-1 text-tier-b">
            <TrendingUp size={11} />
            {item.h1VolPerBuyer ? fmtVol(item.h1VolPerBuyer) : "?"}
          </span>
        }
      />
    </div>
  );
}

/** Graduation-only stats: curve time + socials. */
function GraduationStats({ item }: { item: SignalItem }) {
  if (item.source !== "graduation") return null;
  return (
    <div className="grid grid-cols-2 gap-3 pt-1">
      <Stat
        label="Curve Time"
        value={
          <span className="flex items-center gap-1">
            {item.curveMinutes === null
              ? <span className="text-tier-c">?</span>
              : item.curveMinutes! <= 10
              ? <span className="text-tier-a">⚡ {item.curveMinutes}m</span>
              : <span className="text-tier-b">{item.curveMinutes}m</span>}
          </span>
        }
      />
      <Stat
        label="Socials"
        value={
          <span className="flex items-center gap-1 text-muted-foreground">
            {item.socials === 0
              ? "none"
              : `${item.socials} link${item.socials === 1 ? "" : "s"}`}
          </span>
        }
      />
    </div>
  );
}

export default function SignalCard({ item, index }: { item: SignalItem; index: number }) {
  const track = useScannerStore((s) => s.track);
  const isTracked = useScannerStore((s) => s.tracked.some((t) => t.id === item.id));
  const tierStyle = tierStyles[item.tier];

  // Explorer link: use pool/mint address for narrative and graduation, classic address for others.
  const explorerLink = `https://dexscreener.com/${item.chain}/${item.address}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card glass-card-hover rounded-2xl p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-accent/20 flex items-center justify-center text-sm font-bold text-primary border border-primary/20">
            {item.symbol.slice(0, 3)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground tracking-tight">
                ${item.symbol}
              </h3>
              <SourceBadge source={item.source ?? "classic"} />
              <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${tierStyle.bg} ${tierStyle.text} ${tierStyle.border}`}>
                {item.tier}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">
              {item.chain}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => track(item)}
            className={`p-2 rounded-lg transition-colors ${
              isTracked
                ? "bg-amber-400/15 text-amber-400"
                : "text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10"
            }`}
            aria-label={isTracked ? "Tracking" : "Track"}
          >
            <Star size={16} fill={isTracked ? "currentColor" : "none"} />
          </button>
          <a
            href={explorerLink}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open explorer"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </div>

      {/* Score */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-medium">
            Score
          </p>
          <div className="flex items-end gap-2">
            <span
              className={`text-3xl font-bold bg-gradient-to-r ${scoreGradient(item.score)} bg-clip-text text-transparent leading-none`}
            >
              {item.score}
            </span>
            <span className="text-muted-foreground text-sm mb-0.5">
              /100
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${item.score}%` }}
              transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
              className={`h-full rounded-full bg-gradient-to-r ${scoreGradient(item.score)}`}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-medium">
            Age
          </p>
          <p className="text-sm font-semibold text-foreground">{fmtAge(item.ageMinutes)}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Vol 24h" value={fmtVol(item.volume24h)} />
        <Stat label="Liquidity" value={fmtVol(item.liquidity)} />
        <Stat
          label="Price Change"
          value={
            <span className={item.priceChange24h >= 0 ? "text-tier-a" : "text-tier-c"}>
              {item.priceChange24h >= 0 ? "+" : ""}
              {item.priceChange24h.toFixed(2)}%
            </span>
          }
        />
        <Stat
          label="Buy Pressure"
          value={
            <span className={item.buyPressure >= 65 ? "text-tier-a" : item.buyPressure >= 55 ? "text-tier-b" : "text-tier-c"}>
              {item.buyPressure}%
            </span>
          }
        />
      </div>

      {/* Lane-specific stats (narrative or graduation) */}
      <NarrativeStats item={item} />
      <GraduationStats item={item} />

      {/* Explanation */}
      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-3">
        {item.explanation}
      </p>

      {/* Warnings */}
      {item.warnings.length > 0 && (
        <div className="space-y-1">
          {item.warnings.slice(0, 2).map((w, i) => (
            <p key={i} className="text-xs text-tier-c/80 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-tier-c inline-block" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <a
          href={explorerLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center py-2 rounded-xl text-xs font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          View on DexScreener
        </a>
        <button
          onClick={() => track(item)}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
            isTracked
              ? "bg-amber-400/15 text-amber-400"
              : "bg-accent/15 text-accent hover:bg-accent/25"
          }`}
        >
          {isTracked ? "Tracking" : "Track"}
        </button>
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}
