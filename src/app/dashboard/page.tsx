"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Settings,
  BarChart3,
  Eye,
  EyeOff,
  Sparkles,
  GraduationCap,
  HelpCircle,
  Brain,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import {
  useScannerStore,
  type SignalItem,
  type TrackedItem,
  type SignalSource,
} from "@/lib/store";
import { canonicalIdentity } from "@/lib/token-identity";
import SignalCard from "@/components/signal-card";
import TrackedRow from "@/components/tracked-row";
import ScanPanel from "@/components/scan-panel";
import TradesPanel from "@/components/trades-panel";
import LegendObservatoryPanel from "@/components/legend-observatory-panel";
import SmartWalletPanel from "@/components/smart-wallet-panel";
import Link from "next/link";

function mapScoredToken(item: SignalItem, index: number): SignalItem {
  const chain = item.chain ?? "solana";
  const address = item.address ?? "";
  const age = item.ageMinutes;
  const txns = item.txns24h ?? { buys: 0, sells: 0 };
  const total = txns.buys + txns.sells;
  const buyPressure =
    total > 0 ? Math.round((txns.buys / total) * 100) : 50;

  return {
    id: address ? canonicalIdentity(chain, address).key : `classic:${index}`,
    symbol: item.symbol ?? "???",
    name: item.name ?? "",
    chain,
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
    address,
    txns24h: txns,
    source: item.source ?? "classic",
    marketCap: item.marketCap,
    fdv: item.fdv,
    buyers24h: txns?.buys,
    sellers24h: txns?.sells,
  };
}

/** Convert a narrative gem into a SignalItem for the unified feed. */
function mapNarrativeGem(g: any, index: number): SignalItem {
  const age = g.ageMinutes;
  const total = g.h1Buyers + g.h1Sellers;
  const buyPressure = total > 0 ? Math.round((g.h1Buyers / total) * 100) : 50;
  const score = g.score;
  // Derive a tier from the narrative score (mirror classic tiers loosely).
  const tier =
    score >= 85 ? ("A" as const) : score >= 75 ? ("B" as const) : score >= 65 ? ("C" as const) : ("D" as const);
  return {
    id: canonicalIdentity(g.chain ?? "solana", g.baseMint).key,
    symbol: g.symbol ?? "???",
    name: g.name ?? "",
    chain: g.chain ?? "solana",
    score,
    tier,
    priceUsd: g.priceUsd ?? 0,
    priceChange24h: g.priceChange24h ?? 0,
    volume24h: g.volumeH24Usd ?? 0,
    liquidity: g.liquidityUsd ?? 0,
    buyPressure,
    ageMinutes: age,
    explanation: g.holderReason
      ? `NARRATIVE · ${g.holderReason}`
      : "NARRATIVE · viral buyer velocity",
    signals: [],
    warnings: [],
    address: g.baseMint,
    txns24h: {
      buys: g.h1Buyers ?? 0,
      sells: g.h1Sellers ?? 0,
    },
    source: "narrative" as SignalSource,
    h1Buyers: g.h1Buyers,
    h1VolPerBuyer: g.h1VolPerBuyer,
    holderReason: g.holderReason,
    marketCap: g.marketCap,
    fdv: g.fdv,
    volumeH1: g.volumeH1Usd,
    buyers24h: g.h1Buyers,
    sellers24h: g.h1Sellers,
  };
}

/** Convert a graduation signal into a SignalItem for the unified feed. */
function mapGraduation(g: any, index: number): SignalItem {
  const age = g.gradMinutesAgo;
  const score = Math.min(99, 40 + (g.h1Buyers >= 200 ? 20 : g.h1Buyers >= 120 ? 12 : 6));
  const tier =
    score >= 85 ? ("A" as const) : score >= 75 ? ("B" as const) : score >= 65 ? ("C" as const) : ("D" as const);
  return {
    id: canonicalIdentity(g.chain ?? "solana", g.mint).key,
    symbol: g.symbol ?? "???",
    name: g.name ?? "",
    chain: g.chain ?? "solana",
    score,
    tier,
    priceUsd: 0,
    priceChange24h: 0,
    volume24h: g.volumeH1Usd ?? 0,
    liquidity: g.liquidityUsd ?? 0,
    buyPressure: 50,
    ageMinutes: age,
    explanation: g.curveLabel
      ? `GRADUATION · ${g.curveLabel}`
      : "GRADUATION · just hit PumpSwap",
    signals: [],
    warnings: [],
    address: g.mint,
    txns24h: {
      buys: g.h1Buyers ?? 0,
      sells: 0,
    },
    source: "graduation" as SignalSource,
    gradMinutesAgo: g.gradMinutesAgo,
    curveMinutes: g.curveMinutes,
    curveLabel: g.curveLabel,
    socials: g.socials,
    marketCap: g.mcapUsd,
    volumeH1: g.volumeH1Usd,
    buyers24h: g.h1Buyers,
    sellers24h: 0,
  };
}

