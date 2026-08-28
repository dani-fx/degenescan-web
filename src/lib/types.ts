export type Chain = 'solana' | 'base' | 'ethereum' | 'bsc' | 'arbitrum'

export interface RawToken {
  address: string
  symbol: string
  name: string
  chain: Chain
  priceUsd: number
  priceChange24h: number
  volume24h: number
  liquidity: number
  marketCap: number
  fdv: number
  createdAt: string
  pairCreatedAt: number
  txns24h?: { buys: number; sells: number }
  socials?: Array<{ type: string; url: string }>
  logoURI: string
}

export interface ScoredToken extends RawToken {
  score: number
  tier: TierKey
  signals: Signal[]
  explanation: string
  warnings: string[]
  fetchedAt: string
}

export interface Signal {
  type: string
  strength: 'extreme' | 'strong' | 'moderate' | 'weak'
  description: string
  points: number
}

/** Narrative-lane signal: viral pump.fun-style runner caught by unique-buyer
 *  velocity on GT trending pools, not by classic liquidity depth.
 */
export interface NarrativeSignal {
  chain: Chain
  baseMint: string
  poolAddress: string
  symbol: string
  name: string
  priceUsd: number
  liquidityUsd: number
  volumeH1Usd: number
  volumeH24Usd: number
  marketCap: number
  fdv: number
  ageMinutes: number
  h1Buyers: number
  h1Sellers: number
  m15Buyers: number
  h1VolPerBuyer: number
  score: number
  holderReason: string
  exploredAt: string
}

/** Graduation signal: pump.fun token that just hit PumpSwap.
 */
export interface GraduationSignal {
  mint: string
  poolAddress: string
  symbol: string
  name: string
  gradMinutesAgo: number
  h1Buyers: number
  m15Buyers: number
  liquidityUsd: number
  volumeH1Usd: number
  mcapUsd: number
  curveMinutes: number | null
  creator: string | null
  socials: number
  exploredAt: string
}

export type TierKey = 'A' | 'B' | 'C' | 'D'

export interface BotConfig {
  chains: Chain[]
  minLiquidityUsd: number
  maxPairAgeMinutes: number
  minScoreA: number
  minScoreB: number
  minScoreC: number
  minVolumeSpikeMultiplier: number
  minVolume24hUsd: number
  minBuyPressurePercent: number
  requireSocials: boolean
  requireLpLocked: boolean
  pollIntervalMs: number
  maxAlertsPerPoll: number
  trackRefreshChangePercent: number
}

export interface TrackedSignal {
  id: string
  token: ScoredToken
  trackedAt: string
  lastRefreshedAt?: string
  outcomes: SignalOutcome[]
}

export interface SignalOutcome {
  checkedAt: string
  priceUsd: number
  changeFromEntry: number
}

export const DEFAULT_CONFIG: BotConfig = {
  chains: ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'],
  minLiquidityUsd: 1_000,
  maxPairAgeMinutes: 720,
  minScoreA: 85,
  minScoreB: 75,
  minScoreC: 65,
  minVolumeSpikeMultiplier: 3.0,
  minVolume24hUsd: 5_000,
  minBuyPressurePercent: 55,
  requireSocials: false,
  requireLpLocked: false,
  pollIntervalMs: 5 * 60_000,
  maxAlertsPerPoll: 1,
  trackRefreshChangePercent: 5,
}

export const WEB_DEFAULT_CONFIG: BotConfig = {
  chains: ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'],
  minLiquidityUsd: 1_000,
  maxPairAgeMinutes: 720,
  minScoreA: 65,
  minScoreB: 55,
  minScoreC: 45,
  minVolumeSpikeMultiplier: 3.0,
  minVolume24hUsd: 5_000,
  minBuyPressurePercent: 50,
  requireSocials: false,
  requireLpLocked: false,
  pollIntervalMs: 5 * 60_000,
  maxAlertsPerPoll: 1,
  trackRefreshChangePercent: 5,
}

/** Auto-trade simulation: when a signal scores at or above this on a scan,
 *  a simulated trade is automatically opened (no real funds). Stored in
 *  data/trades.sqlite so it survives refreshes and restarts.
 */
export const AUTO_TRADE_MIN_SCORE = 85

export interface TradeEntry {
  id: number
  signal_id: string
  symbol: string
  chain: Chain
  address: string
  entry_price_usd: number
  entry_score: number
  entry_tier: TierKey
  entry_at: string
  current_price_usd: number
  pnl_pct: number
  status: 'open' | 'closed'
  checkpoints: TradeCheckpoint[]
  note: string
}

export interface TradeCheckpoint {
  at: string
  label: 'entry' | '15m' | '30m' | '60m' | '120m' | 'manual_close'
  price_usd: number
  pnl_pct: number
}

export interface TradeStats {
  totalTrades: number
  openTrades: number
  closedTrades: number
  avgPnlPct: number
  bestPnlPct: number
  worstPnlPct: number
  totalPnlPct: number
}
