import { create } from "zustand";
import type { NarrativeSignal, GraduationSignal } from "@/lib/types";
import type { TradeEntry, TradeStats } from "@/lib/types";

export type { TradeEntry, TradeStats };

export type ChainKey = "solana" | "base" | "ethereum" | "bsc" | "arbitrum";
export type TierKey = "A" | "B" | "C" | "D";
export type SignalSource = "classic" | "narrative" | "graduation";

export interface SignalItem {
  id: string;
  symbol: string;
  name: string;
  chain: ChainKey;
  score: number;
  tier: TierKey;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  buyPressure: number;
  ageMinutes: number;
  explanation: string;
  signals: { type: string; strength: string; description: string; points: number }[];
  warnings: string[];
  address: string;
  txns24h?: { buys: number; sells: number };
  source: SignalSource;
  h1Buyers?: number;
  h1VolPerBuyer?: number;
  holderReason?: string;
  gradMinutesAgo?: number;
  curveMinutes?: number | null;
  curveLabel?: string;
  socials?: number;
  lastRefreshedAt?: string;
  marketCap?: number;
  fdv?: number;
  volumeH1?: number;
  buyers24h?: number;
  sellers24h?: number;
}

export interface TrackedItem {
  id: string;
  symbol: string;
  name: string;
  chain: ChainKey;
  firstPrice: number;
  nowPrice: number;
  priceChange: number;
  address: string;
  source: SignalSource;
}

export interface ScannerState {
  isScanning: boolean;
  lastScanAt: string | null;
  error: string | null;
  results: SignalItem[];
  tracked: TrackedItem[];
  activeChains: ChainKey[];
  minScore: number;
  pollIntervalMs: number;
  narrativeGems: NarrativeSignal[];
  graduations: GraduationSignal[];
  narrativeFetchedAt: string | null;
  graduationFetchedAt: string | null;
  trades: TradeEntry[];
  tradeStats: TradeStats | null;
  lastTradeRefreshAt: string | null;
}

interface ScannerActions {
  setScanning: (v: boolean) => void;
  setError: (e: string | null) => void;
  setResults: (r: SignalItem[]) => void;
  setActiveChains: (c: ChainKey[]) => void;
  setMinScore: (v: number) => void;
  setPollInterval: (ms: number) => void;
  track: (item: SignalItem) => void;
  untrack: (id: string) => void;
  updateTrackedPrices: (updates: TrackedItem[]) => void;
  setNarrativeGems: (g: NarrativeSignal[]) => void;
  setGraduations: (g: GraduationSignal[]) => void;
  setNarrativeFetchedAt: (t: string | null) => void;
  setGraduationFetchedAt: (t: string | null) => void;
  refreshAllLaneData: () => void;
  fetchTrades: () => Promise<void>;
  closeTrade: (signal_id: string) => Promise<void>;
  refreshTradePrices: () => Promise<void>;
  refreshClassicSignals: () => Promise<void>;
}

export type ScannerStore = ScannerState & ScannerActions;

