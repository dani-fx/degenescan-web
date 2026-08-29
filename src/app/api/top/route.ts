import { NextResponse } from 'next/server'
import { getTrackedSignals } from '@/lib/signal-store'

export async function GET() {
  const tracked = await getTrackedSignals()
  const top = tracked
    .map((t) => ({
      id: t.id,
      symbol: t.token.symbol,
      chain: t.token.chain,
      score: t.token.score,
      tier: t.token.tier,
      change24h: t.token.priceChange24h,
      priceUsd: t.token.priceUsd,
      trackedAt: t.trackedAt,
      lastRefreshedAt: t.lastRefreshedAt,
      source: 'classic',
    }))
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 5)
  return NextResponse.json({ top })
}
