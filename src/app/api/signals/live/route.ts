import { NextRequest, NextResponse } from 'next/server'
import { fetchLiveTokenSnapshot } from '@/lib/live-token'
import type { SignalItem } from '@/lib/store'

/**
 * GET /api/signals/live?addresses=0x...,0x...
 *
 * Returns a fresh DexScreener snapshot for each classic signal currently
 * displayed on the dashboard. The dashboard polls this alongside narrative,
 * graduation, and tracked lanes so price / volume / liquidity / 24h change /
 * buy pressure stay live without re-running a full scan.
 */
export async function GET(request: NextRequest) {
  const addresses = request.nextUrl.searchParams
    .get('addresses')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []

  if (!addresses.length) {
    return NextResponse.json({ live: [] })
  }

  // Build a fallback map from stored signals when available; otherwise use
  // zeros so the UI still renders something while the first fetch warms up.
  const withFallback = addresses.map((addr) => ({
    address: addr,
    chain: 'solana' as const,
    fallback: {
      priceUsd: 0,
      priceChange24h: 0,
      volume24h: 0,
      liquidity: 0,
      marketCap: 0,
      fdv: 0,
      buys24h: 0,
      sells24h: 0,
    },
  }))

  const live = await Promise.all(
    withFallback.map(async ({ address, chain, fallback }) => {
      const snap = await fetchLiveTokenSnapshot(address, chain, fallback)
      const total = snap.buys24h + snap.sells24h
      const buyPressure = total > 0 ? Math.round((snap.buys24h / total) * 100) : 50
      return {
        address,
        chain,
        priceUsd: snap.priceUsd,
        priceChange24h: snap.priceChange24h,
        volume24h: snap.volume24h,
        liquidity: snap.liquidity,
        marketCap: snap.marketCap,
        fdv: snap.fdv,
        buys24h: snap.buys24h,
        sells24h: snap.sells24h,
        buyPressure,
        url: snap.url,
        fetchedAt: new Date().toISOString(),
      }
    })
  )

  return NextResponse.json({ live })
}
