import { canonicalIdentity } from './token-identity'
import type { ScoredToken } from './types'

export type LegendStage = 'WATCH' | 'EARLY_ALERT' | 'BREAKOUT_CANDIDATE' | 'PERSISTENT_LEADER'
export type LegendEntryQuality = 'EARLY' | 'EXTENDED' | 'OVERHEATED'

export interface LegendSnapshot {
  observedAt: string
  priceUsd: number
  score: number
  liquidity: number
  volume24h: number
  marketCap: number
  buys24h: number
  sells24h: number
}

export interface LegendRecord {
  key: string
  token: ScoredToken
  firstSeenAt: string
  firstSeenPriceUsd: number
  lastObservedAt: string
  lastAttemptedAt: string
  expiresAt: string
  legendScore: number
  stage: LegendStage
  entryQuality: LegendEntryQuality
  dataCompleteness: number
  drivers: string[]
  risks: string[]
  snapshots: LegendSnapshot[]
}

export const LEGEND_MIN_SCORE = 65
export const LEGEND_MAX_RECORDS = 100
export const LEGEND_STANDARD_TTL_MS = 72 * 60 * 60_000
export const LEGEND_LEADER_TTL_MS = 14 * 24 * 60 * 60_000
export const LEGEND_MAX_SNAPSHOTS = 160
export const LEGEND_MIN_SNAPSHOT_INTERVAL_MS = 4 * 60_000

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function sanitizeToken(token: ScoredToken): ScoredToken {
  return {
    ...token,
    priceChange24h: Number.isFinite(token.priceChange24h) ? token.priceChange24h : 0,
    volume24h: finiteNonNegative(token.volume24h),
    marketCap: finiteNonNegative(token.marketCap),
    fdv: finiteNonNegative(token.fdv),
    pairCreatedAt: finiteNonNegative(token.pairCreatedAt),
    score: finiteNonNegative(token.score),
    txns24h: token.txns24h ? {
      buys: finiteNonNegative(token.txns24h.buys),
      sells: finiteNonNegative(token.txns24h.sells),
    } : undefined,
    signals: token.signals.map((signal) => ({
      ...signal,
      points: Number.isFinite(signal.points) ? signal.points : 0,
    })),
  }
}

function pctChange(current: number, previous: number): number {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0
}

function isSafeObservation(token: ScoredToken): boolean {
  return token.chain === 'solana'
    && token.rugcheck?.checked === true
    && token.rugcheck.safe === true
    && Number.isFinite(token.priceUsd)
    && token.priceUsd > 0
    && Number.isFinite(token.liquidity)
    && token.liquidity > 0
}

function snapshotOf(token: ScoredToken, nowMs: number): LegendSnapshot {
  return {
    observedAt: new Date(nowMs).toISOString(),
    priceUsd: finitePositive(token.priceUsd),
    score: Math.max(0, Math.min(100, finiteNonNegative(token.score))),
    liquidity: finitePositive(token.liquidity),
    volume24h: finitePositive(token.volume24h),
    marketCap: finitePositive(token.marketCap || token.fdv),
    buys24h: Math.max(0, token.txns24h?.buys ?? 0),
    sells24h: Math.max(0, token.txns24h?.sells ?? 0),
  }
}

