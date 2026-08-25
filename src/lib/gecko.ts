import type { RawToken, Chain } from './types'

const GT_BASE = 'https://api.geckoterminal.com/api/v2'

// GeckoTerminal network ids differ slightly from our internal chain names.
export const NETWORK_FOR_CHAIN: Record<Chain, string> = {
  solana: 'solana',
  base: 'base',
  ethereum: 'eth',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
}

function mapChain(network: string): Chain {
  const n = network.toLowerCase()
  if (n === 'eth' || n.includes('ethereum')) return 'ethereum'
  if (n.includes('sol')) return 'solana'
  if (n.includes('base')) return 'base'
  if (n.includes('bsc')) return 'bsc'
  if (n.includes('arb')) return 'arbitrum'
  return 'solana'
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function fetchGeckoTokens(chain: Chain, limit = 30): Promise<RawToken[]> {
  const network = NETWORK_FOR_CHAIN[chain] || 'solana'
  const url = `${GT_BASE}/networks/${network}/new_pools?page=1&include=base_token,dex&page_size=${limit}`

  let data: any
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } })
      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        continue
      }
      if (!resp.ok) return []
      data = await resp.json()
      break
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  if (!data) return []

  const pools: any[] = Array.isArray(data?.data) ? data.data : []
  if (pools.length === 0) return []

  // Index included tokens by their relationship id ("network_ADDRESS").
  const tokenMeta = new Map<string, { address: string; symbol: string; name: string; logoURI: string }>()
  for (const inc of Array.isArray(data.included) ? data.included : []) {
    if (inc?.type !== 'token' || !inc.attributes) continue
    const a = inc.attributes
    tokenMeta.set(String(inc.id || ''), {
      address: String(a.address || ''),
      symbol: String(a.symbol || '???').toUpperCase(),
      name: String(a.name || ''),
      logoURI: String(a.image_url || ''),
    })
  }

  const out: RawToken[] = []
  const seen = new Set<string>()

  for (const pool of pools) {
    const attr = pool?.attributes
    if (!attr) continue

    const liquidity = num(attr.reserve_in_usd)
    // Skip pools with bad/negative reserve readings.
    if (liquidity <= 0) continue

    const baseRel = pool?.relationships?.base_token?.data
    const baseId = String(baseRel?.id || '')
    // base token address is the part after the first underscore.
    const address = baseId.includes('_') ? baseId.split('_').slice(1).join('_') : baseId
    if (!address || seen.has(address.toLowerCase())) continue

    const meta = tokenMeta.get(baseId) || { address, symbol: '???', name: '', logoURI: '' }
    const sym = meta.symbol && meta.symbol !== '???' ? meta.symbol : String(attr.name || '???').toUpperCase()

    const volume24h = num(attr.volume_usd?.h24)
    const priceUsd = num(attr.base_token_price_usd)
    const marketCap = num(attr.market_cap_usd) || num(attr.fdv_usd)
    const fdv = num(attr.fdv_usd)

    // Real pair age: parse the pool's created_at timestamp. If missing or
    // unparseable we MUST NOT fake it with Date.now() — set 0 so
    // estimateAgeMinutes() treats it as unknown-age and it fails the
    // maxPairAgeMinutes filter.
    const createdAt = String(attr.pool_created_at ?? attr.created_at ?? '')
    const parsedMs = createdAt ? Date.parse(createdAt) : NaN
    const createdMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 0

    const txns = attr.transactions?.h24 || {}
    const buys = num(txns.buys)
    const sells = num(txns.sells)

    seen.add(address.toLowerCase())
    out.push({
      address,
      symbol: sym,
      name: meta.name || String(attr.name || ''),
      chain: mapChain(network),
      priceUsd,
      priceChange24h: num(attr.price_change_percentage?.h24),
      volume24h,
      liquidity,
      marketCap,
      fdv,
      createdAt: createdMs > 0 ? new Date(createdMs).toISOString() : '',
      pairCreatedAt: createdMs > 0 ? createdMs : 0,
      txns24h: { buys, sells },
      socials: undefined,
      logoURI: meta.logoURI,
    })
  }

  return out
}
