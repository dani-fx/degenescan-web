import { fetchTokensForChain, estimateAgeMinutes } from '@/lib/fetcher'
import { scoreToken } from '@/lib/scorer'
import { upsertTrackedSignal } from '@/lib/signal-store'
import { rugcheckToken } from '@/lib/rugcheck'
import { record } from '@/lib/outcome-store'
import type { BotConfig, Chain, ScoredToken } from '@/lib/types'

// Two-tier gating: HIGH = strict, LOW = loosened discovery tier (tagged).
export const TIERS = {
  high: { minScore: 65, minLiquidityUsd: 30000, minVolume24hUsd: 40000, maxPairAgeMinutes: 240 },
  low: { minScore: 50, minLiquidityUsd: 10000, minVolume24hUsd: 10000, maxPairAgeMinutes: 360 },
}

function classifySignal(score: number, liquidity: number, volume24h: number, ageMinutes: number): 'HIGH' | 'LOW' | 'WATCH' | null {
  const t = TIERS.high
  if (score >= t.minScore && liquidity >= t.minLiquidityUsd && volume24h >= t.minVolume24hUsd && ageMinutes <= t.maxPairAgeMinutes) return 'HIGH'
  const l = TIERS.low
  if (score >= l.minScore && liquidity >= l.minLiquidityUsd && volume24h >= t.minVolume24hUsd && ageMinutes <= t.maxPairAgeMinutes) return 'LOW'
  // WATCH: web-only visibility tier — near-misses worth eyeballing, never alerted.
  if (score >= 35 && liquidity >= 5000 && Number.isFinite(ageMinutes) && ageMinutes <= 360) return 'WATCH'
  return null
}

type TokenDetail = { symbol: string; chain: string; score?: number; reason: string }

interface ScanResult {
  alerts: ScoredToken[]
  meta: Record<string, unknown>
  details?: { scanned: TokenDetail[]; candidates: TokenDetail[]; rugs: TokenDetail[] }
}

async function runScan(chains: Chain[], config: BotConfig, minScore: number): Promise<ScanResult & { details: NonNullable<ScanResult['details']> }> {
  const flat: ScoredToken[] = []
  let scanned = 0
  let rugsDropped = 0
  const detailScanned: TokenDetail[] = []
  const detailCandidates: TokenDetail[] = []

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]
    if (i > 0) await new Promise((r) => setTimeout(r, 1500)) // GeckoTerminal rate limit
    const tokens = await fetchTokensForChain(chain)
    scanned += tokens.length
    const scored = tokens.map((t) => {
      const s = scoreToken(t, config)
      ;(s as any).signalClass = classifySignal(s.score, t.liquidity, t.volume24h, estimateAgeMinutes(t))
      // Per-token verdict for the scan-details view.
      const ageMin = estimateAgeMinutes(t)
      let reason: string
      if ((s as any).signalClass === null) {
        if (!Number.isFinite(ageMin)) reason = `age unknown (${t.symbol})`
        else if (ageMin > config.maxPairAgeMinutes) reason = `too old (${Math.round(ageMin / 60)}h)`
        else if (s.score < TIERS.low.minScore) reason = `score ${s.score} < ${TIERS.low.minScore}`
        else if (t.liquidity < TIERS.low.minLiquidityUsd) reason = `liquidity $${Math.round(t.liquidity)} < $${TIERS.low.minLiquidityUsd}`
        else if (t.volume24h < TIERS.low.minVolume24hUsd) reason = `volume $${Math.round(t.volume24h)} < $${TIERS.low.minVolume24hUsd}`
        else reason = 'filtered'
      } else {
        reason = `${(s as any).signalClass} — ${s.signals.slice(0, 2).map((x) => x.description).join(', ')}`
      }
      detailScanned.push({ symbol: t.symbol, chain: t.chain, score: s.score, reason })
      return s
    })
    const tiered = scored.filter(
      (t) => t.tier !== 'D' && (t as any).signalClass !== null && t.score >= minScore
    )
    tiered.sort((a, b) => b.score - a.score)
    flat.push(...tiered)
  }

  // RugCheck gate: Solana only, hard-drop mechanical rugs / danger risks.
  const passed: ScoredToken[] = []
  const detailRugs: TokenDetail[] = []
  for (const token of flat) {
    if (token.chain === 'solana') {
      const rc = await rugcheckToken(token.address, token.chain)
      if (rc.isRug || rc.rugged) {
        rugsDropped++
        detailRugs.push({ symbol: token.symbol, chain: token.chain, score: token.score, reason: rc.reasons?.[0] ?? 'RugCheck flagged' })
        continue
      }
    }
    passed.push(token)
  }

  // HIGH first, then up to 2 LOW tagged signals.
  const highs = passed.filter((t) => (t as any).signalClass === 'HIGH')
  const lows = passed.filter((t) => (t as any).signalClass === 'LOW').slice(0, 2)
  const watches = passed.filter((t) => (t as any).signalClass === 'WATCH').slice(0, 6)
  highs.sort((a, b) => b.score - a.score)
  lows.sort((a, b) => b.score - a.score)
  watches.sort((a, b) => b.score - a.score)
  for (const w of watches) (w as any).watch = true
  const topAlerts = [...highs.slice(0, config.maxAlertsPerPoll), ...lows, ...watches]

  // Outcome tracking: persist an entry point per alert for later resolution.
  const now = new Date().toISOString()
  await Promise.all(
    topAlerts.map((alert) =>
      record({
        signal_id: alert.address,
        symbol: alert.symbol,
        chain: alert.chain,
        address: alert.address,
        first_price_usd: alert.priceUsd > 0 ? alert.priceUsd : null,
        first_seen_at: now,
      }).catch((err) => console.error('outcome record failed', err))
    )
  )

  for (const alert of topAlerts) upsertTrackedSignal(alert)

  return {
    alerts: topAlerts,
    meta: {
      chains,
      count: topAlerts.length,
      high: highs.length,
      low: Math.min(lows.length, 2),
      watch: Math.min(watches.length, 6),
      scanned,
      candidates: passed.length,
      rugsDropped,
      maxPairAgeMinutes: config.maxPairAgeMinutes,
    },
    details: {
      scanned: detailScanned.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      candidates: [
        ...topAlerts.filter((t) => (t as any).signalClass !== 'WATCH').map((t) => ({
          symbol: t.symbol, chain: t.chain, score: t.score,
          reason: `${(t as any).signalClass} — ${t.signals.slice(0, 2).map((x) => x.description).join(', ')}`,
        })),
        ...watches.map((t) => ({
          symbol: t.symbol, chain: t.chain, score: t.score,
          reason: `WATCH — ${t.signals.slice(0, 2).map((x) => x.description).join(', ')}`,
        })),
      ],
      rugs: detailRugs,
    },
  }
}

export { runScan }
