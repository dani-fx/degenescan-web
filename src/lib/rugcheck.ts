import { fetchWithTimeout } from './storage'

export interface RugCheckResult {
  // If true, the token is mechanically unsafe and should be dropped.
  isRug: boolean
  riskLevel: 'safe' | 'moderate' | 'high' | 'unknown'
  score: number | null
  reasons: string[]
  mintAuthority: string | null
  freezeAuthority: string | null
  rugged: boolean
  checked: boolean
  provider?: 'rugcheck' | 'tokin'
  error?: string
}

const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1'
const TOKIN_BASE = 'https://tokin-api.dedaub.com'
const TOKIN_MAX_TAX_PCT = 20
const SAFETY_TTL_MS = 10 * 60 * 1000
const SAFETY_FAIL_TTL_MS = 60 * 1000

const safetyCache = new Map<string, { result: RugCheckResult; ts: number; fail: boolean }>()

function cacheGet(key: string): RugCheckResult | undefined {
  const hit = safetyCache.get(key)
  if (!hit) return undefined
  const ttl = hit.fail ? SAFETY_FAIL_TTL_MS : SAFETY_TTL_MS
  if (Date.now() - hit.ts > ttl) {
    safetyCache.delete(key)
    return undefined
  }
  return hit.result
}

function cacheSet(key: string, result: RugCheckResult, fail = false): void {
  safetyCache.set(key, { result, ts: Date.now(), fail })
}

const TOKIN_CHAINS: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'binance',
  arbitrum: 'arbitrum',
}

const BURN_ADDRESS = '11111111111111111111111111111111'

function baseResult(checked: boolean, provider?: RugCheckResult['provider']): RugCheckResult {
  return {
    isRug: false,
    riskLevel: 'unknown',
    score: null,
    reasons: [],
    mintAuthority: null,
    freezeAuthority: null,
    rugged: false,
    checked,
    provider,
  }
}

function isNullAuthority(authority: string | null | undefined): boolean {
  if (!authority) return true
  return authority.trim() === '' || authority === BURN_ADDRESS
}

type TokInPool = {
  liquidity?: unknown
  buy_success?: unknown
  sell_success?: unknown
  buy_tax?: unknown
  sell_tax?: unknown
}

type TokInFeatures = Record<string, unknown> & { dex?: TokInPool[] }

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Convert TokIn's tri-state analysis into the strict boolean gate used by simulations. */
export function interpretTokInFeatures(features: TokInFeatures): RugCheckResult {
  const result = baseResult(true, 'tokin')
  const critical: string[] = []
  const unknown: string[] = []

  const criticalFlags: Array<[keyof TokInFeatures, string]> = [
    ['allowance_bypass', 'Allowance checks can be bypassed'],
    ['owner_can_change_balance', 'Owner can change holder balances'],
    ['has_blacklist_or_whitelist', 'Contract can restrict individual wallets'],
    ['tax_can_be_modified', 'Trading tax can be modified'],
    ['pause_status_can_be_modified', 'Trading pause can be changed'],
    ['trading_cap_can_be_modified', 'Maximum transaction size can be changed'],
    ['position_cap_can_be_modified', 'Maximum wallet size can be changed'],
    ['mint_or_burn_function', 'Token supply can be changed'],
    ['timebomb', 'Contract contains time-dependent behavior'],
  ]
  for (const [field, reason] of criticalFlags) {
    if (features[field] === true) critical.push(reason)
  }

  if (features.transfer_success === false) critical.push('Token transfers fail in simulation')
  else if (features.transfer_success !== true) unknown.push('Transfer simulation did not settle')

  if (features.cannot_buy === true) critical.push('Token cannot be bought')
  else if (features.cannot_buy !== false) unknown.push('Buyability could not be confirmed')

  if (features.allowance_bypass !== false && features.allowance_bypass !== true) {
    unknown.push('Allowance-bypass check did not settle')
  }

  const pools = Array.isArray(features.dex) ? features.dex : []
  const dominant = [...pools].sort((a, b) => (finiteNumber(b.liquidity) ?? -1) - (finiteNumber(a.liquidity) ?? -1))[0]
  if (!dominant) {
    unknown.push('TokIn found no supported liquidity pool')
  } else {
    if (dominant.buy_success === false) critical.push('Dominant pool buy simulation failed')
    else if (dominant.buy_success !== true) unknown.push('Dominant pool buy simulation is unavailable')
    if (dominant.sell_success === false) critical.push('Dominant pool sell simulation failed')
    else if (dominant.sell_success !== true) unknown.push('Dominant pool sell simulation is unavailable')

    const buyTax = finiteNumber(dominant.buy_tax)
    const sellTax = finiteNumber(dominant.sell_tax)
    if (buyTax === null) unknown.push('Dominant pool buy tax is unknown')
    else if (buyTax > TOKIN_MAX_TAX_PCT) critical.push(`Buy tax ${buyTax}% exceeds ${TOKIN_MAX_TAX_PCT}%`)
    if (sellTax === null) unknown.push('Dominant pool sell tax is unknown')
    else if (sellTax > TOKIN_MAX_TAX_PCT) critical.push(`Sell tax ${sellTax}% exceeds ${TOKIN_MAX_TAX_PCT}%`)
  }

  result.isRug = critical.length > 0
  if (result.isRug) {
    result.riskLevel = 'high'
    result.reasons = critical
    return result
  }
  if (unknown.length > 0) {
    result.riskLevel = 'unknown'
    result.reasons = unknown
    return result
  }
  result.riskLevel = 'safe'
  result.reasons = ['TokIn buy/sell simulation and contract checks passed']
  return result
}

