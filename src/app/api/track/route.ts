import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTrackedSignals, upsertTrackedSignal, removeTrackedSignal } from '@/lib/signal-store'
import { canonicalIdentity } from '@/lib/token-identity'
import { mapDexPair, type DexPair } from '@/lib/dexscreener'
import { fetchLiveTokenSnapshot } from '@/lib/live-token'
import { fetchWithTimeout } from '@/lib/storage'
import { rateLimit, requireMutationAccess, validationError } from '@/lib/api'

const chainSchema = z.enum(['solana', 'base', 'ethereum', 'bsc', 'arbitrum'])
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('track'), chain: chainSchema, address: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal('untrack'), chain: chainSchema, address: z.string().trim().min(1).max(128) }).strict(),
])
interface DexResponse { pairs?: DexPair[] }

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000); if (limited) return limited
  try {
    const stored = await getTrackedSignals()
    const tracked = await Promise.all(stored.map(async (signal) => {
      try {
        const snapshot = await fetchLiveTokenSnapshot(signal.token.address, signal.token.chain)
        if (!snapshot) return signal
        const updated = await upsertTrackedSignal({
          ...signal.token,
          priceUsd: snapshot.priceUsd,
          priceChange24h: snapshot.priceChange24h,
          volume24h: snapshot.volume24h > 0 ? snapshot.volume24h : signal.token.volume24h,
          liquidity: snapshot.liquidity > 0 ? snapshot.liquidity : signal.token.liquidity,
          marketCap: snapshot.marketCap > 0 ? snapshot.marketCap : signal.token.marketCap,
          fdv: snapshot.fdv > 0 ? snapshot.fdv : signal.token.fdv,
          txns24h: { buys: snapshot.buys24h, sells: snapshot.sells24h },
          fetchedAt: new Date().toISOString(),
        })
        return { ...updated, outcomes: signal.outcomes }
      } catch {
        return signal
      }
    }))
    return NextResponse.json({ tracked })
  }
  catch (error) { console.error('Track read error', error); return NextResponse.json({ error: 'Track read failed' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  const denied = requireMutationAccess(request); if (denied) return denied
  const limited = rateLimit(request, 30, 60_000); if (limited) return limited
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return validationError(parsed.error)
  try {
    const identity = canonicalIdentity(parsed.data.chain, parsed.data.address)
    if (parsed.data.action === 'untrack') {
      const removed = await removeTrackedSignal(identity.chain, identity.address)
      if (!removed) return NextResponse.json({ error: 'Tracked token not found' }, { status: 404 })
      return NextResponse.json({ ok: true, removed: true })
    }
    const response = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(identity.address)}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return NextResponse.json({ error: 'DexScreener lookup failed' }, { status: 502 })
    const data = await response.json() as DexResponse
    const token = data.pairs?.map((pair) => mapDexPair(pair, identity.chain, identity.address)).find(Boolean)
    if (!token) return NextResponse.json({ error: 'Token not found for chain/address' }, { status: 404 })
    return NextResponse.json({ ok: true, tracked: await upsertTrackedSignal(token) }, { status: 201 })
  } catch (error) {
    console.error('Track mutation error', error)
    return NextResponse.json({ error: 'Track failed' }, { status: 500 })
  }
}
