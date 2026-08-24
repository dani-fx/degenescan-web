export interface RugCheckResult {
  // If true, the token is mechanically a rug/honeypot and should be dropped.
  isRug: boolean
  riskLevel: 'safe' | 'moderate' | 'high' | 'unknown'
  score: number | null
  reasons: string[]
  mintAuthority: string | null
  freezeAuthority: string | null
  rugged: boolean
  checked: boolean
  error?: string
}

const RUGCHECK_BASE = 'https://api.rugcheck.xyz/v1'
// Successful scans cached 10 min; failures 60s so a transient 5xx doesn't
// hammer the API on every poll.
const RUGCHECK_TTL_MS = 10 * 60 * 1000
const RUGCHECK_FAIL_TTL_MS = 60 * 1000

const rugcheckCache = new Map<string, { result: RugCheckResult; ts: number; fail: boolean }>()

function cacheGet(mint: string): RugCheckResult | undefined {
  const hit = rugcheckCache.get(mint)
  if (!hit) return undefined
  const ttl = hit.fail ? RUGCHECK_FAIL_TTL_MS : RUGCHECK_TTL_MS
  if (Date.now() - hit.ts > ttl) {
    rugcheckCache.delete(mint)
    return undefined
  }
  return hit.result
}

function cacheSet(mint: string, result: RugCheckResult, fail = false): void {
  rugcheckCache.set(mint, { result, ts: Date.now(), fail })
}

// Solana-only: RugCheck does not support EVM chains.
const SUPPORTED_CHAINS = new Set(['solana'])

const BURN_ADDRESS = '11111111111111111111111111111111'

function isNullAuthority(a: string | null | undefined): boolean {
  if (!a) return true
  return a.trim() === '' || a === BURN_ADDRESS
}

export async function rugcheckToken(mint: string, chain: string): Promise<RugCheckResult> {
  const lowerChain = (chain || '').toLowerCase()
  const base = (checked: boolean): RugCheckResult => ({
    isRug: false,
    riskLevel: 'unknown',
    score: null,
    reasons: [],
    mintAuthority: null,
    freezeAuthority: null,
    rugged: false,
    checked,
  })

  // Unsupported chain: return an unchecked, non-rug result so EVM tokens
  // still pass (they're screened by other filters, just not RugCheck).
  if (!SUPPORTED_CHAINS.has(lowerChain)) {
    return { ...base(false), reasons: [`rugcheck not supported for chain ${lowerChain}`] }
  }

  const cached = cacheGet(mint)
  if (cached) return cached

  const result = base(true)
  try {
    const resp = await fetch(`${RUGCHECK_BASE}/tokens/${encodeURIComponent(mint)}/report`)
    if (!resp.ok) {
      result.reasons.push(`rugcheck_http_${resp.status}`)
      result.error = `HTTP ${resp.status}`
      cacheSet(mint, result, true)
      return result
    }

    const data = (await resp.json()) as any
    const mintAuthority = data.mintAuthority ?? null
    const freezeAuthority = data.freezeAuthority ?? null
    const rugged = Boolean(data.rugged)
    const score = typeof data.score === 'number' ? data.score : null

    result.mintAuthority = mintAuthority
    result.freezeAuthority = freezeAuthority
    result.rugged = rugged
    result.score = score

    const reasons: string[] = []

    // --- Mechanical disqualifiers ---
    if (mintAuthority && !isNullAuthority(mintAuthority)) {
      reasons.push('Mint authority NOT revoked — supply can be inflated')
      result.isRug = true
    }
    if (freezeAuthority && !isNullAuthority(freezeAuthority)) {
      reasons.push('Freeze authority active — honeypot risk')
      result.isRug = true
    }
    if (rugged) {
      reasons.push('Flagged as already rugged')
      result.isRug = true
    }

    // --- Surface any engine-reported risks; danger level is a hard drop ---
    const reported = Array.isArray(data.risks) ? data.risks : []
    for (const r of reported) {
      const name = r?.name || r?.label || ''
      const level = String(r?.level || '').toLowerCase()
      if (name) reasons.push(`[${level || 'risk'}] ${name}`)
      if (level === 'danger') result.isRug = true
    }

    if (result.isRug) result.riskLevel = 'high'
    else if (reasons.length > 0) result.riskLevel = 'moderate'
    else result.riskLevel = 'safe'

    if (reasons.length === 0) reasons.push('No major risk flags from RugCheck')
    result.reasons = reasons
  } catch (e: any) {
    result.error = e?.message ?? String(e)
    result.reasons.push(`rugcheck_error: ${result.error}`)
    cacheSet(mint, result, true)
    return result
  }

  cacheSet(mint, result)
  return result
}