async function checkTokIn(tokenAddress: string, chain: string, slug: string): Promise<RugCheckResult> {
  const cacheKey = `${chain}:${tokenAddress.toLowerCase()}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const apiKey = process.env.TOKIN_API_KEY?.trim()
  if (!apiKey) {
    const result = baseResult(false, 'tokin')
    result.error = 'TOKIN_API_KEY is not configured'
    result.reasons = [result.error]
    cacheSet(cacheKey, result, true)
    return result
  }

  try {
    const response = await fetchWithTimeout(
      `${TOKIN_BASE}/token/${slug}/${encodeURIComponent(tokenAddress)}`,
      {
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
          'User-Agent': 'DegeneScan/1.0',
        },
      },
      30_000,
    )
    if (!response.ok) {
      const result = baseResult(false, 'tokin')
      result.error = `TokIn HTTP ${response.status}`
      result.reasons = [result.error]
      cacheSet(cacheKey, result, true)
      return result
    }
    const payload = await response.json() as { features?: TokInFeatures | null; error?: unknown }
    if (!payload.features || typeof payload.features !== 'object') {
      const result = baseResult(false, 'tokin')
      result.error = typeof payload.error === 'string' && payload.error ? payload.error : 'TokIn returned no analysis'
      result.reasons = [result.error]
      cacheSet(cacheKey, result, true)
      return result
    }
    const result = interpretTokInFeatures(payload.features)
    cacheSet(cacheKey, result)
    return result
  } catch (error) {
    const result = baseResult(false, 'tokin')
    result.error = (error as Error).message
    result.reasons = [`TokIn error: ${result.error}`]
    cacheSet(cacheKey, result, true)
    return result
  }
}

async function checkSolanaRugCheck(mint: string): Promise<RugCheckResult> {
  const cacheKey = `solana:${mint}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const result = baseResult(true, 'rugcheck')
  try {
    const response = await fetchWithTimeout(`${RUGCHECK_BASE}/tokens/${encodeURIComponent(mint)}/report`)
    if (!response.ok) {
      result.checked = false
      result.reasons.push(`rugcheck_http_${response.status}`)
      result.error = `HTTP ${response.status}`
      cacheSet(cacheKey, result, true)
      return result
    }

    const data = (await response.json()) as Record<string, unknown>
    const mintAuthority = typeof data.mintAuthority === 'string' ? data.mintAuthority : null
    const freezeAuthority = typeof data.freezeAuthority === 'string' ? data.freezeAuthority : null
    const rugged = Boolean(data.rugged)
    const score = typeof data.score === 'number' ? data.score : null

    result.mintAuthority = mintAuthority
    result.freezeAuthority = freezeAuthority
    result.rugged = rugged
    result.score = score

    const reasons: string[] = []
    if (mintAuthority && !isNullAuthority(mintAuthority)) {
      reasons.push('Mint authority NOT revoked - supply can be inflated')
      result.isRug = true
    }
    if (freezeAuthority && !isNullAuthority(freezeAuthority)) {
      reasons.push('Freeze authority active - honeypot risk')
      result.isRug = true
    }
    if (rugged) {
      reasons.push('Flagged as already rugged')
      result.isRug = true
    }

    const reported = Array.isArray(data.risks) ? data.risks : []
    for (const risk of reported) {
      if (!risk || typeof risk !== 'object') continue
      const item = risk as Record<string, unknown>
      const name = String(item.name || item.label || '')
      const level = String(item.level || '').toLowerCase()
      if (name) reasons.push(`[${level || 'risk'}] ${name}`)
      if (level === 'danger') result.isRug = true
    }

    if (result.isRug) result.riskLevel = 'high'
    else if (reasons.length > 0) result.riskLevel = 'moderate'
    else result.riskLevel = 'safe'
    if (reasons.length === 0) reasons.push('No major risk flags from RugCheck')
    result.reasons = reasons
    cacheSet(cacheKey, result)
    return result
  } catch (error) {
    result.checked = false
    result.error = (error as Error).message
    result.reasons.push(`rugcheck_error: ${result.error}`)
    cacheSet(cacheKey, result, true)
    return result
  }
}

export async function rugcheckToken(address: string, chain: string): Promise<RugCheckResult> {
  const normalizedChain = (chain || '').toLowerCase()
  if (normalizedChain === 'solana') return checkSolanaRugCheck(address)
  const tokinSlug = TOKIN_CHAINS[normalizedChain]
  if (tokinSlug) return checkTokIn(address, normalizedChain, tokinSlug)
  const result = baseResult(false)
  result.reasons = [`No safety provider configured for chain ${normalizedChain}`]
  return result
}
