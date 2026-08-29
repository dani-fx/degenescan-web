import {
  advanceCandidate,
  createCandidate,
  isShadowTrackable,
  MAX_CANDIDATES,
  MAX_CANDIDATE_REFRESHES_PER_SCAN,
  pruneCandidatePool,
  type CandidateRecord,
} from './candidate-policy'
import { getCandidatePool, replaceCandidatePool } from './candidate-store'
import { scoreAndClassifyToken, applyRugcheck } from './evaluate-token'
import { fetchLiveTokenSnapshot } from './live-token'
import { canonicalIdentity } from './token-identity'
import type { BotConfig, RawToken, ScoredToken } from './types'

export interface CandidatePipelineResult {
  promotions: ScoredToken[]
  managedKeys: string[]
  poolSize: number
  added: number
  refreshed: number
  refreshFailed: number
  dropped: number
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

async function refreshRecord(record: CandidateRecord, config: BotConfig): Promise<ScoredToken | null> {
  try {
    const snapshot = await fetchLiveTokenSnapshot(record.token.address, record.token.chain)
    const raw = mergeLiveToken(record.token, snapshot)
    if (!raw) return null
    const evaluated = scoreAndClassifyToken(raw, config).token
    const checked = await applyRugcheck(evaluated)
    return checked.hardDrop ? checked.token : checked.token
  } catch (error) {
    console.warn(`Candidate refresh failed for ${record.key}`, error)
    return null
  }
}

export async function refreshCandidatePipeline(
  discovered: ScoredToken[],
  config: BotConfig,
  threshold: number,
  nowMs = Date.now(),
): Promise<CandidatePipelineResult> {
  const current = pruneCandidatePool(await getCandidatePool(), nowMs, MAX_CANDIDATES)
  const byKey = new Map(current.map((record) => [record.key, record]))
  const discoveredByKey = new Map<string, ScoredToken>()
  for (const token of discovered) {
    try { discoveredByKey.set(canonicalIdentity(token.chain, token.address).key, token) } catch {}
  }

  const prioritized = [...current].sort((a, b) => {
    const aFresh = discoveredByKey.has(a.key) ? 1 : 0
    const bFresh = discoveredByKey.has(b.key) ? 1 : 0
    return bFresh - aFresh || Date.parse(a.lastEvaluatedAt) - Date.parse(b.lastEvaluatedAt)
  })
  const selected = prioritized.slice(0, MAX_CANDIDATE_REFRESHES_PER_SCAN)
  const selectedKeys = new Set(selected.map((record) => record.key))
  const next: CandidateRecord[] = current.filter((record) => !selectedKeys.has(record.key))
  const promotions: ScoredToken[] = []
  let refreshed = 0
  let refreshFailed = 0
  let dropped = 0

  const decisions: Array<{ record: CandidateRecord; fresh: ScoredToken | null }> = []
  for (let index = 0; index < selected.length; index += 5) {
    const batch = selected.slice(index, index + 5)
    decisions.push(...await Promise.all(batch.map(async (record) => {
      const fresh = discoveredByKey.get(record.key) ?? await refreshRecord(record, config)
      return { record, fresh }
    })))
  }
  for (const { record, fresh } of decisions) {
    if (!fresh) {
      refreshFailed++
      next.push({ ...record, lastEvaluatedAt: new Date(nowMs).toISOString(), lastReason: 'live refresh unavailable' })
      continue
    }
    refreshed++
    const decision = advanceCandidate(record, fresh, nowMs, threshold)
    if (!decision.record) {
      dropped++
      continue
    }
    next.push(decision.record)
    if (decision.ready) promotions.push(decision.record.token)
  }

  let added = 0
  const knownKeys = new Set(next.map((record) => record.key))
  for (const token of discovered) {
    let key: string
    try { key = canonicalIdentity(token.chain, token.address).key } catch { continue }
    if (knownKeys.has(key) || byKey.has(key) || !isShadowTrackable(token, threshold)) continue
    next.push(createCandidate(token, nowMs, threshold))
    knownKeys.add(key)
    added++
  }

  const persisted = pruneCandidatePool(next, nowMs, MAX_CANDIDATES)
  await replaceCandidatePool(persisted)
  return {
    promotions,
    managedKeys: persisted.map((record) => record.key),
    poolSize: persisted.length,
    added,
    refreshed,
    refreshFailed,
    dropped,
  }
}
