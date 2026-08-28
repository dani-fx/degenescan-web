import type { Chain } from './types'

/**
 * Fetch a live DexScreener snapshot for one token address.
 * Returns the fields the UI cares about for live refresh: price, 24h change,
 * volume, liquidity, market cap, FDV, and txn counts. Falls back to the
 * values passed in (the snapshot the signal was scored with) when the API is
 * unavailable or the pair has vanished.
 */
export async function fetchLiveTokenSnapshot(
  address: string,
  chain: Chain,
  fallback: {
    priceUsd: number
    priceChange24h: number
    volume24h: number
    liquidity: number
    marketCap: number
    fdv: number
    buys24h: number
    sells24h: number
  }
): Promise<{
  priceUsd: number
  priceChange24h: number
  volume24h: number
  liquidity: number
  marketCap: number
  fdv: number
  buys24h: number
  sells24h: number
  url: string
}> {
  const resp = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!resp.ok) {
    return { ...fallback, url: '' }
  }
  const data = (await resp.json()) as any
  const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : []
  if (!pairs.length) {
    return { ...fallback, url: '' }
  }
  const chainSlug = chain === 'ethereum' ? 'ethereum' : chain
  const preferred =
    pairs.find((p) =>
      String(p.chainId || '').toLowerCase().includes(chainSlug.toLowerCase())
    ) || pairs[0]
  const priceUsd = Number(preferred?.priceUsd || preferred?.price || fallback.priceUsd) || fallback.priceUsd
  const priceChange24h =
    Number.isFinite(Number(preferred?.priceChange?.h24))
      ? Number(preferred.priceChange.h24)
      : Number.isFinite(Number(preferred?.priceChange))
      ? Number(preferred.priceChange)
      : fallback.priceChange24h
  const volume24h =
    Number.isFinite(Number(preferred?.volume?.h24))
      ? Number(preferred.volume.h24)
      : Number.isFinite(Number(preferred?.volume24h))
      ? Number(preferred.volume24h)
      : fallback.volume24h
  const liquidity =
    Number.isFinite(Number(preferred?.liquidity?.usd))
      ? Number(preferred.liquidity.usd)
      : Number.isFinite(Number(preferred?.liquidityUsd))
      ? Number(preferred.liquidityUsd)
      : fallback.liquidity
  const marketCap =
    Number.isFinite(Number(preferred?.marketCap))
      ? Number(preferred.marketCap)
      : fallback.marketCap
  const fdv =
    Number.isFinite(Number(preferred?.fdv))
      ? Number(preferred.fdv)
      : fallback.fdv
  const buys24h = Number.isFinite(Number(preferred?.txns?.h24?.buys))
    ? Number(preferred.txns.h24.buys)
    : Number.isFinite(Number(preferred?.txns?.buys))
    ? Number(preferred.txns.buys)
    : fallback.buys24h
  const sells24h = Number.isFinite(Number(preferred?.txns?.h24?.sells))
    ? Number(preferred.txns.h24.sells)
    : Number.isFinite(Number(preferred?.txns?.sells))
    ? Number(preferred.txns.sells)
    : fallback.sells24h
  const url = String(preferred?.url || '')
  return { priceUsd, priceChange24h, volume24h, liquidity, marketCap, fdv, buys24h, sells24h, url }
}
