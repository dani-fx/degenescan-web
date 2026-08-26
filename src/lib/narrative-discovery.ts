import type { Chain } from './types'

// GeckoTerminal pool analytics: unique buyers/sellers per interval.
// This is the anti-wash-trading metric: volume can be faked by churn,
// unique wallet counts cannot (cheaply).

const GT_BASE = 'https://api.geckoterminal.com/api/v2'

const NETWORK_FOR_CHAIN: Record<Chain, string> = {
  solana: 'solana',
  base: 'base',
  ethereum: 'eth',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
}

export interface PoolMetrics {
  poolAddress: string
  h1Buyers: number
  h1Sellers: number
  m15Buyers: number
  m5Buys: number
  liquidityUsd: number
  volumeH1Usd: number
  volumeH24Usd: number
  priceChangeH1: number
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function gtGet(path: string, retries = 2): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${GT_BASE}${path}`, {
        headers: { Accept: 'application/json' },
      })
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        continue
      }
      if (!resp.ok) return null
      return await resp.json()
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  return null
}

/**
 * Fetch trending pools (1h window) — this is where narrative runners surface
 * before they clear classic A/B gates. Returns raw GT pool attributes plus
 * base token address, deduped by base mint.
 */
export interface TrendingPool {
  chain: Chain
  poolAddress: string
  baseMint: string
  symbol: string
  name: string
  priceUsd: number
  liquidityUsd: number
  volumeH24Usd: number
  volumeH1Usd: number
  marketCap: number
  fdv: number
  pairCreatedAtMs: number
  priceChange24h: number
  txns24h: { buys: number; sells: number }
  h1Buyers: number
  h1Sellers: number
  m15Buyers: number
  ageMinutes: number
}

export async function fetchTrendingPools(
  chain: Chain,
  pages = 2
): Promise<TrendingPool[]> {
  const network = NETWORK_FOR_CHAIN[chain] || 'solana'
  const out: TrendingPool[] = []
  const seenMints = new Set<string>()

  for (let page = 1; page <= pages; page++) {
    const data = await gtGet(
      `/networks/${network}/trending_pools?duration=1h&include=base_token,dex&page=${page}`
    )
    if (!data || !Array.isArray(data?.data)) break

    const tokenMeta = new Map<string, { symbol: string; name: string }>()
    for (const inc of Array.isArray(data.included) ? data.included : []) {
      if (inc?.type !== 'token' || !inc.attributes) continue
      tokenMeta.set(String(inc.id || ''), {
        symbol: String(inc.attributes.symbol || '???').toUpperCase(),
        name: String(inc.attributes.name || ''),
      })
    }

    for (const pool of data.data) {
      const attr = pool?.attributes
      if (!attr) continue
      const baseId = String(pool?.relationships?.base_token?.data?.id || '')
      const baseMint =
        baseId.includes('_') ? baseId.split('_').slice(1).join('_') : baseId
      if (!baseMint || seenMints.has(baseMint.toLowerCase())) continue
      seenMints.add(baseMint.toLowerCase())

      const createdMs = Date.parse(String(attr.pool_created_at || '')) || Date.now()
      const txns = attr.transactions || {}
      const t24 = txns.h24 || {}
      const t1h = txns.h1 || {}
      const t15m = txns.m15 || {}
      const meta = tokenMeta.get(baseId)

      out.push({
        chain,
        poolAddress: String(attr.address || ''),
        baseMint,
        symbol:
          meta?.symbol && meta.symbol !== '???'
            ? meta.symbol
            : String(attr.name || '???').toUpperCase(),
        name: meta?.name || String(attr.name || ''),
        priceUsd: num(attr.base_token_price_usd),
        liquidityUsd: num(attr.reserve_in_usd),
        volumeH24Usd: num(attr.volume_usd?.h24),
        volumeH1Usd: num(attr.volume_usd?.h1),
        marketCap: num(attr.market_cap_usd) || num(attr.fdv_usd),
        fdv: num(attr.fdv_usd),
        pairCreatedAtMs: createdMs,
        priceChange24h: num(attr.price_change_percentage?.h24),
        txns24h: { buys: num(t24.buys), sells: num(t24.sells) },
        h1Buyers: num(t1h.buyers),
        h1Sellers: num(t1h.sellers),
        m15Buyers: num(t15m.buyers),
        ageMinutes: Math.max(
          0,
          Math.floor((Date.now() - createdMs) / 60000)
        ),
      })
    }
  }

  return out
}
