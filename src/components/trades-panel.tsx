"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Wallet,
} from "lucide-react";
import { useRef, useState } from "react";
import { useScannerStore, type TradeEntry } from "@/lib/store";

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.00001) return `$${v.toExponential(2)}`;
  if (Math.abs(v) < 0.01) return `$${v.toFixed(6)}`;
  if (Math.abs(v) < 1) return `$${v.toFixed(4)}`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function PnLIndicator({ pnl }: { pnl: number }) {
  if (pnl > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-tier-a text-sm font-semibold">
        <TrendingUp size={14} />
        {fmtPct(pnl)}
      </span>
    );
  }
  if (pnl < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-tier-c text-sm font-semibold">
        <TrendingDown size={14} />
        {fmtPct(pnl)}
      </span>
    );
  }
  return <span className="text-muted-foreground text-sm">{fmtPct(0)}</span>;
}

function TradeRow({ trade, onClose, closing = false, disabled = false }: {
  trade: TradeEntry;
  onClose: () => void;
  closing?: boolean;
  disabled?: boolean;
}) {
  const closeLabel = trade.pnl_pct > 0 ? "Take profit" : trade.pnl_pct < 0 ? "Close at loss" : "Close trade";
  const confirmationMove = trade.discovery_price_usd > 0
    ? ((trade.entry_price_usd - trade.discovery_price_usd) / trade.discovery_price_usd) * 100
    : 0;
  const promoted = trade.discovery_at !== trade.entry_at;
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors rounded-lg mb-1"
    >
      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          {trade.status === "open" ? (
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
          )}
          <span className="font-semibold text-foreground text-sm">
            ${trade.symbol}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
          {trade.chain}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          {trade.entry_tier}
        </span>
        <div className="hidden sm:block text-[10px] text-muted-foreground truncate">
          score {trade.entry_score}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 min-w-0">
        <div className="min-w-0 sm:text-right">
          <div className="text-xs text-muted-foreground">
            {promoted
              ? `Seen ${fmtUsd(trade.discovery_price_usd)} → Entry ${fmtUsd(trade.entry_price_usd)} (${fmtPct(confirmationMove)})`
              : `Entry ${fmtUsd(trade.entry_price_usd)}`}
          </div>
          <div className="text-sm font-semibold text-foreground">
            {trade.status === "open" ? "Now" : "Exit"} {fmtUsd(trade.current_price_usd)}
          </div>
        </div>
        <div className="w-px h-6 bg-border/50" />
        <div>
          <PnLIndicator pnl={trade.pnl_pct} />
        </div>
        {trade.status === "open" ? <button
          type="button"
          onClick={onClose}
          disabled={disabled || closing}
          aria-busy={closing}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed ${
            trade.pnl_pct > 0
              ? "border-tier-a/30 text-tier-a bg-tier-a/10 hover:bg-tier-a/20"
              : "border-tier-c/30 text-tier-c bg-tier-c/10 hover:bg-tier-c/20"
          }`}
          aria-label={`${closing ? "Closing" : closeLabel} ${trade.symbol}`}
          title="Close this simulated trade using a refreshed quote, or the last recorded price if unavailable"
        >
          {closing ? <Loader2 size={14} className="animate-spin" /> : trade.pnl_pct > 0 ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {closing ? "Closing…" : closeLabel}
        </button> : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle size={14} /> Closed</span>}
      </div>
    </motion.div>
  );
}

export default function TradesPanel() {
  const {
    trades,
    tradeStats,
    fetchTrades,
    closeTrade,
    refreshTradePrices,
    lastTradeRefreshAt,
  } = useScannerStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);
  const mutationPending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed").sort((a, b) => {
    const closedAt = (trade: TradeEntry) => trade.checkpoints.find((point) => point.label === "manual_close")?.at ?? trade.entry_at;
    return Date.parse(closedAt(b)) - Date.parse(closedAt(a));
  });

  const handleRefresh = async () => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setError(null);
    setRefreshing(true);
    try {
      await refreshTradePrices();
      await fetchTrades();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh trade prices. Please retry.");
    } finally {
      mutationPending.current = false;
      setRefreshing(false);
    }
  };

  const handleClose = async (trade: TradeEntry) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setClosingId(trade.id);
    setError(null);
    setNotice(null);
    try {
      await closeTrade(trade.signal_id);
      setShowClosed(true);
      setNotice(`${trade.symbol} closed. Final profit or loss is recorded below.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not close ${trade.symbol}. Please retry.`);
    } finally {
      mutationPending.current = false;
      setClosingId(null);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Simulated Trades
          </h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || closingId !== null}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          aria-label="Refresh trade prices"
        >
          {refreshing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Clock size={14} />
          )}
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-tier-c/30 bg-tier-c/10 p-3 text-xs text-tier-c">{error}</p>}
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}

      {/* Stats */}
      {tradeStats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="glass rounded-xl p-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Total
            </div>
            <div className="text-lg font-bold text-foreground mt-0.5">
              {tradeStats.totalTrades}
            </div>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Open
            </div>
            <div className="text-lg font-bold text-tier-b mt-0.5">
              {tradeStats.openTrades}
            </div>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Avg PnL
            </div>
            <div
              className={`text-lg font-bold mt-0.5 ${
                tradeStats.avgPnlPct > 0
                  ? "text-tier-a"
                  : tradeStats.avgPnlPct < 0
                  ? "text-tier-c"
                  : "text-foreground"
              }`}
            >
              {fmtPct(tradeStats.avgPnlPct)}
            </div>
          </div>
        </div>
      )}

      {lastTradeRefreshAt && (
        <div className="text-[10px] text-muted-foreground text-center">
          Last refresh {new Date(lastTradeRefreshAt).toLocaleTimeString()}
        </div>
      )}

      {/* Open trades */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <span>Open ({openTrades.length})</span>
          <button
            onClick={() => setShowClosed(!showClosed)}
            className="text-accent hover:text-accent/80 transition-colors"
          >
            {showClosed ? "Hide closed" : `Show closed (${closedTrades.length})`}
          </button>
        </div>

        {openTrades.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No open trades yet. Safe HIGH signals scoring 70+ can be
            automatically entered.
          </div>
        ) : (
          <AnimatePresence>
            {openTrades.map((t) => (
              <TradeRow key={t.id} trade={t} onClose={() => void handleClose(t)} closing={closingId === t.id} disabled={refreshing || closingId !== null} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Closed trades */}
      {showClosed && closedTrades.length > 0 && (
        <div className="space-y-1 border-t border-border/50 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Recently Closed
          </div>
          <AnimatePresence>
            {closedTrades.slice(0, 5).map((t) => (
              <TradeRow key={t.id} trade={t} onClose={() => {}} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {showClosed && closedTrades.length === 0 && (
        <div className="text-[10px] text-muted-foreground text-center">
          No closed trades yet.
        </div>
      )}

      {/* Help text */}
      <div className="pt-2 border-t border-border/50 text-[10px] text-muted-foreground leading-relaxed">
        Trades are simulated — no real funds. Close any open trade to record its profit or loss.
        Closing refreshes the quote; if unavailable, the last recorded price is used. Final PnL may differ from the current estimate.
      </div>
    </div>
  );
}
