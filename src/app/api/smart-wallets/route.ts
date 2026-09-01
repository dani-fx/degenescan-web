import { NextResponse } from 'next/server'
import { normalizeSmartWalletSnapshot } from '@/lib/smart-wallet'

export const dynamic = 'force-dynamic'

export async function GET() {
  const upstreamUrl = process.env.SMART_WALLET_API_URL
  const token = process.env.SMART_WALLET_API_TOKEN
  if (!upstreamUrl || !token) {
    return NextResponse.json({ error: 'Smart-wallet monitor is not configured' }, { status: 503 })
  }

  try {
    const response = await fetch(upstreamUrl, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      console.warn(`[smart-wallet-api] upstream HTTP ${response.status}`)
      return NextResponse.json({ error: 'Smart-wallet monitor is unavailable' }, { status: 502 })
    }
    const snapshot = normalizeSmartWalletSnapshot(await response.json())
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.warn(`[smart-wallet-api] upstream failed: ${error instanceof Error ? error.name : 'unknown'}`)
    return NextResponse.json({ error: 'Smart-wallet monitor is unavailable' }, { status: 502 })
  }
}
