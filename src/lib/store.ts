import { create } from "zustand";
import type { NarrativeSignal, GraduationSignal } from "@/lib/types";

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
  /** Origin of this signal — which lane produced it. */
  source: SignalSource;
  /** Narrative-only: unique buyers in last hour. */
  h1Buyers?: number;
  /** Narrative-only: volume per unique buyer in last hour. */
  h1VolPerBuyer?: number;
  /** Narrative-only: holder distribution reason from RugCheck. */
  holderReason?: string;
  /** Graduation-only: minutes since graduation. */
  gradMinutesAgo?: number;
  /** Graduation-only: bonding curve time in minutes. */
  curveMinutes?: number | null;
  /** Graduation-only: curve speed label for UI. */
  curveLabel?: string;
  /** Graduation-only: social link count. */
  socials?: number;
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
              source: item.source,
            },
          ],
    })),
  untrack: (id) =>
    set((s) => ({
      tracked: s.tracked.filter((t) => t.id !== id),
    })),
  updateTrackedPrices: (updates) => set({ tracked: updates }),
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
}));
