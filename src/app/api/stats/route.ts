import { NextRequest, NextResponse } from 'next/server'
import { getTrackedSignals } from '@/lib/signal-store'
import { getPendingOutcomes, updateFields } from '@/lib/outcome-store'

function computeStats(tracked: ReturnType<typeof getTrackedSignals>) {
  const outcomes = tracked.flatMap((t) => t.outcomes)
  if (!outcomes.length) {
    return { winRate: 0, avgGain: 0, avgLoss: 0, best: 0, worst: 0, sampleSize: 0 }
  }

  const changes = outcomes.map((o) => o.changeFromEntry)
  const wins = changes.filter((c) => c > 0)
  const losses = changes.filter((c) => c <= 0)

  const winRate = wins.length / changes.length
  const avgGain = wins.length ? wins.reduce((sum, c) => sum + c, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((sum, c) => sum + c, 0) / losses.length : 0
  const best = Math.max(...changes)
  const worst = Math.min(...changes)

  return { winRate, avgGain, avgLoss, best, worst, sampleSize: changes.length }
}

// ?resolve=1 — re-fetch current prices for open outcomes via DexScreener and
// write price/change columns based on elapsed time since first_seen_at
// (30m / 60m / 120m checkpoints).
async function resolveOutcomes(): Promise<{ resolved: number }> {
  const pending = await getPendingOutcomes()
  let resolved = 0

  for (const row of pending) {
    const firstSeen = Date.parse(row.first_seen_at)
    const ageMin = Number.isFinite(firstSeen) ? (Date.now() - firstSeen) / (1000 * 60) : 0

    let currentPrice = 0
    try {
      const resp = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(row.address)}`,
        { headers: { Accept: 'application/json' } }
      )
      if (resp.ok) {
        const data = (await resp.json()) as any
        const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : []
        const preferred =
          pairs.find((p) => String(p.chainId || '').toLowerCase().includes(row.chain)) || pairs[0]
        currentPrice = Number(preferred?.priceUsd || 0) || 0
      }
    } catch {
      // Leave unresolved on fetch failure; retried next call.
    }
    if (!(currentPrice > 0)) continue

    const entryPrice = row.first_price_usd ?? null
    const fields: Parameters<typeof updateFields>[1] = {}

    const writeCheckpoint = (
      ageMinutes: number,
      priceKey: 'price_at_30m' | 'price_at_60m' | 'price_at_120m',
      changeKey: 'change_30m' | 'change_60m' | 'change_120m'
    ) => {
      if (row[priceKey] != null) return
      fields[priceKey] = currentPrice
      fields[changeKey] =
        entryPrice && entryPrice > 0
          ? Math.round(((currentPrice - entryPrice) / entryPrice) * 10000) / 100
          : null
    }

    if (ageMin >= 30) writeCheckpoint(30, 'price_at_30m', 'change_30m')
    if (ageMin >= 60) writeCheckpoint(60, 'price_at_60m', 'change_60m')
    if (ageMin >= 120) writeCheckpoint(120, 'price_at_120m', 'change_120m')

    if (Object.keys(fields).length > 0) {
      await updateFields(row.id, fields)
      resolved++
    }
  }

  return { resolved }
}

export async function GET(request: NextRequest) {
  try {
    let resolution: { resolved: number } | undefined
    if (request.nextUrl.searchParams.get('resolve') === '1') {
      resolution = await resolveOutcomes()
    }
    const tracked = getTrackedSignals()
    const stats = computeStats(tracked)
    return NextResponse.json({ stats, ...(resolution ? { resolution } : {}) })
  } catch (error) {
    console.error('Stats API error', error)
    return NextResponse.json({ error: 'Stats failed' }, { status: 500 })
  }
}
