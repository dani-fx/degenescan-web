import type { Snapshot } from './types.js'
import { isIsoDate, isSolanaAddress, sanitizeText } from './validation.js'

const GT = 'https://api.geckoterminal.com/api/v2'
const REQUEST_MS = 12_000

export interface PoolCandidate {
  mint: string
  poolAddress: string
  symbol: string
  name: string
  createdAt: string
  priceUsd: number
  liquidityUsd: number
  volumeH1Usd: number
  h1Buyers: number
  h1Sellers: number
  m15Buyers: number
}

const numberOf = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function parseRugReport(data: any): Pick<Snapshot, 'totalHolders' | 'rugSafe'> {
  const schemaValid = typeof data?.rugged === 'boolean'
    && Object.hasOwn(data, 'mintAuthority') && Object.hasOwn(data, 'freezeAuthority')
    && Array.isArray(data?.risks) && Number.isFinite(Number(data?.totalHolders))
  if (!schemaValid) return { totalHolders: null, rugSafe: null }
  const dangerous = data.risks.some((risk: any) => String(risk?.level).toLowerCase() === 'danger')
  return {
    totalHolders: Math.max(0, numberOf(data.totalHolders)),
    rugSafe: data.rugged !== true && !data.mintAuthority && !data.freezeAuthority && !dangerous,
  }
}

async function getJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'DegeneScan-Experimental/0.1' } })
    if (!response.ok) throw new Error(`${response.status} ${url}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function parsePools(payload: any): PoolCandidate[] {
  const meta = new Map<string, { symbol: string; name: string }>()
  for (const item of Array.isArray(payload?.included) ? payload.included : []) {
    if (item?.type === 'token') meta.set(String(item.id), { symbol: String(item.attributes?.symbol || '???'), name: String(item.attributes?.name || '') })
  }
  const pools: PoolCandidate[] = []
  for (const row of Array.isArray(payload?.data) ? payload.data : []) {
    const attr = row?.attributes
    const relation = String(row?.relationships?.base_token?.data?.id || '')
    const mint = relation.includes('_') ? relation.split('_').slice(1).join('_') : relation
    const poolAddress = String(attr?.address || '')
    const createdAt = String(attr?.pool_created_at || '')
    if (!attr || !isSolanaAddress(mint) || !isSolanaAddress(poolAddress) || !isIsoDate(createdAt)) continue
    const tx1 = attr.transactions?.h1 || {}
    const tx15 = attr.transactions?.m15 || {}
    const token = meta.get(relation)
    pools.push({
      mint, poolAddress, symbol: sanitizeText(token?.symbol || String(attr.name || '???').split('/')[0].trim(), 32),
      name: sanitizeText(token?.name || String(attr.name || ''), 128), createdAt,
      priceUsd: numberOf(attr.base_token_price_usd), liquidityUsd: numberOf(attr.reserve_in_usd),
      volumeH1Usd: numberOf(attr.volume_usd?.h1), h1Buyers: numberOf(tx1.buyers),
      h1Sellers: numberOf(tx1.sellers), m15Buyers: numberOf(tx15.buyers),
    })
  }
  return pools
}

export async function fetchCandidates(maxPools = 40): Promise<PoolCandidate[]> {
  const urls = [
    `${GT}/networks/solana/new_pools?page=1&include=base_token`,
    `${GT}/networks/solana/new_pools?page=2&include=base_token`,
    `${GT}/networks/solana/trending_pools?duration=1h&page=1&include=base_token`,
  ]
  const settled = await Promise.allSettled(urls.map(getJson))
  if (settled.every((result) => result.status === 'rejected')) throw new Error('all discovery sources failed')
  const byPool = new Map<string, PoolCandidate>()
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const pool of parsePools(result.value)) {
      const age = Date.now() - Date.parse(pool.createdAt)
      if (age < 0 || age > 6 * 60 * 60_000) continue
      byPool.set(pool.poolAddress, pool)
    }
  }
  return [...byPool.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, maxPools)
}

export async function enrich(pool: PoolCandidate): Promise<Snapshot> {
  const [rug, trades] = await Promise.allSettled([
    getJson(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(pool.mint)}/report`),
    getJson(`${GT}/networks/solana/pools/${encodeURIComponent(pool.poolAddress)}/trades`),
  ])
  let totalHolders: number | null = null
  let rugSafe: boolean | null = null
  if (rug.status === 'fulfilled') {
    ;({ totalHolders, rugSafe } = parseRugReport(rug.value))
  }
  const tradesById = new Map<string, Snapshot['buyTrades'][number]>()
  if (trades.status === 'fulfilled') {
    for (const trade of Array.isArray(trades.value?.data) ? trades.value.data : []) {
      const attr = trade?.attributes
      if (attr?.kind !== 'buy') continue
      const wallet = String(attr.tx_from_address || '')
      const id = String(attr.tx_hash || '')
      const at = String(attr.block_timestamp || '')
      const priceUsd = numberOf(attr.price_to_in_usd)
      if (isSolanaAddress(wallet) && id.length > 0 && id.length <= 128 && isIsoDate(at)
        && Date.parse(at) <= Date.now() + 60_000 && priceUsd > 0) tradesById.set(id, { id, wallet, at, priceUsd })
    }
  }
  return {
    at: new Date().toISOString(), priceUsd: pool.priceUsd, liquidityUsd: pool.liquidityUsd,
    volumeH1Usd: pool.volumeH1Usd, h1Buyers: pool.h1Buyers, h1Sellers: pool.h1Sellers,
    m15Buyers: pool.m15Buyers, totalHolders, buyTrades: [...tradesById.values()].slice(0, 100), rugSafe,
  }
}