export const useScannerStore = create<ScannerStore>((set) => ({
  isScanning: false,
  lastScanAt: null,
  error: null,
  results: [],
  tracked: [],
  activeChains: ["solana", "base", "ethereum", "bsc", "arbitrum"],
  minScore: 65,
  pollIntervalMs: 5 * 60_000,
  narrativeGems: [],
  graduations: [],
  narrativeFetchedAt: null,
  graduationFetchedAt: null,
  trades: [],
  tradeStats: null,
  lastTradeRefreshAt: null,
  setScanning: (v) => set({ isScanning: v }),
  setError: (e) => set({ error: e }),
  setResults: (r) =>
    set({
      results: r,
      lastScanAt: new Date().toISOString(),
    }),
  setActiveChains: (c) => set({ activeChains: c }),
  setMinScore: (v) => set({ minScore: v }),
  setPollInterval: (ms) => set({ pollIntervalMs: ms }),
  track: async (item) => {
    set((s) => ({
      tracked: s.tracked.some((t) => t.id === item.id)
        ? s.tracked
        : [
            ...s.tracked,
            {
              id: item.id,
              symbol: item.symbol,
              name: item.name,
              chain: item.chain,
              firstPrice: item.priceUsd,
              nowPrice: item.priceUsd,
              priceChange: 0,
              address: item.address,
              source: item.source,
            },
          ],
    }))
    try {
      await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: item.address, action: 'track' }),
      })
    } catch {}
  },
  untrack: async (id) => {
    set((s) => ({
      tracked: s.tracked.filter((t) => t.id !== id),
    }))
    try {
      await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: id, action: 'untrack' }),
      })
    } catch {}
  },
  updateTrackedPrices: (updates: TrackedItem[]) => set({ tracked: updates }),
  setNarrativeGems: (g) =>
    set({
      narrativeGems: g,
      narrativeFetchedAt: new Date().toISOString(),
    }),
  setGraduations: (g) =>
    set({
      graduations: g,
      graduationFetchedAt: new Date().toISOString(),
    }),
  setNarrativeFetchedAt: (t) => set({ narrativeFetchedAt: t }),
  setGraduationFetchedAt: (t) => set({ graduationFetchedAt: t }),
  refreshAllLaneData: () => set({
    narrativeGems: [],
    graduations: [],
    narrativeFetchedAt: null,
    graduationFetchedAt: null,
    lastScanAt: null,
  }),
  fetchTrades: async () => {
    try {
      const r = await fetch("/api/trades")
      const d: any = await r.json()
      set({
        trades: d.trades ?? [],
        tradeStats: d.tradeStats ?? null,
        lastTradeRefreshAt: new Date().toISOString(),
      })
    } catch {}
  },
  closeTrade: async (signal_id) => {
    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal_id, action: "close" }),
      })
      const r = await fetch("/api/trades")
      const d: any = await r.json()
      set({ trades: d.trades ?? [], tradeStats: d.tradeStats ?? null })
    } catch {}
  },
  refreshTradePrices: async () => {
    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      })
      const r = await fetch("/api/trades")
      const d: any = await r.json()
      set({
        trades: d.trades ?? [],
        tradeStats: d.tradeStats ?? null,
        lastTradeRefreshAt: new Date().toISOString(),
      })
    } catch {}
  },
  refreshClassicSignals: async () => {
    try {
      const liveAddresses = useScannerStore
        .getState()
        .results.filter((r) => r.source === "classic").map((r) => r.address).filter(Boolean)
      if (!liveAddresses.length) return
      const params = new URLSearchParams({ addresses: liveAddresses.join(",") })
      const r = await fetch(`/api/signals/live?${params.toString()}`)
      const d: any = await r.json()
      if (d.live?.length) {
        const liveByAddr = new Map<string, { priceUsd: number; priceChange24h: number; volume24h: number; liquidity: number; marketCap: number; fdv: number; buys24h: number; sells24h: number }>(
          d.live.map((l: any) => [l.address, l])
        )
        set((s) => ({
          results: s.results.map((item) => {
            if (item.source !== "classic") return item
            const live = liveByAddr.get(item.address)
            if (!live) return item
            const total = live.buys24h + live.sells24h
            const buyPressure = total > 0 ? Math.round((live.buys24h / total) * 100) : 50
            return {
              ...item,
              priceUsd: live.priceUsd,
              priceChange24h: live.priceChange24h,
              volume24h: live.volume24h,
              liquidity: live.liquidity,
              marketCap: live.marketCap,
              fdv: live.fdv,
              buyPressure,
              buyers24h: live.buys24h,
              sellers24h: live.sells24h,
              txns24h: { buys: live.buys24h, sells: live.sells24h },
              lastRefreshedAt: new Date().toISOString(),
            }
          }),
        }))
      }
    } catch {}
  },
}))
