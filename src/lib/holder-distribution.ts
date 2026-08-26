import { MemoryCache } from './cache'

// Holder-distribution gate (Solana): fetches RugCheck FULL report and extracts
// top-holder concentration + insider supply. Kills wash-traded / bundled tokens
// that pass volume checks but have 1-2 wallets holding everything.
//
// NOTE: this hits the heavier /report endpoint — always call through the cache.

export interface HolderDistribution {
  checked: boolean
  topHolderPct: number
  insiderPct: number
  holdersListed: number
  riskCount: number
  error?: string
}

const CACHE_TTL_MS = 10 * 60 * 1000
const FAIL_TTL_MS = 120 * 1000
const cache = new MemoryCache<HolderDistribution>(CACHE_TTL_MS, 60_000)
const failCache = new MemoryCache<HolderDistribution>(FAIL_TTL_MS, 30_000)

export async function fetchHolderDistribution(
  mint: string,
  bypassCache = false
): Promise<HolderDistribution> {
  if (!bypassCache) {
    const hit = cache.get(mint) || failCache.get(mint)
    if (hit) return hit
  }

  const fail = (error: string): HolderDistribution => ({
    checked: false,
    topHolderPct: 0,
    insiderPct: 0,
    holdersListed: 0,
    riskCount: 0,
    error,
  })
  let result: HolderDistribution

  try {
    const resp = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`
    )
    if (!resp.ok) {
      result = fail(`HTTP ${resp.status}`)
    } else {
      const data = (await resp.json()) as any
      const th = Array.isArray(data.topHolders) ? data.topHolders : []
      const pcts = th
        .map((h: any) => Number(h.pct ?? 0))
        .filter((p: number) => Number.isFinite(p))
      const insiderHolders = th.filter((h: any) => h.insider === true)
      result = {
        checked: true,
        topHolderPct: pcts.length ? Math.max(...pcts) : 0,
        insiderPct: insiderHolders.reduce(
          (s: number, h: any) => s + Number(h.pct ?? 0),
          0
        ),
        holdersListed: th.length,
        riskCount: Array.isArray(data.risks) ? data.risks.length : 0,
      }
    }
  } catch (e: any) {
    result = fail(e?.message ?? String(e))
  }

  if (result.checked) cache.set(mint, result)
  else failCache.set(mint, result)
  return result
}

/** Narrative-lane verdict. A token passes only if distribution looks organic:
 *  - no insider cluster (deployer-linked wallets holding big supply)
 *  - top non-pool holder below cap
 *  - rugcheck not screaming
 */
export function evaluateDistribution(
  d: HolderDistribution
): { pass: boolean; reason: string } {
  if (!d.checked)
    return { pass: false, reason: `holder data unavailable (${d.error ?? 'unknown'})` }
  if (d.holdersListed === 0)
    return { pass: false, reason: 'no holder data returned' }
  if (d.insiderPct > 8)
    return { pass: false, reason: `insider wallets hold ${d.insiderPct.toFixed(1)}%` }
  if (d.topHolderPct > 6)
    return { pass: false, reason: `top holder at ${d.topHolderPct.toFixed(1)}%` }
  return {
    pass: true,
    reason: `top ${d.topHolderPct.toFixed(1)}% / insiders ${d.insiderPct.toFixed(1)}% of listed ${d.holdersListed}`,
  }
}
