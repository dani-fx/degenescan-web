import { NextRequest, NextResponse } from 'next/server'
import { computeOutcomeStats, getPendingOutcomes, updateFields } from '@/lib/outcome-store'
import { rateLimit } from '@/lib/api'
import { fetchWithTimeout } from '@/lib/storage'
import { canonicalIdentity } from '@/lib/token-identity'

interface DexPair { chainId?: string; priceUsd?: string; baseToken?: { address?: string } }

// ?resolve=1 — re-fetch current prices for open outcomes via DexScreener and
// write price/change columns based on elapsed time since first_seen_at
// (30m / 60m / 120m checkpoints).
async function resolveOutcomes(): Promise<{ resolved: number }> {
  const pending = (await getPendingOutcomes()).slice(0, 10)
  let resolved = 0

  for (const row of pending) {
    const firstSeen = Date.parse(row.first_seen_at)
    const ageMin = Number.isFinite(firstSeen) ? (Date.now() - firstSeen) / (1000 * 60) : 0

    let currentPrice = 0
    try {
      const resp = await fetchWithTimeout(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(row.address)}`,
        { headers: { Accept: 'application/json' } }
      )
      if (resp.ok) {
        const data = (await resp.json()) as { pairs?: DexPair[] }
        const requested = canonicalIdentity(row.chain, row.address)
        const preferred = data.pairs?.find((pair) => {
          try { return canonicalIdentity(pair.chainId ?? '', pair.baseToken?.address ?? '').key === requested.key }
          catch { return false }
        })
        currentPrice = Number(preferred?.priceUsd || 0) || 0
      }
    } catch {
      // Leave unresolved on fetch failure; retried next call.
    }
    if (!(currentPrice > 0)) continue

    const entryPrice = row.first_price_usd ?? null
    const fields: Parameters<typeof updateFields>[1] = {}

    const writeCheckpoint = (
      priceKey: 'price_at_15m' | 'price_at_30m' | 'price_at_60m' | 'price_at_120m',
      changeKey: 'change_15m' | 'change_30m' | 'change_60m' | 'change_120m'
    ) => {
      if (row[priceKey] != null) return
      fields[priceKey] = currentPrice
      fields[changeKey] =
        entryPrice && entryPrice > 0
          ? Math.round(((currentPrice - entryPrice) / entryPrice) * 10000) / 100
          : null
    }

    // Fill only the window whose capture slot is open (never copy one price across windows).
    const grace = 10 // minutes of slack per checkpoint
    const slots = [
      { min: 15, until: 30 + grace, priceKey: 'price_at_15m' as const, changeKey: 'change_15m' as const },
      { min: 30, until: 60 + grace, priceKey: 'price_at_30m' as const, changeKey: 'change_30m' as const },
      { min: 60, until: 120 + grace, priceKey: 'price_at_60m' as const, changeKey: 'change_60m' as const },
      { min: 120, until: Infinity, priceKey: 'price_at_120m' as const, changeKey: 'change_120m' as const },
    ]
    const slot = [...slots].reverse().find((candidate) => ageMin >= candidate.min && ageMin < candidate.until)
    if (slot) writeCheckpoint(slot.priceKey, slot.changeKey)

    if (Object.keys(fields).length > 0) {
      await updateFields(row.id, fields)
      resolved++
    }
  }

  return { resolved }
}

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 20, 60_000); if (limited) return limited
  try {
    let resolution: { resolved: number } | undefined
    if (request.nextUrl.searchParams.get('resolve') === '1') {
      resolution = await resolveOutcomes()
    }
    const stats = await computeOutcomeStats()
    return NextResponse.json({ stats, ...(resolution ? { resolution } : {}) })
  } catch (error) {
    console.error('Stats API error', error)
    return NextResponse.json({ error: 'Stats failed' }, { status: 500 })
  }
}
