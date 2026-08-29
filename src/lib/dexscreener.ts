import type { Chain, ScoredToken } from './types'
import { canonicalIdentity } from './token-identity'

export interface DexPair {
  chainId?: string; url?: string; pairCreatedAt?: number; priceUsd?: string
  baseToken?: { address?: string; symbol?: string; name?: string }
  priceChange?: { h24?: number }; volume?: { h24?: number }; liquidity?: { usd?: number }
  marketCap?: number; fdv?: number; txns?: { h24?: { buys?: number; sells?: number } }
}

export function mapDexPair(pair: DexPair, requestedChain: Chain, requestedAddress: string): ScoredToken | null {
  const baseAddress = pair.baseToken?.address?.trim()
  if (!baseAddress) return null
  const requested = canonicalIdentity(requestedChain, requestedAddress)
  let actual: ReturnType<typeof canonicalIdentity>
  try {
    actual = canonicalIdentity(pair.chainId ?? '', baseAddress)
  } catch {
    // DexScreener can return pairs from chains this app does not support for
    // the same token query. Ignore those pairs instead of failing the whole
    // tracking request.
    return null
  }
  if (requested.chain !== actual.chain || requested.address !== actual.address) return null
  return {
    address: actual.address, symbol: pair.baseToken?.symbol ?? actual.address.slice(0, 6), name: pair.baseToken?.name ?? '', chain: actual.chain,
    priceUsd: Number(pair.priceUsd) || 0, priceChange24h: Number(pair.priceChange?.h24) || 0,
    volume24h: Number(pair.volume?.h24) || 0, liquidity: Number(pair.liquidity?.usd) || 0,
    marketCap: Number(pair.marketCap) || 0, fdv: Number(pair.fdv) || 0,
    createdAt: new Date(pair.pairCreatedAt || Date.now()).toISOString(), pairCreatedAt: Number(pair.pairCreatedAt) || Date.now(),
    txns24h: { buys: Number(pair.txns?.h24?.buys) || 0, sells: Number(pair.txns?.h24?.sells) || 0 }, socials: [], logoURI: '',
    score: 0, tier: 'D', signals: [], explanation: 'Manually tracked', warnings: [], fetchedAt: new Date().toISOString(),
  }
}
