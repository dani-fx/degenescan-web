import { NextResponse } from 'next/server'
import { getTrackedSignals } from '@/lib/signal-store'

export async function GET() {
  const tracked = await getTrackedSignals()

  const calls = tracked.map((t) => {
    const outcomes = t.outcomes
    const last = outcomes[outcomes.length - 1]
    return {
      id: t.id,
      symbol: t.token.symbol,
      chain: t.token.chain,
      score: t.token.score,
      tier: t.token.tier,
      priceUsd: t.token.priceUsd,
      trackedAt: t.trackedAt,
      lastRefreshedAt: t.lastRefreshedAt,
      outcomesCount: outcomes.length,
      lastChange: last?.changeFromEntry ?? null,
      lastCheckedAt: last?.checkedAt ?? null,
    }
  })

  return NextResponse.json({ calls })
}
