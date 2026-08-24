import { create } from "zustand";

export type ChainKey = "solana" | "base" | "ethereum" | "bsc" | "arbitrum";
export type TierKey = "A" | "B" | "C" | "D";

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
  setScanning: (v) => set({ isScanning: v }),
  setError: (e) => set({ error: e }),
  setResults: (r) => set({ results: r, lastScanAt: new Date().toISOString() }),
  setActiveChains: (c) => set({ activeChains: c }),
  setMinScore: (v) => set({ minScore: v }),
  setPollInterval: (ms) => set({ pollIntervalMs: ms }),
  track: (item) =>
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
            },
          ],
    })),
  untrack: (id) =>
    set((s) => ({
      tracked: s.tracked.filter((t) => t.id !== id),
    })),
  updateTrackedPrices: (updates) => set({ tracked: updates }),
}));
