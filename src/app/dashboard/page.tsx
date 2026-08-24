"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Activity, Settings, BarChart3, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useScannerStore, type SignalItem, type TrackedItem } from "@/lib/store";
import SignalCard from "@/components/signal-card";
import TrackedRow from "@/components/tracked-row";
import ScanPanel from "@/components/scan-panel";

import Link from "next/link";

function mapScoredToken(item: SignalItem, index: number): SignalItem {
  const age = item.ageMinutes;
  const txns = item.txns24h ?? { buys: 0, sells: 0 };
  const total = txns.buys + txns.sells;
  const buyPressure = total > 0 ? Math.round((txns.buys / total) * 100) : 50;

  return {
    id: item.address ?? String(index),
    symbol: item.symbol ?? "???",
    name: item.name ?? "",
    chain: item.chain ?? "solana",
    score: item.score ?? 0,
    tier: item.tier,
    priceUsd: item.priceUsd ?? 0,
    priceChange24h: item.priceChange24h ?? 0,
    volume24h: item.volume24h ?? 0,
    liquidity: item.liquidity ?? 0,
    buyPressure,
    ageMinutes: age,
    explanation: item.explanation ?? "",
    signals: item.signals ?? [],
    warnings: item.warnings ?? [],
    address: item.address ?? "",
    txns24h: txns,
  };
}

export default function DashboardPage() {
  const { results, tracked, lastScanAt, isScanning, error } = useScannerStore();
  const [showTracked, setShowTracked] = useState(true);

  const mappedResults: SignalItem[] = results.map(mapScoredToken);

  const tierCounts = mappedResults.reduce(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const avgScore = mappedResults.length > 0 ? Math.round(mappedResults.reduce((s, r) => s + r.score, 0) / mappedResults.length) : 0;
  const topScore = mappedResults.length > 0 ? Math.max(...mappedResults.map((r) => r.score)) : 0;
  const trackedCount = tracked.length;

  return (
    <main className="relative z-10 min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Activity size={18} className="text-primary-foreground" />
              </div>
              <span className="font-bold text-lg tracking-tight text-foreground">DegeneScan</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {lastScanAt && (
              <span className="text-xs text-muted-foreground hidden sm:inline-block">
                Last scan: {new Date(lastScanAt).toLocaleTimeString()}
              </span>
            )}
            <button className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left sidebar - controls */}
          <aside className="lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-24 space-y-4">
              <ScanPanel />

              {/* Stats Panel */}
              <div className="glass-card rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">Stats Panel</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatBadge label="Signals" value={String(mappedResults.length)} accent />
                  <StatBadge label="Avg Score" value={`${avgScore}`} />
                  <StatBadge label="Top Score" value={`${topScore}`} />
                  <StatBadge label="Tracked" value={String(trackedCount)} />
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">Tier Distribution</span>
                  <div className="flex items-center gap-1.5">
                    <TierLegend tier="A" count={tierCounts.A ?? 0} />
                    <TierLegend tier="B" count={tierCounts.B ?? 0} />
                    <TierLegend tier="C" count={tierCounts.C ?? 0} />
                    <TierLegend tier="D" count={tierCounts.D ?? 0} />
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-8">
            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 rounded-2xl bg-tier-c/10 border border-tier-c/20 text-sm text-tier-c"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scanning indicator */}
            <AnimatePresence>
              {isScanning && (
                <motion.div
                  initial={{ opacity: 0, scaleX: 0 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0, scaleX: 0 }}
                  className="h-1 rounded-full bg-gradient-to-r from-primary via-accent to-primary origin-left"
                  transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                />
              )}
            </AnimatePresence>

            {/* Signals */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  <Activity size={20} className="text-primary" />
                  Live Signals
                </h2>
                {mappedResults.length > 0 && (
                  <span className="text-xs text-muted-foreground">{mappedResults.length} result{mappedResults.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              {mappedResults.length === 0 ? (
                <div className="glass-card rounded-2xl p-12 text-center space-y-3">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-muted flex items-center justify-center">
                    <Activity size={24} className="text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm">No signals yet. Start a scan to find opportunities.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AnimatePresence>
                    {mappedResults.map((r: SignalItem, i: number) => (
                      <SignalCard key={r.id} item={r} index={i} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>

            {/* Tracked */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  <Eye size={20} className="text-primary" />
                  Tracked Signals
                </h2>
                <button
                  onClick={() => setShowTracked(!showTracked)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label={showTracked ? "Hide" : "Show"}
                >
                  {showTracked ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <AnimatePresence>
                {showTracked && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="glass-card rounded-2xl overflow-hidden"
                  >
                    {tracked.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        Track signals to monitor price changes over time.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-border/50">
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">Token</th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">First Price</th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">Now</th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">Change</th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">Link</th>
                              <th className="py-3 px-4 w-10" />
                            </tr>
                          </thead>
                          <tbody>
                            <AnimatePresence>
                              {tracked.map((t: TrackedItem, i: number) => (
                                <TrackedRow key={t.id} item={t} index={i} />
                              ))}
                            </AnimatePresence>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatBadge({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass rounded-xl p-3 flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-primary" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function TierLegend({ tier, count }: { tier: string; count: number }) {
  const colors: Record<string, string> = {
    A: "bg-tier-a text-tier-a border-tier-a/40",
    B: "bg-tier-b text-tier-b border-tier-b/40",
    C: "bg-tier-c text-tier-c border-tier-c/40",
    D: "bg-muted text-muted-foreground border-muted-foreground/40",
  };
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${colors[tier] ?? "bg-muted text-muted-foreground"}`}>
      {tier} <span className="opacity-70 ml-0.5">{count}</span>
    </span>
  );
}
