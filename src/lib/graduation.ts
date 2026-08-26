import type { Chain } from './types'
import type { GraduationSignal } from './types'

// GRADUATION WATCHER — detects pump.fun tokens the moment they graduate to a
// PumpSwap pool (the highest-signal event on Solana: only tokens that pulled
// the full bonding curve ever get here) and alerts when the post-graduation
// crowd is real (buyer velocity), not sniper bundles.
//
// Detection: GT /new_pools filtered to dex=pumpswap. Graduation speed +
// bonding-curve stats come from the public pump.fun v3 API.

const GT_BASE = 'https://api.geckoterminal.com/api/v2'
const PUMPFUN_API = 'https://frontend-api-v3.pump.fun/coins'

export interface GraduationConfig {
  minH1Buyers: number
  minM15Buyers: number
  minLiquidityUsd: number
  maxAgeMinutes: number
  intervalMs: number
  maxAlertsPerCycle: number
}

export const DEFAULT_GRADUATION_CONFIG: GraduationConfig = {
  minH1Buyers: 120,
  minM15Buyers: 25,
  minLiquidityUsd: 9_000,
  maxAgeMinutes: 90,
  intervalMs: 3 * 60 * 1000,
  maxAlertsPerCycle: 3,
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function gtGet(path: string): Promise<any | null> {
  try {
    const resp = await fetch(`${GT_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

async function pumpFunCoin(mint: string): Promise<{
  symbol?: string
  name?: string
  creator?: string
  created_timestamp?: number
  complete?: boolean
  usd_market_cap?: number
  twitter?: string | null
  telegram?: string | null
} | null> {
  try {
    const resp = await fetch(
      `${PUMPFUN_API}/${encodeURIComponent(mint)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DegeneScan/1.0',
        },
      }
    )
    if (!resp.ok) return null
    return (await resp.json()) as any
  } catch {
    return null
  }
}

/** Fetch recent pump.fun→PumpSwap graduations. Solana only.
 *  Returns sorted by h1 buyers (crowd velocity), capped by maxAlertsPerCycle.
 */
export async function fetchGraduations(
  config: GraduationConfig,
  maxBypassCache = 0
): Promise<GraduationSignal[]> {
  const data = await gtGet(
    '/networks/solana/new_pools?page=1&include=base_token,dex'
  )
  if (!data || !Array.isArray(data?.data)) return []

  const tokenMeta = new Map<string, { symbol: string; name: string }>()
  for (const inc of Array.isArray(data.included) ? data.included : []) {
    if (inc?.type !== 'token' || !inc.attributes) continue
    tokenMeta.set(String(inc.id || ''), {
      symbol: String(inc.attributes.symbol || '???').toUpperCase(),
      name: String(inc.attributes.name || ''),
    })
  }

  const graduates: GraduationSignal[] = []

  for (const pool of data.data) {
    const dexId = String(pool?.relationships?.dex?.data?.id || '')
    if (dexId !== 'pumpswap') continue // graduation = PumpSwap pool appears
    const attr = pool?.attributes
    if (!attr) continue

    const baseId = String(pool?.relationships?.base_token?.data?.id || '')
    const mint =
      baseId.includes('_') ? baseId.split('_').slice(1).join('_') : baseId
    if (!mint) continue

    const createdMs = Date.parse(String(attr.pool_created_at || ''))
    if (!Number.isFinite(createdMs)) continue
    const ageMin = (Date.now() - createdMs) / 60000
    if (ageMin > config.maxAgeMinutes) continue

    const txns = attr.transactions || {}
    const t1h = txns.h1 || {}
    const t15m = txns.m15 || {}
    const liquidityUsd = num(attr.reserve_in_usd)

    if (num(t1h.buyers) < config.minH1Buyers) continue
    if (num(t15m.buyers) < config.minM15Buyers) continue
    if (liquidityUsd < config.minLiquidityUsd) continue

    // Enrich from pump.fun: creator + curve speed + socials
    let curveMinutes: number | null = null
    let creator: string | null = null
    let socials = 0
    const coin = await pumpFunCoin(mint)
    if (coin) {
      creator = coin.creator ?? null
      if (coin.created_timestamp && Number.isFinite(coin.created_timestamp)) {
        curveMinutes = Math.max(
          0,
          Math.round((createdMs - coin.created_timestamp) / 60000)
        )
      }
      if (coin.twitter) socials++
      if (coin.telegram) socials++
    }

    const symbol = tokenMeta.get(baseId)?.symbol ?? String(attr.name || '???').toUpperCase()

    graduates.push({
      mint,
      poolAddress: String(attr.address || ''),
      symbol,
      name: tokenMeta.get(baseId)?.name ?? '',
      gradMinutesAgo: Math.round(ageMin),
      h1Buyers: num(t1h.buyers),
      m15Buyers: num(t15m.buyers),
      liquidityUsd,
      volumeH1Usd: num(attr.volume_usd?.h1),
      mcapUsd: num(attr.market_cap_usd) || num(attr.fdv_usd),
      curveMinutes,
      creator,
      socials,
      exploredAt: new Date().toISOString(),
    })
  }

  graduates.sort((a, b) => b.h1Buyers - a.h1Buyers)
  return graduates.slice(0, config.maxAlertsPerCycle)
}

/** Format curve speed label for UI — same as the bot.
 */
export function curveLabel(minutes: number | null): string {
  if (minutes === null) return 'curve time unknown'
  if (minutes <= 10)
    return `⚡ graduated in ${minutes}m — SNIPED HARD`
  if (minutes <= 60) return `fast curve (${minutes}m)`
  return `slow curve (${minutes}m)`
}
