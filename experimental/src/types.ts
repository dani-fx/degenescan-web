export type Stage = 'DISCOVERED' | 'ORGANIC' | 'LIQUIDITY_GROWING' | 'HOLDERS_ACCELERATING' | 'RUNNER' | 'REJECTED'

export interface BuyTrade {
  id: string
  wallet: string
  at: string
  priceUsd: number
}

export interface Snapshot {
  at: string
  priceUsd: number
  liquidityUsd: number
  volumeH1Usd: number
  h1Buyers: number
  h1Sellers: number
  m15Buyers: number
  totalHolders: number | null
  buyTrades: BuyTrade[]
  rugSafe: boolean | null
}

export interface TokenTrack {
  mint: string
  poolAddress: string
  symbol: string
  name: string
  createdAt: string
  discoveredAt: string
  stage: Stage
  snapshots: Snapshot[]
  stageTimes: Partial<Record<Stage, string>>
  reasons: string[]
  alerted: boolean
  seenTradeIds: string[]
  organicBaseline?: { at: string; liquidityUsd: number }
  holderBaseline?: { at: string; totalHolders: number }
  holderSamples?: Array<{ at: string; totalHolders: number }>
}

export interface WalletPick {
  mint: string
  enteredAt: string
  entryPrice: number
  bestPrice: number
  resolved: boolean
  multiple?: number
}

export interface WalletStats {
  wallet: string
  wins: number
  losses: number
  resolved: number
  sumMultiple: number
  picks: Record<string, WalletPick>
}

export interface RunnerSignal {
  mint: string
  poolAddress: string
  symbol: string
  stage: Stage
  detectedAt: string
  liquidityGrowthPct: number
  holderGrowthPct: number
  qualifiedWallets: string[]
  reasons: string[]
}

export interface ServiceState {
  startedAt: string
  lastCycleAt: string | null
  cycles: number
  errors: number
  tracks: Record<string, TokenTrack>
  wallets: Record<string, WalletStats>
  signals: RunnerSignal[]
}
