import { NextResponse } from 'next/server'
import { getTrackedSignals } from '@/lib/signal-store'

export async function GET() {
  const tracked = getTrackedSignals()
  const withPrices = await Promise.all(
    tracked.map(async (signal) => {
      try {
        const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(signal.token.address)}`
        const resp = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 0 } })
        if (!resp.ok) return signal
        const data = await resp.json()
        const pair = data?.pairs?.[0]
        if (!pair) return signal
        const priceUsd = Number(pair.priceUsd || pair.price || signal.token.priceUsd || 0) || signal.token.priceUsd
        const updatedToken = { ...signal.token, priceUsd, fetchedAt: new Date().toISOString() }
        return { ...signal, token: updatedToken, lastRefreshedAt: new Date().toISOString() }
      } catch {
        return signal
      }
    })
  )

  return NextResponse.json({ tracked: withPrices })
}
