"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Loader2,
  Zap,
  RefreshCw,
  ChevronDown,
  Sparkles,
  GraduationCap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useScannerStore, type ChainKey } from "@/lib/store";

const ALL_CHAINS: { key: ChainKey; label: string; color: string }[] = [
  { key: "solana", label: "Solana", color: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  { key: "base", label: "Base", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { key: "ethereum", label: "Ethereum", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  { key: "bsc", label: "BSC", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { key: "arbitrum", label: "Arbitrum", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
];

function formatAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const h = Math.floor(mins / 60);
  return h === 1 ? "1h ago" : `${h}h ago`;
}

export default function ScanPanel() {
  const {
    isScanning,
    error,
    setScanning,
    setError,
    setResults,
    setActiveChains,
    activeChains,
    minScore,
    setMinScore,
    pollIntervalMs,
    setPollInterval,
  } = useScannerStore();

  const [autoOn, setAutoOn] = useState<boolean | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoInfo, setAutoInfo] = useState<string>("");
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [runTab, setRunTab] = useState<"scanned" | "candidates" | "rugs">("candidates");
  const scanControllerRef = useRef<AbortController | null>(null);
  const scanGenerationRef = useRef(0);

  const [autoStatus, setAutoStatus] = useState<{ enabled: boolean; lastRunAt: string | null; lastResult: string | null }>({ enabled: false, lastRunAt: null, lastResult: null });

  useEffect(() => {
    const load = () =>
      fetch("/api/autoscan")
        .then((r) => r.json())
        .then((d) => {
          setAutoOn(Boolean(d.enabled));
          setAutoStatus({ enabled: Boolean(d.enabled), lastRunAt: d.lastRunAt ?? null, lastResult: d.lastResult ?? null });
          setHistory(Array.isArray(d.history) ? d.history : []);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    scanGenerationRef.current += 1;
    scanControllerRef.current?.abort();
  }, []);

  const toggleAutoScan = async () => {
    setAutoBusy(true);
    try {
      const next = !autoOn;
      const r = await fetch("/api/autoscan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const d = await r.json();
      setAutoOn(Boolean(d.enabled));
      if (d.lastRunAt) setAutoInfo(`last: ${d.lastResult ?? "ok"}`);
    } catch {
      /* keep previous state on failure */
    } finally {
      setAutoBusy(false);
    }
  };

  const toggleChain = (chain: ChainKey) => {
    if (activeChains.includes(chain)) {
      setActiveChains(activeChains.filter((c) => c !== chain));
    } else {
      setActiveChains([...activeChains, chain]);
    }
  };

  const runScan = async () => {
    if (isScanning) return;
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = scanGenerationRef.current + 1;
    scanGenerationRef.current = generation;
    scanControllerRef.current = controller;
    setError(null);
    setScanning(true);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chains: activeChains, minScore, autoTrade: true }),
        signal: controller.signal,
      });
      if (generation !== scanGenerationRef.current || controller.signal.aborted) return;
      if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
      const data = await res.json();
      if (generation !== scanGenerationRef.current || controller.signal.aborted) return;

      try {
        await useScannerStore.getState().fetchTrades(controller.signal);
      } catch (tradeError) {
        if (tradeError instanceof DOMException && tradeError.name === "AbortError") throw tradeError;
      }
      if (generation !== scanGenerationRef.current || controller.signal.aborted) return;
      setResults(Array.isArray(data.alerts) ? data.alerts : []);
    } catch (e) {
      if (
        generation === scanGenerationRef.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      ) {
        setError(e instanceof Error ? e.message : "Scan failed");
      }
    } finally {
      if (generation === scanGenerationRef.current) {
        scanControllerRef.current = null;
        setScanning(false);
      }
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Zap size={18} className="text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">Scan Controls</h2>
      </div>

      {/* Chains */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Chains</p>
        <div className="flex flex-wrap gap-2">
          {ALL_CHAINS.map(({ key, label, color }) => {
            const active = activeChains.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleChain(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  active ? color : "bg-muted/50 text-muted-foreground border-transparent opacity-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Min Score */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Min Score</p>
          <span className="text-xs font-bold text-primary">{minScore}</span>
        </div>
        <input
          type="range"
          min={50}
          max={95}
          step={1}
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>50</span>
          <span>95</span>
        </div>
      </div>

      {/* Poll Interval */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Poll Interval</p>
          <span className="text-xs font-bold text-primary">{(pollIntervalMs / 60000).toFixed(0)}m</span>
        </div>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={pollIntervalMs / 60000}
          onChange={(e) => setPollInterval(Number(e.target.value) * 60000)}
          className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
      </div>

      {/* Auto-Scan Toggle */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <RefreshCw size={15} className={autoOn ? "text-emerald-400 animate-spin [animation-duration:3s]" : "text-muted-foreground"} />
          <div>
            <p className="text-xs font-medium">Auto-scan</p>
            <p className="text-[10px] text-muted-foreground">
              {autoOn ? "Every 5 min · all chains" : "Manual only"}
            </p>
          </div>
        </div>
        <button
          onClick={toggleAutoScan}
          disabled={autoBusy || autoOn === null}
          role="switch"
          aria-checked={autoOn ?? false}
          aria-label="Toggle auto-scan"
          className={`grid h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors ${
            autoOn ? "bg-emerald-500" : "bg-muted"
          } ${autoBusy ? "opacity-60" : "cursor-pointer"}`}
          style={{ justifyItems: autoOn ? "end" : "start" }}
        >
          <span className="block h-5 w-5 rounded-full bg-white shadow" style={{ margin: 0 }} />
        </button>
      </div>

      {/* Auto-Scan Status Banner */}
      {autoOn && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-emerald-400">AUTO-SCAN ACTIVE</span>
            {autoStatus.lastRunAt && (
              <span className="text-emerald-300/90">last run {formatAgo(autoStatus.lastRunAt)}</span>
            )}
          </div>
          {autoStatus.lastResult && (
            <p className="mt-0.5 font-mono text-[11px] text-emerald-200/80">{autoStatus.lastResult}</p>
          )}
          {autoOn && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-400/90 hover:text-emerald-300"
            >
              <ChevronDown size={12} className={`transition-transform ${showHistory ? "rotate-180" : ""}`} />
              {showHistory ? "See less" : `See more (${history.length} ${history.length === 1 ? "run" : "runs"})`}
            </button>
          )}
          {showHistory && (
            <div className="mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-emerald-500/20 bg-black/20">
              {history.map((h, i) => {
                const hasDetail = Array.isArray(h.scanned) && h.scanned.length > 0;
                const isOpen = expandedRun === i;
                return (
                  <div key={i} className="border-b border-emerald-500/10 last:border-b-0">
                    <button
                      onClick={() => hasDetail ? setExpandedRun(isOpen ? null : i) : undefined}
                      className={`flex w-full items-center justify-between px-2 py-1.5 text-left ${hasDetail ? "hover:bg-emerald-500/10 cursor-pointer" : "cursor-default"}`}
                    >
                      <span className="text-[10px] text-emerald-300/70">{formatAgo(h.at)}</span>
                      <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-200/80">
                        {h.result}
                        {hasDetail && <ChevronDown size={11} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />}
                      </span>
                    </button>
                    {isOpen && hasDetail && (
                      <div className="px-2 pb-2">
                        <div className="mb-1 flex gap-1">
                          {(["scanned", "candidates", "rugs"] as const).map((tabk) => (
                            <button
                              key={tabk}
                              onClick={() => setRunTab(tabk)}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                                runTab === tabk ? "bg-emerald-500/30 text-emerald-200" : "bg-black/20 text-emerald-300/60 hover:text-emerald-200"
                              }`}
                            >
                              {tabk} {(h[tabk]?.length ?? 0)}
                            </button>
                          ))}
                        </div>
                        <div className="max-h-36 overflow-y-auto rounded bg-black/30">
                          {(h[runTab]?.length ?? 0) === 0 ? (
                            <p className="px-2 py-1.5 text-[10px] italic text-muted-foreground">none this run</p>
                          ) : (
                            (h[runTab] as any[]).map((tk, k) => (
                              <div key={k} className="border-b border-white/5 px-2 py-1 last:border-b-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-semibold">{tk.symbol?.slice(0, 12)}</span>
                                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{tk.chain}</span>
                                </div>
                                <p className="text-[10px] leading-snug text-emerald-100/70">{tk.reason}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Scan Button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={runScan}
        disabled={activeChains.length === 0 || isScanning}
        className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
          isScanning
            ? "bg-tier-c/15 text-tier-c border border-tier-c/30 cursor-wait"
            : activeChains.length === 0
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        <AnimatePresence mode="wait">
          {isScanning ? (
            <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              Scanning...
            </motion.span>
          ) : (
            <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
              <Play size={16} />
              Start Scan
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-xl bg-tier-c/10 border border-tier-c/20 text-xs text-tier-c"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
