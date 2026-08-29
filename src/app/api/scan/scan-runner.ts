import { fetchTokensForChain, estimateAgeMinutes } from '@/lib/fetcher'
import { scoreToken } from '@/lib/scorer'
import { upsertTrackedSignal } from '@/lib/signal-store'
import { rugcheckToken } from '@/lib/rugcheck'
import { record } from '@/lib/outcome-store'
import { classifySignal } from '@/lib/scan-policy'
import type { BotConfig, Chain, ScoredToken } from '@/lib/types'

type TokenDetail = { symbol: string; chain: string; score?: number; reason: string }
export interface ScanResult {
  alerts: ScoredToken[]
  watchlist: ScoredToken[]
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
      const scored = scoreToken(token, config)
      const ageMinutes = estimateAgeMinutes(token)
      const txns = token.txns24h
      const totalTxns = (txns?.buys ?? 0) + (txns?.sells ?? 0)
      const buyPressure = totalTxns > 0 ? ((txns?.buys ?? 0) / totalTxns) * 100 : 0
      const missingSocials = config.requireSocials && !(token.socials?.length)
      const buyPressureTooLow = totalTxns > 0 && buyPressure < config.minBuyPressurePercent
      // The discovery providers do not expose a trustworthy LP-lock field. Fail closed when required.
      const lpLockUnavailable = config.requireLpLocked
      scored.signalClass = missingSocials || buyPressureTooLow || lpLockUnavailable
        ? undefined
        : classifySignal({ score: scored.score, liquidity: token.liquidity, volume24h: token.volume24h, ageMinutes }, config) ?? undefined
      let reason = 'filtered'
      if (missingSocials) reason = 'required socials missing'
      else if (buyPressureTooLow) reason = `buy pressure ${buyPressure.toFixed(1)}% below ${config.minBuyPressurePercent}%`
      else if (lpLockUnavailable) reason = 'LP-lock verification unavailable'
      else if (!Number.isFinite(ageMinutes)) reason = 'age unknown'
      else if (scored.signalClass) reason = `${scored.signalClass} — ${scored.signals.slice(0, 2).map((signal) => signal.description).join(', ')}`
      else if (scored.score < Math.max(0, config.minScoreC - 30)) reason = `score ${scored.score} below watch threshold`
      detailScanned.push({ symbol: token.symbol, chain: token.chain, score: scored.score, reason })
      if (scored.tier !== 'D' && scored.signalClass && scored.score >= minScore) candidates.push(scored)
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const passed: ScoredToken[] = []
  for (const token of candidates) {
    const check = await rugcheckToken(token.address, token.chain)
    token.rugcheck = { checked: check.checked, safe: check.checked && !check.isRug && check.riskLevel === 'safe' }
    if (check.checked && (check.isRug || check.rugged)) {
      rugsDropped++
      detailRugs.push({ symbol: token.symbol, chain: token.chain, score: token.score, reason: check.reasons[0] ?? 'RugCheck flagged' })
    } else passed.push(token)
  }

  const watchlist = passed.filter((token) => token.signalClass === 'WATCH').slice(0, 6)
  const alertCandidates = passed.filter((token) => token.signalClass === 'HIGH' || token.signalClass === 'LOW')
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
    alerts, watchlist,
    meta: {
      chains, count: alerts.length, high: alerts.filter((token) => token.signalClass === 'HIGH').length,
      low: alerts.filter((token) => token.signalClass === 'LOW').length, watch: watchlist.length, scanned,
      candidates: passed.length, rugsDropped, chainFailures, maxPairAgeMinutes: config.maxPairAgeMinutes,
    },
    details: { scanned: detailScanned.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), candidates: [...alerts, ...watchlist].map(toDetail), rugs: detailRugs },
  }
}
