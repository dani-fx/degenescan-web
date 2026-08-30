import { applyRugcheck, scoreAndClassifyToken } from './evaluate-token'
import {
  LEGEND_MAX_RECORDS,
  legendAdmissionRejection,
  observeLegend,
  pruneLegendObservatory,
  type LegendAdmissionRejection,
  type LegendRecord,
} from './legend-policy'
import { mutateLegendRecords } from './legend-store'
import { fetchLiveTokenSnapshot } from './live-token'
import { canonicalIdentity } from './token-identity'
import type { BotConfig, RawToken, ScoredToken } from './types'

export const MAX_LEGEND_REFRESHES_PER_SCAN = 20
export const LEGEND_REFRESH_BATCH_SIZE = 5

export interface LegendObservatoryResult {
  records: LegendRecord[]
  added: number
  refreshed: number
  refreshFailed: number
  stageCounts: Record<LegendRecord['stage'], number>
  admissionDiagnostics: {
    evaluated: number
    eligible: number
    rejected: number
    reasons: Partial<Record<LegendAdmissionRejection, number>>
  }
}

function mergeLiveToken(previous: ScoredToken, snapshot: Awaited<ReturnType<typeof fetchLiveTokenSnapshot>>): RawToken | null {
  if (!snapshot) return null
  return {
    address: previous.address,
    symbol: previous.symbol,
    name: previous.name,
    chain: previous.chain,
    priceUsd: snapshot.priceUsd,
    priceChange24h: snapshot.priceChange24h,
    volume24h: snapshot.volume24h,
    liquidity: snapshot.liquidity,
    marketCap: snapshot.marketCap,
    fdv: snapshot.fdv,
    createdAt: previous.createdAt,
    pairCreatedAt: previous.pairCreatedAt,
    txns24h: { buys: snapshot.buys24h, sells: snapshot.sells24h },
    socials: previous.socials,
    logoURI: previous.logoURI,
  }
}

type RefreshOutcome =
  | { status: 'ok'; token: ScoredToken }
  | { status: 'unsafe' }
  | { status: 'failed' }

async function refreshRecord(record: LegendRecord, config: BotConfig): Promise<RefreshOutcome> {
  try {
    const snapshot = await fetchLiveTokenSnapshot(record.token.address, record.token.chain)
    const raw = mergeLiveToken(record.token, snapshot)
    if (!raw) return { status: 'failed' }
    const evaluated = scoreAndClassifyToken(raw, config).token
    const checked = await applyRugcheck(evaluated)
    return checked.hardDrop ? { status: 'unsafe' } : { status: 'ok', token: checked.token }
  } catch (error) {
    console.warn(`Legend refresh failed for ${record.key}`, error)
    return { status: 'failed' }
  }
}

function countStages(records: LegendRecord[]): LegendObservatoryResult['stageCounts'] {
  const counts: LegendObservatoryResult['stageCounts'] = {
    WATCH: 0,
    EARLY_ALERT: 0,
    BREAKOUT_CANDIDATE: 0,
    PERSISTENT_LEADER: 0,
  }
  for (const record of records) counts[record.stage] += 1
  return counts
}

export async function refreshLegendObservatory(
  discovered: ScoredToken[],
  config: BotConfig,
  nowMs = Date.now(),
): Promise<LegendObservatoryResult> {
  const discoveredByKey = new Map<string, ScoredToken>()
  for (const token of discovered) {
    try {
      discoveredByKey.set(canonicalIdentity(token.chain, token.address).key, token)
    } catch {}
  }

  return mutateLegendRecords(async (stored) => {
    const current = pruneLegendObservatory(stored, nowMs, LEGEND_MAX_RECORDS)
    // Oldest refresh attempt always wins the bounded budget. Fresh discovery
    // data is reused when available, but cannot starve quieter tracked records.
    const selected = [...current]
      .sort((a, b) => Date.parse(a.lastAttemptedAt) - Date.parse(b.lastAttemptedAt))
      .slice(0, MAX_LEGEND_REFRESHES_PER_SCAN)
    const selectedKeys = new Set(selected.map((record) => record.key))
    const next = current.filter((record) => !selectedKeys.has(record.key))
    let refreshed = 0
    let refreshFailed = 0

    const observations: Array<{ record: LegendRecord; outcome: RefreshOutcome }> = []
    for (let index = 0; index < selected.length; index += LEGEND_REFRESH_BATCH_SIZE) {
      const batch = selected.slice(index, index + LEGEND_REFRESH_BATCH_SIZE)
      observations.push(...await Promise.all(batch.map(async (record) => {
        const discoveredToken = discoveredByKey.get(record.key)
        const outcome: RefreshOutcome = discoveredToken
          ? { status: 'ok', token: discoveredToken }
          : await refreshRecord(record, config)
        return { record, outcome }
      })))
    }

    for (const observation of observations) {
      if (observation.outcome.status === 'failed') {
        refreshFailed += 1
        next.push({ ...observation.record, lastAttemptedAt: new Date(nowMs).toISOString() })
        continue
      }
      if (observation.outcome.status === 'unsafe') {
        refreshed += 1
        continue
      }
      const updated = observeLegend(observation.record, observation.outcome.token, nowMs)
      if (updated) next.push(updated)
      refreshed += 1
    }

    const knownKeys = new Set(current.map((record) => record.key))
    let added = 0
    const admissionDiagnostics: LegendObservatoryResult['admissionDiagnostics'] = {
      evaluated: 0,
      eligible: 0,
      rejected: 0,
      reasons: {},
    }
    for (const [key, token] of discoveredByKey) {
      if (knownKeys.has(key)) continue
      admissionDiagnostics.evaluated += 1
      const rejection = legendAdmissionRejection(token)
      if (rejection) {
        admissionDiagnostics.rejected += 1
        admissionDiagnostics.reasons[rejection] = (admissionDiagnostics.reasons[rejection] ?? 0) + 1
        continue
      }
      admissionDiagnostics.eligible += 1
      const record = observeLegend(null, token, nowMs)
      if (!record) continue
      next.push(record)
      knownKeys.add(key)
      added += 1
    }

    const records = pruneLegendObservatory(next, nowMs, LEGEND_MAX_RECORDS)
    const result: LegendObservatoryResult = {
      records,
      added,
      refreshed,
      refreshFailed,
      stageCounts: countStages(records),
      admissionDiagnostics,
    }
    return { records, result }
  }, nowMs)
}