function scoreObservation(token: ScoredToken, snapshots: LegendSnapshot[], firstPrice: number, firstSeenMs: number, nowMs: number) {
  const latest = snapshots.at(-1)!
  const previous = snapshots.at(-2)
  const observations = snapshots.length
  const ageMinutes = Math.max(0, (nowMs - firstSeenMs) / 60_000)
  const txns = latest.buys24h + latest.sells24h
  const buyPressure = txns > 0 ? (latest.buys24h / txns) * 100 : 0
  const liquidityToMcap = latest.marketCap > 0 ? latest.liquidity / latest.marketCap : 0
  const liquidityGrowth = previous ? pctChange(latest.liquidity, previous.liquidity) : 0
  const volumeGrowth = previous ? pctChange(latest.volume24h, previous.volume24h) : 0
  const demandGrowth = previous ? pctChange(txns, previous.buys24h + previous.sells24h) : 0
  const discoveryMove = pctChange(latest.priceUsd, firstPrice)
  const maxPrice = Math.max(...snapshots.map((item) => item.priceUsd))
  const drawdownFromHigh = maxPrice > 0 ? ((latest.priceUsd - maxPrice) / maxPrice) * 100 : 0

  let score = 20 // Passed the strict Solana + RugCheck safety admission gate.
  const drivers: string[] = ['RugCheck-verified Solana safety']
  const risks: string[] = ['Wallet-distribution analysis pending']

  if (token.score >= 75) score += 5
  else if (token.score >= LEGEND_MIN_SCORE) score += 3
  else {
    score -= 15
    risks.push('classic signal score fell below admission threshold')
  }

  // Market depth and ability to absorb real flow: 0-20.
  if (latest.liquidity >= 30_000) score += 6
  if (latest.liquidity >= 75_000) score += 4
  if (latest.liquidity >= 250_000) score += 3
  if (liquidityToMcap >= 0.08) score += 4
  if (latest.volume24h / Math.max(latest.liquidity, 1) >= 0.5) score += 3
  if (latest.liquidity >= 75_000 || liquidityGrowth >= 10) drivers.push('liquidity is deepening')
  if (liquidityToMcap < 0.04) risks.push('market cap is high relative to liquidity')

  // Demand quality available from public pair data: 0-25.
  if (buyPressure >= 55) score += 6
  if (buyPressure >= 65) score += 4
  if (txns >= 100) score += 4
  if (txns >= 300) score += 3
  if (demandGrowth >= 10) score += 4
  if (volumeGrowth >= 10) score += 4
  if (buyPressure >= 55 && (demandGrowth >= 10 || volumeGrowth >= 10)) drivers.push('buy-side demand is accelerating')
  if (txns > 0 && buyPressure < 50) risks.push('sell-side activity dominates')

  // Persistence and resilience: 0-20.
  if (observations >= 2) score += 5
  if (observations >= 3) score += 4
  if (ageMinutes >= 30) score += 3
  if (ageMinutes >= 60) score += 2
  if (previous && liquidityGrowth >= 0) score += 3
  if (previous && drawdownFromHigh >= -35) score += 3
  if (observations >= 3 && drawdownFromHigh >= -35) drivers.push('momentum persists across refreshes')
  if (drawdownFromHigh < -50) risks.push('price has suffered a severe drawdown')
  if (liquidityGrowth < -25) risks.push('liquidity is deteriorating')

  // Narrative metadata is a supporting signal, never a substitute for flow: 0-10.
  if ((token.socials?.length ?? 0) > 0) score += 4
  if ((token.socials?.length ?? 0) >= 2) score += 2
  if (token.signals.some((signal) => /narrative|social|organic/i.test(`${signal.type} ${signal.description}`))) score += 4
  if ((token.socials?.length ?? 0) > 0) drivers.push('public social surface exists')
  else risks.push('no public social surface detected')

  score = Math.max(0, Math.min(100, Math.round(score)))
  const entryQuality: LegendEntryQuality = discoveryMove > 100 ? 'OVERHEATED' : discoveryMove > 35 ? 'EXTENDED' : 'EARLY'
  if (entryQuality !== 'EARLY') risks.push(`entry is ${discoveryMove.toFixed(1)}% above discovery`)

  let stage: LegendStage = 'WATCH'
  if (score >= 82 && observations >= 4 && ageMinutes >= 60) stage = 'PERSISTENT_LEADER'
  else if (score >= 75 && observations >= 3 && ageMinutes >= 30) stage = 'BREAKOUT_CANDIDATE'
  else if (score >= 65 && observations >= 2) stage = 'EARLY_ALERT'

  const dataCompleteness = Math.min(70,
    40
    + (latest.marketCap > 0 ? 10 : 0)
    + (txns > 0 ? 10 : 0)
    + ((token.socials?.length ?? 0) > 0 ? 5 : 0)
    + (previous ? 5 : 0))

  return {
    legendScore: score,
    stage,
    entryQuality,
    dataCompleteness,
    drivers: [...new Set(drivers)].slice(0, 4),
    risks: [...new Set(risks)].slice(0, 4),
  }
}

export function observeLegend(previous: LegendRecord | null, token: ScoredToken, nowMs = Date.now()): LegendRecord | null {
  if (!isSafeObservation(token)) return null
  const safeToken = sanitizeToken(token)
  if (!previous && safeToken.score < LEGEND_MIN_SCORE) return null
  const key = canonicalIdentity(safeToken.chain, safeToken.address).key
  if (previous && previous.key !== key) throw new Error('Legend identity mismatch')

  const now = new Date(nowMs).toISOString()
  const firstSeenAt = previous?.firstSeenAt ?? now
  const firstSeenPriceUsd = previous?.firstSeenPriceUsd ?? safeToken.priceUsd
  const priorSnapshots = previous?.snapshots ?? []
  const nextSnapshot = snapshotOf(safeToken, nowMs)
  const lastSnapshotAt = priorSnapshots.length ? Date.parse(priorSnapshots.at(-1)!.observedAt) : Number.NEGATIVE_INFINITY
  const withinSamplingWindow = nowMs - lastSnapshotAt < LEGEND_MIN_SNAPSHOT_INTERVAL_MS
  const snapshots = withinSamplingWindow
    ? [
        ...priorSnapshots.slice(0, -1),
        { ...nextSnapshot, observedAt: priorSnapshots.at(-1)!.observedAt },
      ]
    : [...priorSnapshots, nextSnapshot].slice(-LEGEND_MAX_SNAPSHOTS)
  const evaluation = scoreObservation(safeToken, snapshots, firstSeenPriceUsd, Date.parse(firstSeenAt), nowMs)
  const firstSeenMs = Date.parse(firstSeenAt)
  const hadExtendedRetention = previous
    ? Date.parse(previous.expiresAt) > firstSeenMs + LEGEND_STANDARD_TTL_MS
    : false
  const ttl = evaluation.stage === 'PERSISTENT_LEADER' || hadExtendedRetention
    ? LEGEND_LEADER_TTL_MS
    : LEGEND_STANDARD_TTL_MS

  return {
    key,
    token: safeToken,
    firstSeenAt,
    firstSeenPriceUsd,
    lastObservedAt: now,
    lastAttemptedAt: now,
    expiresAt: new Date(firstSeenMs + ttl).toISOString(),
    ...evaluation,
    snapshots,
  }
}

export function pruneLegendObservatory(records: LegendRecord[], nowMs = Date.now(), max = LEGEND_MAX_RECORDS): LegendRecord[] {
  return records
    .filter((record) => Date.parse(record.expiresAt) > nowMs)
    .sort((a, b) => b.legendScore - a.legendScore || Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt))
    .slice(0, max)
}
