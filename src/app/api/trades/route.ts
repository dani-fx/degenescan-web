import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { closeTrade, refreshAllTradePrices, getAllTrades, computeTradeStats } from '@/lib/trade-store'
import { rateLimit, requireMutationAccess, validationError } from '@/lib/api'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close'), signal_id: z.string().trim().min(1).max(256) }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
])

async function snapshot(extra: Record<string, unknown> = {}) {
  const trades = await getAllTrades()
  return NextResponse.json({ trades, tradeStats: computeTradeStats(trades), ...extra })
}

export async function GET() {
  try { return await snapshot() }
  catch (error) { console.error('Trades API read error', error); return NextResponse.json({ error: 'Trades read failed' }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  const denied = requireMutationAccess(request); if (denied) return denied
  const limited = rateLimit(request, 30, 60_000); if (limited) return limited
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return validationError(parsed.error)
  try {
    if (parsed.data.action === 'close') {
      const closed = await closeTrade(parsed.data.signal_id, true)
      if (!closed) return NextResponse.json({ error: 'Open trade not found' }, { status: 404 })
      return snapshot({ closed: true })
    }
    const refresh = await refreshAllTradePrices()
    return snapshot({ refresh })
  } catch (error) {
    console.error('Trades API mutation error', error)
    return NextResponse.json({ error: 'Trades mutation failed' }, { status: 500 })
  }
}
