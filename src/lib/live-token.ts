import type { Chain } from './types'
import type { DexPair } from './dexscreener'
import { canonicalIdentity } from './token-identity'
import { fetchWithTimeout } from './storage'

export interface LiveSnapshot {
  chain: Chain; address: string; priceUsd: number; priceChange24h: number; volume24h: number
  liquidity: number; marketCap: number; fdv: number; buys24h: number; sells24h: number; url: string
}
interface DexResponse { pairs?: DexPair[] }

export function mergeLiveSnapshot<T extends { chain: Chain; address: string; priceUsd: number }>(item: T, snapshot: LiveSnapshot | null): T {
  if (!snapshot || !(snapshot.priceUsd > 0)) return item
  return {
    ...item,
    ...snapshot,
    volume24h: snapshot.volume24h > 0 ? snapshot.volume24h : ('volume24h' in item ? Number(item.volume24h) : 0),
    liquidity: snapshot.liquidity > 0 ? snapshot.liquidity : ('liquidity' in item ? Number(item.liquidity) : 0),
    marketCap: snapshot.marketCap > 0 ? snapshot.marketCap : ('marketCap' in item ? Number(item.marketCap) : 0),
    fdv: snapshot.fdv > 0 ? snapshot.fdv : ('fdv' in item ? Number(item.fdv) : 0),
  }
}

export async function fetchLiveTokenSnapshot(address: string, chain: Chain): Promise<LiveSnapshot | null> {
  const identity = canonicalIdentity(chain, address)
  const response = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(identity.address)}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  const data = await response.json() as DexResponse
  const matches = (data.pairs ?? []).filter((candidate) => {
    try {
      const candidateIdentity = canonicalIdentity(candidate.chainId ?? '', candidate.baseToken?.address ?? '')
      return candidateIdentity.key === identity.key
    } catch { return false }
  })
  const pair = matches.sort((a, b) => Number(b.liquidity?.usd) - Number(a.liquidity?.usd))[0]
  const priceUsd = Number(pair?.priceUsd)
  if (!pair || !(priceUsd > 0)) return null
  return {
    chain: identity.chain, address: identity.address, priceUsd, priceChange24h: Number(pair.priceChange?.h24) || 0,
    volume24h: Number(pair.volume?.h24) || 0, liquidity: Number(pair.liquidity?.usd) || 0,
    marketCap: Number(pair.marketCap) || 0, fdv: Number(pair.fdv) || 0,
    buys24h: Number(pair.txns?.h24?.buys) || 0, sells24h: Number(pair.txns?.h24?.sells) || 0, url: pair.url ?? '',
  }
}
