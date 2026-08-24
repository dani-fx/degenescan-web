import type { RawToken } from './types'

export interface PriceResult {
  priceUsd: number
  url: string
}

export async function fetchCurrentPrice(token: RawToken): Promise<PriceResult> {
  const chainSlug = token.chain === 'ethereum' ? 'ethereum' : token.chain
  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(token.address)}`

  const resp = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 30 },
  })

  if (!resp.ok) {
    return { priceUsd: token.priceUsd, url: '' }
  }

  const data = (await resp.json()) as any
  const pairs: any[] = Array.isArray(data.pairs) ? data.pairs : []

  if (!pairs.length) {
    return { priceUsd: token.priceUsd, url: '' }
  }

  // Prefer the pair that matches our chain, otherwise take the first one
  const preferred = pairs.find((p) => String(p.chainId || '').toLowerCase().includes(chainSlug)) || pairs[0]
  const priceUsd = Number(preferred.priceUsd || preferred.price || 0) || token.priceUsd
  const pageUrl = String(preferred.url || '')

  return {
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : token.priceUsd,
    url: pageUrl,
  }
}
