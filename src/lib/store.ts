import { create } from "zustand";
import { canonicalIdentity } from "@/lib/token-identity";
import type {
  GraduationSignal,
  NarrativeSignal,
  TradeEntry,
  TradeStats,
  TrackedSignal,
} from "@/lib/types";

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
  hydrateSettings: () => Promise<void>;
  track: (item: SignalItem) => Promise<void>;
  untrack: (id: string) => Promise<void>;
  updateTrackedPrices: (updates: TrackedItem[]) => void;
  setNarrativeGems: (g: NarrativeSignal[]) => void;
  setGraduations: (g: GraduationSignal[]) => void;
  setNarrativeFetchedAt: (t: string | null) => void;
  setGraduationFetchedAt: (t: string | null) => void;
  refreshAllLaneData: () => void;
  hydrateClassicSignals: () => Promise<void>;
  fetchTracked: () => Promise<void>;
  fetchTrades: (signal?: AbortSignal) => Promise<void>;
  closeTrade: (signal_id: string) => Promise<void>;
  refreshTradePrices: () => Promise<void>;
  refreshClassicSignals: () => Promise<void>;
}

export type ScannerStore = ScannerState & ScannerActions;

type LiveSnapshot = {
  chain: ChainKey;
  address: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  fdv: number;
  buys24h: number;
  sells24h: number;
};

async function responseError(response: Response, label: string): Promise<Error> {
  let detail = "";
  try {
    const data = (await response.json()) as { error?: string };
    detail = data.error ? `: ${data.error}` : "";
  } catch {}
  return new Error(`${label} failed (${response.status})${detail}`);
}

function trackedItemFromSignal(signal: TrackedSignal): TrackedItem {
  const identity = canonicalIdentity(signal.token.chain, signal.token.address);
  const firstPrice = signal.entryPriceUsd ?? signal.outcomes[0]?.priceUsd ?? signal.token.priceUsd ?? 0;
  const nowPrice = signal.token.priceUsd ?? firstPrice;
  return {
    id: identity.key,
    symbol: signal.token.symbol ?? "???",
    name: signal.token.name ?? "",
    chain: identity.chain,
    firstPrice,
    nowPrice,
    priceChange: firstPrice > 0 ? ((nowPrice - firstPrice) / firstPrice) * 100 : 0,
    address: identity.address,
    source: "classic",
  };
}

function identityKey(chain: string, address: string): string | null {
  try {
    return canonicalIdentity(chain, address).key;
  } catch {
    return null;
  }
}

function parseTrades(data: unknown): { trades: TradeEntry[]; tradeStats: TradeStats | null } {
  const value = data as { trades?: unknown; tradeStats?: TradeStats | null };
  if (!Array.isArray(value.trades)) throw new Error("Trades response was malformed");
  return { trades: value.trades as TradeEntry[], tradeStats: value.tradeStats ?? null };
}

let pollSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useScannerStore = create<ScannerStore>((set, get) => ({
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
  setResults: (r) => set({
    results: r.map((item) => ({ ...item, source: "classic" as const })),
    lastScanAt: new Date().toISOString(),
  }),
  setActiveChains: (c) => set({ activeChains: c }),
  setMinScore: (v) => set({ minScore: v }),
  setPollInterval: (ms) => {
    set({ pollIntervalMs: ms });
    if (pollSaveTimer) clearTimeout(pollSaveTimer);
    pollSaveTimer = setTimeout(async () => {
      try {
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pollIntervalMs: ms }),
        });
        if (!response.ok) throw await responseError(response, "Save poll interval");
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "Failed to save poll interval" });
      }
    }, 500);
  },
  hydrateSettings: async () => {
    const response = await fetch("/api/settings");
    if (!response.ok) throw await responseError(response, "Settings");
    const data = (await response.json()) as { settings?: { pollIntervalMs?: unknown } };
    const interval = Number(data.settings?.pollIntervalMs);
    if (Number.isFinite(interval) && interval >= 30_000) set({ pollIntervalMs: interval });
  },
  track: async (item) => {
    const identity = canonicalIdentity(item.chain, item.address);
    if (get().tracked.some((tracked) => tracked.id === identity.key)) return;

    const optimistic: TrackedItem = {
      id: identity.key,
      symbol: item.symbol,
      name: item.name,
      chain: identity.chain,
      firstPrice: item.priceUsd,
      nowPrice: item.priceUsd,
      priceChange: 0,
      address: identity.address,
      source: item.source,
    };
    set((state) => ({ tracked: [...state.tracked, optimistic], error: null }));

    try {
      const response = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "track", chain: identity.chain, address: identity.address }),
      });
      if (!response.ok) throw await responseError(response, "Track");
      const data = (await response.json()) as { tracked?: TrackedSignal };
      if (!data.tracked) throw new Error("Track response was malformed");
      const saved = trackedItemFromSignal(data.tracked);
      set((state) => ({
        tracked: state.tracked.map((tracked) => tracked.id === identity.key ? saved : tracked),
      }));
    } catch (error) {
      set((state) => ({
        tracked: state.tracked.filter((tracked) => tracked.id !== identity.key),
        error: error instanceof Error ? error.message : "Track failed",
      }));
    }
  },
  untrack: async (id) => {
    const existingIndex = get().tracked.findIndex((tracked) => tracked.id === id);
    const existing = existingIndex >= 0 ? get().tracked[existingIndex] : undefined;
    if (!existing) return;
    const identity = canonicalIdentity(existing.chain, existing.address);
    set((state) => ({
      tracked: state.tracked.filter((tracked) => tracked.id !== identity.key),
      error: null,
    }));

    try {
      const response = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "untrack", chain: identity.chain, address: identity.address }),
      });
      if (!response.ok) throw await responseError(response, "Untrack");
      await response.json();
    } catch (error) {
      set((state) => {
        if (state.tracked.some((tracked) => tracked.id === identity.key)) {
          return { error: error instanceof Error ? error.message : "Untrack failed" };
        }
        const tracked = [...state.tracked];
        tracked.splice(Math.min(existingIndex, tracked.length), 0, existing);
        return {
          tracked,
          error: error instanceof Error ? error.message : "Untrack failed",
        };
      });
    }
  },
  updateTrackedPrices: (updates) => set({ tracked: updates }),
  setNarrativeGems: (g) => set({ narrativeGems: g, narrativeFetchedAt: new Date().toISOString() }),
  setGraduations: (g) => set({ graduations: g, graduationFetchedAt: new Date().toISOString() }),
  setNarrativeFetchedAt: (t) => set({ narrativeFetchedAt: t }),
  setGraduationFetchedAt: (t) => set({ graduationFetchedAt: t }),
  refreshAllLaneData: () => set({
    narrativeGems: [],
    graduations: [],
    narrativeFetchedAt: null,
    graduationFetchedAt: null,
    lastScanAt: null,
  }),
  hydrateClassicSignals: async () => {
    const response = await fetch("/api/scan");
    if (!response.ok) throw await responseError(response, "Classic signals");
    const data = (await response.json()) as { alerts?: unknown };
    if (!Array.isArray(data.alerts)) throw new Error("Classic signals response was malformed");
    set({
      results: (data.alerts as SignalItem[]).map((item) => ({ ...item, source: "classic" })),
      lastScanAt: new Date().toISOString(),
    });
  },
  fetchTracked: async () => {
    const response = await fetch("/api/track");
    if (!response.ok) throw await responseError(response, "Tracked signals");
    const data = (await response.json()) as { tracked?: unknown };
    if (!Array.isArray(data.tracked)) throw new Error("Tracked signals response was malformed");
    set({ tracked: (data.tracked as TrackedSignal[]).map(trackedItemFromSignal) });
  },
  fetchTrades: async (signal) => {
    const response = await fetch("/api/trades", { signal });
    if (!response.ok) throw await responseError(response, "Trades");
    const parsed = parseTrades(await response.json());
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    set({ ...parsed, lastTradeRefreshAt: new Date().toISOString() });
  },
  closeTrade: async (signal_id) => {
    const response = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", signal_id }),
    });
    if (!response.ok) throw await responseError(response, "Close trade");
    const parsed = parseTrades(await response.json());
    set({ ...parsed, lastTradeRefreshAt: new Date().toISOString() });
  },
  refreshTradePrices: async () => {
    const response = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    if (!response.ok) throw await responseError(response, "Refresh trades");
    const parsed = parseTrades(await response.json());
    set({ ...parsed, lastTradeRefreshAt: new Date().toISOString() });
  },
  refreshClassicSignals: async () => {
    const identities = Array.from(new Set(
      get().results
        .filter((item) => item.source === "classic")
        .map((item) => identityKey(item.chain, item.address))
        .filter((key): key is string => key !== null),
    ));
    if (identities.length === 0) return;

    const batches: string[][] = [];
    for (let index = 0; index < identities.length; index += 25) {
      batches.push(identities.slice(index, index + 25));
    }
    const settled = await Promise.allSettled(batches.map(async (tokens) => {
      const params = new URLSearchParams({ tokens: tokens.join(",") });
      const response = await fetch(`/api/signals/live?${params.toString()}`);
      if (!response.ok) throw await responseError(response, "Live signals");
      const data = (await response.json()) as { live?: unknown };
      if (!Array.isArray(data.live)) throw new Error("Live signals response was malformed");
      return data.live as LiveSnapshot[];
    }));
    const live: LiveSnapshot[] = [];
    let failures = 0;
    for (const result of settled) {
      if (result.status === "fulfilled") live.push(...result.value);
      else failures += 1;
    }
    if (live.length === 0 && failures > 0) throw new Error("Every live-signal batch failed");

    const liveByIdentity = new Map<string, LiveSnapshot>();
    for (const snapshot of live) {
      const key = identityKey(snapshot.chain, snapshot.address);
      if (key) liveByIdentity.set(key, snapshot);
    }
    const refreshedAt = new Date().toISOString();
    set((state) => ({
      results: state.results.map((item) => {
        if (item.source !== "classic") return item;
        const key = identityKey(item.chain, item.address);
        const snapshot = key ? liveByIdentity.get(key) : undefined;
        if (!snapshot) return item;
        const total = snapshot.buys24h + snapshot.sells24h;
        return {
          ...item,
          chain: snapshot.chain,
          address: canonicalIdentity(snapshot.chain, snapshot.address).address,
          priceUsd: snapshot.priceUsd,
          priceChange24h: snapshot.priceChange24h,
          volume24h: snapshot.volume24h > 0 ? snapshot.volume24h : item.volume24h,
          liquidity: snapshot.liquidity > 0 ? snapshot.liquidity : item.liquidity,
          marketCap: snapshot.marketCap > 0 ? snapshot.marketCap : item.marketCap,
          fdv: snapshot.fdv > 0 ? snapshot.fdv : item.fdv,
          buyPressure: total > 0 ? Math.round((snapshot.buys24h / total) * 100) : 50,
          buyers24h: snapshot.buys24h,
          sellers24h: snapshot.sells24h,
          txns24h: { buys: snapshot.buys24h, sells: snapshot.sells24h },
          lastRefreshedAt: refreshedAt,
        };
      }),
    }));
  },
}));
