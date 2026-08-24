import type { RawToken, Chain } from './types'
import { WEB_DEFAULT_CONFIG } from './types'
import { fetchGeckoTokens } from './gecko'

// --- Adjustable hard filters (majors / wrapped / stables / mcap cap) ---

export const MAX_MARKET_CAP_USD = 5_000_000

// Uppercased before comparison. Deliberately excludes legit memecoins
// (WIF, POPCAT, FARTCOIN) — only majors, wrapped assets, LSTs and DeFi blue chips.
export const SYMBOL_BLACKLIST = new Set([
  'SOL', 'WSOL', 'ETH', 'WETH', 'BTC', 'WBTC', 'CBXRP', 'CBETH',
  'USDC', 'USDT', 'DAI', 'LINK', 'UNI', 'AAVE', 'ARB', 'OP', 'MATIC',
  'AVAX', 'BNB', 'XRP', 'DOGE', 'LITE', 'BCH', 'TON', 'TRX', 'SUI',
  'APT', 'NEAR', 'ATOM', 'ADA', 'STSOL', 'JUPSOL', 'MSCOL', 'WEETH',
  'EZETH', 'RSRH', 'DEGEN', 'AERO', 'VELO', 'VIRTUAL', 'AI16Z',
])

const STABLE_SUFFIX_RE = /(USD|USD\.)$/i

export function isMajorOrWrapped(token: RawToken): boolean {
  const sym = String(token.symbol || '').toUpperCase()
  if (!sym) return true
  if (SYMBOL_BLACKLIST.has(sym)) return true
  if (STABLE_SUFFIX_RE.test(sym)) return true
  if (token.marketCap > MAX_MARKET_CAP_USD) return true
  return false
}

// --- DexScreener API types (narrow, only fields we touch; fallback only) ---

interface DexToken {
  address: string
  symbol: string
  name: string
  logoURI?: string
}

interface DexPair {
  chainId: string
  baseToken: DexToken
  priceUsd?: string
  priceChange?: { h24?: number }
  volume?: { h24?: number }
  volume24h?: number
  liquidity?: { usd?: number }
  liquidityUsd?: number
  marketCap?: number
  fdv?: number
  pairCreatedAt?: number
  txns?: { h24?: { buys?: number; sells?: number }; buys?: number; sells?: number }
  info?: {
    socials?: Array<{ type?: string; url?: string }>
  }
}

interface DexSearchResponse {
  pairs: DexPair[]
}

// --- Cache (shared 60s TTL for GeckoTerminal + DexScreener responses) ---

const dexCache = new Map<string, { data: unknown | null; ts: number }>()
const CACHE_TTL_MS = 60_000
const ERROR_CACHE_TTL_MS = 10_000

async function cachedFetchJson(url: string): Promise<unknown | null> {
  const hit = dexCache.get(url)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data ?? null

  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!resp.ok) {
      const ttl = resp.status === 429 ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS
      dexCache.set(url, { data: null, ts: Date.now() - (CACHE_TTL_MS - ttl) })
      return null
    }
    const data = await resp.json()
    dexCache.set(url, { data, ts: Date.now() })
    return data
  } catch {
    dexCache.set(url, { data: null, ts: Date.now() - (CACHE_TTL_MS - ERROR_CACHE_TTL_MS) })
    return null
  }
}

