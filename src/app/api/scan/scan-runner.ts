import { fetchTokensForChain } from '@/lib/fetcher'
import { upsertTrackedSignal } from '@/lib/signal-store'
import { record } from '@/lib/outcome-store'
import { applyRugcheck, scoreAndClassifyToken } from '@/lib/evaluate-token'
import { refreshCandidatePipeline } from '@/lib/candidate-service'
import { CANDIDATE_MIN_SCORE } from '@/lib/candidate-policy'
import { refreshLegendObservatory } from '@/lib/legend-service'
import type { LegendObservatoryResult } from '@/lib/legend-service'
import { AUTO_TRADE_MIN_SCORE, type BotConfig, type Chain, type ScoredToken } from '@/lib/types'

type TokenDetail = { symbol: string; chain: string; score?: number; reason: string }
export interface ScanResult {
  alerts: ScoredToken[]
  watchlist: ScoredToken[]
  promotions: ScoredToken[]
  managedCandidateKeys: string[]
  legendUpdate: Promise<LegendObservatoryResult>
  meta: Record<string, unknown>
  details: { scanned: TokenDetail[]; candidates: TokenDetail[]; rugs: TokenDetail[] }
}

export async function runScan(chains: Chain[], config: BotConfig, minScore: number): Promise<ScanResult> {
  const candidates: ScoredToken[] = []
  const detailScanned: TokenDetail[] = []
  const detailRugs: TokenDetail[] = []
  let scanned = 0
  let rugsDropped = 0
  let chainFailures = 0

  for (let index = 0; index < chains.length; index++) {
    if (index) await new Promise((resolve) => setTimeout(resolve, 1_500))
    let tokens
    try { tokens = await fetchTokensForChain(chains[index]) }
    catch { chainFailures++; continue }
    scanned += tokens.length
    for (const token of tokens) {
      const { token: scored, reason } = scoreAndClassifyToken(token, config)
      detailScanned.push({ symbol: token.symbol, chain: token.chain, score: scored.score, reason })
      if (scored.signalClass && (scored.score >= CANDIDATE_MIN_SCORE || (scored.tier !== 'D' && scored.score >= minScore))) candidates.push(scored)
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const passed: ScoredToken[] = []
  for (const token of candidates) {
    const check = await applyRugcheck(token)
    if (check.hardDrop) {
      rugsDropped++
      detailRugs.push({ symbol: token.symbol, chain: token.chain, score: token.score, reason: check.reason })
    } else passed.push(token)
  }

  const candidatePipeline = await refreshCandidatePipeline(passed, config, AUTO_TRADE_MIN_SCORE)
  const legendUpdate: Promise<LegendObservatoryResult> = refreshLegendObservatory(passed, config).catch((error) => {
    // The observatory is research-only. Its storage/provider failures must
    // never block the authoritative scan, candidate pipeline, or trading path.
    console.error('Legend observatory update failed', error)
    return {
      records: [], added: 0, refreshed: 0, refreshFailed: 0,
      stageCounts: { WATCH: 0, EARLY_ALERT: 0, BREAKOUT_CANDIDATE: 0, PERSISTENT_LEADER: 0 },
      admissionDiagnostics: { evaluated: 0, eligible: 0, rejected: 0, reasons: {} },
    }
  })
  const displayPassed = passed.filter((token) => token.tier !== 'D' && token.score >= minScore)

  const watchlist = displayPassed.filter((token) => token.signalClass === 'WATCH').slice(0, 6)
  const alertCandidates = displayPassed.filter((token) => token.signalClass === 'HIGH' || token.signalClass === 'LOW')
  const alerts = alertCandidates.slice(0, config.maxAlertsPerPoll)
  const now = new Date().toISOString()
  await Promise.all(alerts.map(async (alert) => {
    await record({ signal_id: `${alert.chain}:${alert.address}`, symbol: alert.symbol, chain: alert.chain, address: alert.address, first_price_usd: alert.priceUsd > 0 ? alert.priceUsd : null, first_seen_at: now })
    await upsertTrackedSignal(alert)
  }))

  const toDetail = (token: ScoredToken): TokenDetail => ({
    symbol: token.symbol, chain: token.chain, score: token.score,
    reason: `${token.signalClass} — ${token.signals.slice(0, 2).map((signal) => signal.description).join(', ')}`,
  })
  return {
    alerts, watchlist, promotions: candidatePipeline.promotions,
    managedCandidateKeys: candidatePipeline.managedKeys,
    legendUpdate,
    meta: {
      chains, count: alerts.length, high: alerts.filter((token) => token.signalClass === 'HIGH').length,
      low: alerts.filter((token) => token.signalClass === 'LOW').length, watch: watchlist.length, scanned,
      candidates: displayPassed.length, candidatePool: candidatePipeline.poolSize,
      candidateAdded: candidatePipeline.added, candidateRefreshed: candidatePipeline.refreshed,
      candidateRefreshFailed: candidatePipeline.refreshFailed, candidatePromotions: candidatePipeline.promotions.length,
      rugsDropped, chainFailures, maxPairAgeMinutes: config.maxPairAgeMinutes,
    },
    details: { scanned: detailScanned.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), candidates: [...alerts, ...watchlist].map(toDetail), rugs: detailRugs },
  }
}