export default function DashboardPage() {
  const {
    results,
    tracked,
    narrativeGems,
    graduations,
    lastScanAt,
    isScanning,
    error,
    narrativeFetchedAt,
    graduationFetchedAt,
    pollIntervalMs,
    setError,
    hydrateClassicSignals,
    hydrateSettings,
    fetchTracked,
    fetchTrades,
    refreshClassicSignals,
  } = useScannerStore();
  const [showTracked, setShowTracked] = useState(true);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [graduationLoading, setGraduationLoading] = useState(false);

  const refreshAllLanes = useCallback(async () => {
    setNarrativeLoading(true);
    setGraduationLoading(true);
    const failures: unknown[] = [];

    try {
      await Promise.all([hydrateClassicSignals(), hydrateSettings()]);
    } catch (failure) {
      failures.push(failure);
    }

    const refreshNarrative = async () => {
      const response = await fetch("/api/narrative");
      if (!response.ok) throw new Error(`Narrative refresh failed (${response.status})`);
      const data = (await response.json()) as { gems?: unknown };
      if (!Array.isArray(data.gems)) throw new Error("Narrative response was malformed");
      useScannerStore.getState().setNarrativeGems(data.gems);
    };
    const refreshGraduation = async () => {
      const response = await fetch("/api/graduation");
      if (!response.ok) throw new Error(`Graduation refresh failed (${response.status})`);
      const data = (await response.json()) as { graduations?: unknown };
      if (!Array.isArray(data.graduations)) throw new Error("Graduation response was malformed");
      useScannerStore.getState().setGraduations(data.graduations);
    };

    const settled = await Promise.allSettled([
      refreshClassicSignals(),
      refreshNarrative(),
      refreshGraduation(),
      fetchTracked(),
      fetchTrades(),
    ]);
    for (const result of settled) {
      if (result.status === "rejected") failures.push(result.reason);
    }

    if (failures.length > 0) {
      const first = failures[0];
      setError(first instanceof Error ? first.message : "Refresh failed");
    } else {
      setError(null);
    }
    setNarrativeLoading(false);
    setGraduationLoading(false);
  }, [fetchTracked, fetchTrades, hydrateClassicSignals, hydrateSettings, refreshClassicSignals, setError]);

  // Hydrate persisted classic results, immediately refresh every lane, then poll at the configured interval.
  useEffect(() => {
    void refreshAllLanes();
    const interval = setInterval(() => void refreshAllLanes(), pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, refreshAllLanes]);

  const mappedResults: SignalItem[] = results.map(mapScoredToken);

  // Unified feed: classic signals + narrative gems + graduations, newest-first.
  const unifiedFeed: SignalItem[] = [
    ...mappedResults,
    ...narrativeGems.map(mapNarrativeGem),
    ...graduations.map(mapGraduation),
  ].sort((a, b) => {
    // Narrative and graduation are inherently fresher — sort by age then score.
    const ageA = a.ageMinutes ?? 9999;
    const ageB = b.ageMinutes ?? 9999;
    if (ageA !== ageB) return ageA - ageB;
    return b.score - a.score;
  });

  // Source breakdown for stats.
  const sourceCounts = unifiedFeed.reduce(
    (acc, r) => {
      const src = r.source ?? "classic";
      acc[src] = (acc[src] ?? 0) + 1;
      return acc;
    },
    {} as Record<SignalSource, number>
  );

  const tierCounts = unifiedFeed.reduce(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const avgScore =
    unifiedFeed.length > 0
      ? Math.round(
          unifiedFeed.reduce((s, r) => s + r.score, 0) / unifiedFeed.length
        )
      : 0;
  const topScore =
    unifiedFeed.length > 0 ? Math.max(...unifiedFeed.map((r) => r.score)) : 0;
  const trackedCount = tracked.length;

  return (
    <main className="relative z-10 min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Activity size={18} className="text-primary-foreground" />
              </div>
              <span className="font-bold text-lg tracking-tight text-foreground">
                DegeneScan
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {(lastScanAt || narrativeFetchedAt || graduationFetchedAt) && (
              <span className="text-xs text-muted-foreground hidden sm:inline-block">
                {lastScanAt && `Scan ${new Date(lastScanAt).toLocaleTimeString()}`}
                {lastScanAt && narrativeFetchedAt && " · "}
                {narrativeFetchedAt && (
                  <>
                    {lastScanAt ? "Narrative " : "Narrative"}
                    {new Date(narrativeFetchedAt).toLocaleTimeString()}
                  </>
                )}
                {(narrativeFetchedAt || lastScanAt) && graduationFetchedAt && " · "}
                {graduationFetchedAt && (
                  <>
                    {narrativeFetchedAt || lastScanAt ? "Grad " : "Grad"}
                    {new Date(graduationFetchedAt).toLocaleTimeString()}
                  </>
                )}
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

              {/* Trades Panel */}
              <TradesPanel />

              {/* Stats Panel */}
              <div className="glass-card rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Stats Panel
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatBadge
                    label="Signals"
                    value={String(unifiedFeed.length)}
                    accent
                  />
                  <StatBadge label="Avg Score" value={`${avgScore}`} />
                  <StatBadge label="Top Score" value={`${topScore}`} />
                  <StatBadge label="Tracked" value={String(trackedCount)} />
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">
                    Lane Breakdown
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <LaneBadge
                      label="classic"
                      count={sourceCounts.classic ?? 0}
                    />
                    <LaneBadge
                      label="narrative"
                      count={sourceCounts.narrative ?? 0}
                      icon={<Sparkles size={10} />}
                    />
                    <LaneBadge
                      label="grad"
                      count={sourceCounts.graduation ?? 0}
                      icon={<GraduationCap size={10} />}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">
                    Tier Distribution
                  </span>
                  <div className="flex items-center gap-1.5">
                    <TierLegend tier="A" count={tierCounts.A ?? 0} />
                    <TierLegend tier="B" count={tierCounts.B ?? 0} />
                    <TierLegend tier="C" count={tierCounts.C ?? 0} />
                    <TierLegend tier="D" count={tierCounts.D ?? 0} />
                  </div>
                </div>
                {/* Score legend */}
                <div className="glass-card rounded-xl p-4 space-y-2 my-2">
                  <div className="flex items-center gap-2">
                    <HelpCircle size={14} className="text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Score Legend
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[11px] leading-relaxed">
                    <ScoreRow
                      tier="A"
                      range="85–100"
                      color="text-tier-a"
                      barColor="bg-tier-a"
                      desc="Strong signal — high score across multiple factors."
                    />
                    <ScoreRow
                      tier="B"
                      range="75–84"
                      color="text-tier-b"
                      barColor="bg-tier-b"
                      desc="Solid signal — passes core thresholds."
                    />
                    <ScoreRow
                      tier="C"
                      range="65–74"
                      color="text-tier-c"
                      barColor="bg-tier-c"
                      desc="Watchable — meets relaxed bars; lower conviction."
                    />
                    <ScoreRow
                      tier="D"
                      range="0–64"
                      color="text-muted-foreground"
                      barColor="bg-muted"
                      desc="Below alert threshold — filtered out."
                    />
                  </div>
                  <div className="pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
                    Classic lane scores /100. Narrative gems score /99 (buyer-velocity scale). Graduations score /99.
                  </div>
                </div>
                <button
                  onClick={() => void refreshAllLanes()}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-2 rounded-lg border border-border/50 hover:border-border transition-colors"
                >
                  {narrativeLoading || graduationLoading ? "Refreshing..." : "Refresh all lanes"}
                </button>
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
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    ease: "easeInOut",
                  }}
                />
              )}
            </AnimatePresence>

            <LegendObservatoryPanel pollIntervalMs={pollIntervalMs} />

            <SmartWalletPanel pollIntervalMs={pollIntervalMs} />

            {/* Signals */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  <Activity size={20} className="text-primary" />
                  Live Signals
                  <span className="text-xs text-muted-foreground ml-2 font-normal">
                    {unifiedFeed.length > 0 &&
                      `${unifiedFeed.length} result${unifiedFeed.length !== 1 ? "s" : ""}`}
                  </span>
                </h2>
              </div>
              {unifiedFeed.length === 0 ? (
                <div className="glass-card rounded-2xl p-12 text-center space-y-3">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-muted flex items-center justify-center">
                    <Activity size={24} className="text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm">
                    No signals yet. Start a scan to find opportunities.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AnimatePresence>
                    {unifiedFeed.map((r: SignalItem, i: number) => (
                      <SignalCard key={`${r.source}:${r.id}`} item={r} index={i} />
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
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                Token
                              </th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                First Price
                              </th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                Now
                              </th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                Change
                              </th>
                              <th className="py-3 px-4 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                Link
                              </th>
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

function StatBadge({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="glass rounded-xl p-3 flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </span>
      <span
        className={`text-sm font-semibold ${accent ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}

function LaneBadge({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      {icon}
      {label} {count}
    </span>
  );
}

function TierLegend({ tier, count }: { tier: string; count: number }) {
  const colorMap: Record<string, string> = {
    A: "text-tier-a bg-tier-a/15",
    B: "text-tier-b bg-tier-b/15",
    C: "text-tier-c bg-tier-c/15",
    D: "text-muted-foreground bg-muted/15",
  };
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[tier] ?? colorMap.D}`}>
      {tier} {count}
    </span>
  );
}

function ScoreRow({
  tier,
  range,
  color,
  barColor,
  desc,
}: {
  tier: string;
  range: string;
  color: string;
  barColor: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-4 text-center font-bold ${color}`}>{tier}</span>
      <span className="w-12 text-[10px] text-muted-foreground font-mono">{range}</span>
      <div className={`flex-1 h-1 rounded-full ${barColor} overflow-hidden`}>
        <div className="h-full rounded-full bg-current" style={{ width: tier === "A" ? "100%" : tier === "B" ? "80%" : tier === "C" ? "60%" : "40%" }} />
      </div>
      <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{desc}</span>
    </div>
  );
}