async function cachedSearch(q: string): Promise<DexSearchResponse | null> {
  const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(q)}`
  return (await cachedFetchJson(url)) as DexSearchResponse | null
}

async function cachedGecko(chain: Chain): Promise<RawToken[]> {
  const url = `gt:new_pools:${chain}`
  const hit = dexCache.get(url)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return (hit.data as RawToken[]) ?? []

  let data: RawToken[] = []
  try {
    data = await fetchGeckoTokens(chain)
  } catch {
    data = []
  }
  dexCache.set(url, { data, ts: Date.now() })
  return data
}

// --- Retry with exponential backoff + jitter ---

async function withBackoff<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0
  let lastErr: unknown
  while (attempt <= retries) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number })?.status
      if (attempt === retries || (status !== 429 && (typeof status !== 'number' || status < 500))) break
      const base = 1000 * 2 ** attempt
      const jitter = base * (0.5 + Math.random() * 0.5)
      await new Promise((r) => setTimeout(r, Math.min(jitter, 30_000)))
      attempt++
    }
  }
  throw lastErr
}

const MIN_LIQUIDITY = WEB_DEFAULT_CONFIG.minLiquidityUsd
const MIN_VOLUME_24H = WEB_DEFAULT_CONFIG.minVolume24hUsd

function passesMinimums(token: RawToken): boolean {
  if (token.liquidity > 0 && token.liquidity < MIN_LIQUIDITY) return false
  if (token.volume24h > 0 && token.volume24h < MIN_VOLUME_24H) return false
  return true
}

function filterFreshTokens(tokens: RawToken[]): RawToken[] {
  return tokens
    .filter((t) => !isMajorOrWrapped(t))
    .filter(passesMinimums)
    .slice(0, 20)
}

const QUERIES: Record<string, string[]> = {
  solana: ['pump.fun', 'solana new pairs', 'solana meme', 'solana low mc'],
  base: ['base new pairs', 'base token', 'base meme', 'base low cap'],
  ethereum: ['erc20 new', 'ethereum token', 'eth meme', 'eth new pair'],
  bsc: ['bsc new token', 'bsc meme', 'bsc low cap', 'binance new pair'],
  arbitrum: ['arb new token', 'arbitrum token', 'arb meme', 'arb low cap'],
}

function mapDexChain(chain: string): Chain {
  const c = chain.toLowerCase()
  if (c.includes('sol')) return 'solana'
  if (c.includes('base')) return 'base'
  if (c.includes('eth')) return 'ethereum'
  if (c.includes('bsc')) return 'bsc'
  if (c.includes('arb')) return 'arbitrum'
  return 'solana'
}

async function searchPairsForChain(chain: Chain): Promise<RawToken[]> {
  const results: RawToken[] = []
  const seen = new Set<string>()
  const queries = QUERIES[chain] || QUERIES.solana

  for (const q of queries) {
    const data = await withBackoff(() => cachedSearch(q))
    const pairs = data?.pairs ?? []
    for (const pair of pairs) {
      const chainId = String(pair.chainId || '').toLowerCase()
      if (!chainId.includes(chain)) continue
      const key = String(pair.baseToken.address || '').toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      results.push(mapDexScreenerPair(pair))
    }
    if (results.length >= 20) break
    await new Promise((r) => setTimeout(r, 700))
  }

  return filterFreshTokens(results)
}

// Primary discovery: GeckoTerminal new_pools (real fresh pairs).
// Fallback ONLY when GT returns nothing: legacy DexScreener search.
export async function fetchTokensForChain(chain: Chain): Promise<RawToken[]> {
  const geckoTokens = await cachedGecko(chain)
  if (geckoTokens.length > 0) return filterFreshTokens(geckoTokens)
  return searchPairsForChain(chain)
}

function mapDexScreenerPair(pair: DexPair): RawToken {
  const baseToken = pair.baseToken
  const priceUsd = Number(pair.priceUsd || pair.priceChange?.h24 || 0) || 0
  const volume24h = Number(pair.volume?.h24 ?? pair.volume24h ?? 0) || 0
  const liquidity = Number(pair.liquidity?.usd ?? pair.liquidityUsd ?? 0) || 0
  // Real pair age only. Missing/unparseable -> 0 (unknown), never Date.now().
  const createdMs = Number(pair.pairCreatedAt)

  return {
    address: String(baseToken.address || ''),
    symbol: String(baseToken.symbol || '???').toUpperCase(),
    name: String(baseToken.name || ''),
    chain: mapDexChain(String(pair.chainId || 'solana')),
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
    priceChange24h: Number(pair.priceChange?.h24 || 0),
    volume24h: Number.isFinite(volume24h) ? volume24h : 0,
    liquidity: Number.isFinite(liquidity) ? liquidity : 0,
    marketCap: Number(pair.marketCap || pair.fdv || 0) || 0,
    fdv: Number(pair.fdv || 0),
    createdAt:
      Number.isFinite(createdMs) && createdMs > 0 ? new Date(createdMs).toISOString() : '',
    pairCreatedAt: Number.isFinite(createdMs) && createdMs > 0 ? createdMs : 0,
    txns24h: extractTxns(pair.txns),
    socials: extractSocials(pair.info?.socials),
    logoURI: String(baseToken.logoURI || ''),
  }
}

function extractTxns(
  txns?: DexPair['txns']
): { buys: number; sells: number } | undefined {
  if (!txns || typeof txns !== 'object') return undefined
  const tx = txns.h24 ?? txns
  if (!tx || typeof tx !== 'object') return undefined
  const buys = Number(tx.buys ?? 0)
  const sells = Number(tx.sells ?? 0)
  if (!Number.isFinite(buys) && !Number.isFinite(sells)) return undefined
  return { buys: Number.isFinite(buys) ? buys : 0, sells: Number.isFinite(sells) ? sells : 0 }
}

function extractSocials(
  socials?: Array<{ type?: string; url?: string }>
): Array<{ type: string; url: string }> | undefined {
  if (!Array.isArray(socials)) return undefined
  return socials
    .map((s) => ({
      type: String(s.type || ''),
      url: String(s.url || ''),
    }))
    .filter((s) => s.url.length > 0)
}

export function estimateAgeMinutes(token: RawToken): number {
  const fallback = token.pairCreatedAt ? Number(token.pairCreatedAt) : Date.parse(token.createdAt)
  const created = Number.isFinite(fallback) ? fallback : 0
  // Unknown/invalid creation time -> treat as infinitely old so the pair
  // fails any maxPairAgeMinutes filter instead of passing with a faked age.
  if (created <= 0) return Number.MAX_SAFE_INTEGER
  return Math.max(0, Math.floor((Date.now() - created) / (1000 * 60)))
}
