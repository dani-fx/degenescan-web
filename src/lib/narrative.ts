import type { Chain } from './types'
import { fetchTrendingPools } from './narrative-discovery'
import { fetchHolderDistribution, evaluateDistribution } from './holder-distribution'
import {
  type NarrativeLaneConfig,
  type NarrativeLaneFilters,
} from './narrative-configs'
import type { NarrativeSignal } from './types'

/**
 * Default narrative-lane config — mirrors the bot's narrative-lane.ts thresholds.
 * Score cap is /99 (matches the bot); the web renders it as /99 in the card.
 */
export const DEFAULT_NARRATIVE_CONFIG: NarrativeLaneConfig = {
  minAgeMinutes: 20,
  maxAgeMinutes: 24 * 60,
  minH1Buyers: 250,
  minM15Buyers: 40,
  maxTopHolderPct: 6,
  maxInsiderPct: 8,
  minLiquidityUsd: 8_000,
  minVolumeH1Usd: 30_000,
  intervalMs: 5 * 60 * 1000,
  maxAlertsPerCycle: 3,
}

/** Narrative scoring — buyer velocity dominates, distribution quality modulates.
 *  Same formula as the bot's narrative-lane.ts scoring (score /99).
 */
export function scoreNarrative(pool: {
  h1Buyers: number
  ageMinutes: number
  volumeH1Usd: number
  marketCap: number
}): number {
  let score = 40
  if (pool.h1Buyers >= 1000) score += 25
  else if (pool.h1Buyers >= 500) score += 15
  else score += 8
  if (pool.ageMinutes <= 120) score += 12
  else if (pool.ageMinutes <= 360) score += 6
  const h1VolPerBuyer = pool.h1Buyers > 0 ? pool.volumeH1Usd / pool.h1Buyers : 0
  if (h1VolPerBuyer >= 200) score += 10
  else if (h1VolPerBuyer >= 80) score += 5
  if (pool.marketCap >= 250_000) score += 8
  else if (pool.marketCap >= 60_000) score += 4
  return Math.min(99, score)
}

/** Fetch narrative gems for a single chain. Returns scored + filtered signals.
 *  Solana-only today — the narrative lane is where pump.fun runners live.
 */
export async function fetchNarrativeGems(
  chain: Chain,
  filters: NarrativeLaneFilters,
  maxBypassCache = 0
): Promise<NarrativeSignal[]> {
  const pools = await fetchTrendingPools(chain, 2)
  const out: NarrativeSignal[] = []

  for (const p of pools) {
    // Age window
    if (p.ageMinutes < filters.minAgeMinutes || p.ageMinutes > filters.maxAgeMinutes)
      continue
    // Buyer velocity gates
    if (p.h1Buyers < filters.minH1Buyers) continue
    if (p.m15Buyers < filters.minM15Buyers) continue
    // Liquidity + volume floors
    if (p.liquidityUsd < filters.minLiquidityUsd) continue
    if (p.volumeH1Usd < filters.minVolumeH1Usd) continue

    // Holder distribution gate (Solana only — RugCheck FULL report)
    if (chain === 'solana') {
      const dist = await fetchHolderDistribution(p.baseMint, maxBypassCache > 0)
      const verdict = evaluateDistribution(dist)
      if (!verdict.pass) continue

      // Hard RugCheck gate — skip if flagged as rug
      try {
        const rc = await fetchRugcheckSummary(p.baseMint)
        if (rc.checked && rc.isRug) continue
      } catch {
        // non-blocking — distribution gate already ran
      }
    }

    const h1VolPerBuyer =
      p.h1Buyers > 0 ? p.volumeH1Usd / p.h1Buyers : 0
    const score = scoreNarrative({
      h1Buyers: p.h1Buyers,
      ageMinutes: p.ageMinutes,
      volumeH1Usd: p.volumeH1Usd,
      marketCap: p.marketCap,
    })

    out.push({
      chain: p.chain,
      baseMint: p.baseMint,
      poolAddress: p.poolAddress,
      symbol: p.symbol,
      name: p.name,
      priceUsd: p.priceUsd,
      liquidityUsd: p.liquidityUsd,
      volumeH1Usd: p.volumeH1Usd,
      volumeH24Usd: p.volumeH24Usd,
      marketCap: p.marketCap,
      fdv: p.fdv,
      ageMinutes: p.ageMinutes,
      h1Buyers: p.h1Buyers,
      h1Sellers: p.h1Sellers,
      m15Buyers: p.m15Buyers,
      h1VolPerBuyer,
      score,
      holderReason: chain === 'solana' ? evaluateDistribution(
        await fetchHolderDistribution(p.baseMint, true)
      ).reason : 'n/a (non-SOL chain)',
      exploredAt: new Date().toISOString(),
    })
  }

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, filters.maxAlertsPerCycle)
}

// Lightweight RugCheck summary check (non-blocking gate).
async function fetchRugcheckSummary(mint: string): Promise<{
  checked: boolean
  isRug: boolean
  reasons: string[]
}> {
  const resp = await fetch(
    `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`
  )
  if (!resp.ok) return { checked: false, isRug: false, reasons: [] }
  const data = (await resp.json()) as any
  const risks = Array.isArray(data.risks) ? data.risks : []
  const isRug = risks.some(
    (r: any) =>
      r.level === 'danger' ||
      r.key === 'mintAuthority' ||
      r.key === 'freezeAuthority' ||
      r.key === 'rugged'
  )
  return {
    checked: true,
    isRug,
    reasons: risks
      .filter((r: any) => r.level === 'danger')
      .map((r: any) => String(r.key || r.message || 'danger'))
      .slice(0, 2),
  }
}
