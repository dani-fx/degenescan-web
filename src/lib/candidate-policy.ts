import { isAutoTradeEligible } from './scan-policy'
import { canonicalIdentity } from './token-identity'
import type { ScoredToken } from './types'

export const CANDIDATE_TTL_MS = 4 * 60 * 60_000
export const CANDIDATE_MAX_PRICE_RISE_PCT = 35
export const CANDIDATE_MIN_SCORE = 65
export const CANDIDATE_CONFIRMATIONS = 2
export const MAX_CANDIDATES = 50
export const MAX_CANDIDATE_REFRESHES_PER_SCAN = 20

export interface CandidateRecord {
  key: string
  token: ScoredToken
  firstSeenAt: string
  firstSeenPriceUsd: number
  firstSeenScore: number
  highestScore: number
  lastEvaluatedAt: string
  expiresAt: string
  consecutiveQualifying: number
  lastReason: string
}

export interface CandidateDecision {
  record: CandidateRecord | null
  ready: boolean
}

export function selectSimulatedTradeEntries(
  promotions: ScoredToken[],
  alerts: ScoredToken[],
  managedKeys: string[],
  includeDirectAlerts: boolean,
): ScoredToken[] {
  const managed = new Set(managedKeys)
  const seen = new Set<string>()
  const selected: ScoredToken[] = []
  const inputs = includeDirectAlerts
    ? [...promotions, ...alerts.filter((token) => !managed.has(canonicalIdentity(token.chain, token.address).key))]
    : promotions
  for (const token of inputs) {
    const key = canonicalIdentity(token.chain, token.address).key
    if (seen.has(key)) continue
    seen.add(key)
    selected.push(token)
  }
  return selected
}

function safeForSimulation(token: ScoredToken): boolean {
  return token.rugcheck?.checked === true && token.rugcheck.safe === true && token.priceUsd > 0
}

export function isShadowTrackable(token: ScoredToken, threshold: number): boolean {
  return safeForSimulation(token)
    && token.score >= CANDIDATE_MIN_SCORE
    && Boolean(token.signalClass)
    && !isAutoTradeEligible(token, threshold)
}

function nearMissReason(token: ScoredToken, threshold: number): string {
  if (token.score < threshold) return `score ${token.score} below ${threshold}`
  if (token.signalClass !== 'HIGH') return `signal class ${token.signalClass ?? 'none'} is not HIGH`
  return 'waiting for entry confirmation'
}

export function createCandidate(token: ScoredToken, nowMs = Date.now(), threshold = 85): CandidateRecord {
  const now = new Date(nowMs).toISOString()
  return {
    key: canonicalIdentity(token.chain, token.address).key,
    token,
    firstSeenAt: now,
    firstSeenPriceUsd: token.priceUsd,
    firstSeenScore: token.score,
    highestScore: token.score,
    lastEvaluatedAt: now,
    expiresAt: new Date(nowMs + CANDIDATE_TTL_MS).toISOString(),
    consecutiveQualifying: 0,
    lastReason: nearMissReason(token, threshold),
  }
}

export function advanceCandidate(
  candidate: CandidateRecord,
  token: ScoredToken,
  nowMs = Date.now(),
  threshold = 85,
): CandidateDecision {
  if (!safeForSimulation(token)) return { record: null, ready: false }

  const qualifies = isAutoTradeEligible(token, threshold)
  const risePct = candidate.firstSeenPriceUsd > 0
    ? ((token.priceUsd - candidate.firstSeenPriceUsd) / candidate.firstSeenPriceUsd) * 100
    : Number.POSITIVE_INFINITY
  const chased = risePct > CANDIDATE_MAX_PRICE_RISE_PCT

  if (!qualifies && !isShadowTrackable(token, threshold)) return { record: null, ready: false }

  const consecutiveQualifying = qualifies && !chased ? candidate.consecutiveQualifying + 1 : 0
  const lastReason = chased
    ? `anti-chase: price is ${risePct.toFixed(1)}% above first seen`
    : qualifies
      ? `qualified ${consecutiveQualifying}/${CANDIDATE_CONFIRMATIONS}`
      : nearMissReason(token, threshold)
  const record: CandidateRecord = {
    ...candidate,
    token,
    highestScore: Math.max(candidate.highestScore, token.score),
    lastEvaluatedAt: new Date(nowMs).toISOString(),
    consecutiveQualifying,
    lastReason,
  }
  return { record, ready: consecutiveQualifying >= CANDIDATE_CONFIRMATIONS }
}

export function pruneCandidatePool(records: CandidateRecord[], nowMs = Date.now(), max = MAX_CANDIDATES): CandidateRecord[] {
  return records
    .filter((record) => Date.parse(record.expiresAt) > nowMs)
    .sort((a, b) => b.highestScore - a.highestScore || Date.parse(b.lastEvaluatedAt) - Date.parse(a.lastEvaluatedAt))
    .slice(0, max)
}
