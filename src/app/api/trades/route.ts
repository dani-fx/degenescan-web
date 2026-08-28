import { NextRequest, NextResponse } from 'next/server'
import { refreshAllTradePrices, getAllTrades, computeTradeStats } from '@/lib/trade-store'

export async function GET() {
  const trades = await getAllTrades()
  const stats = computeTradeStats(trades)
  return NextResponse.json({ trades, tradeStats: stats })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { refresh?: boolean }
    if (body.refresh) {
      await refreshAllTradePrices()
    }
    const trades = await getAllTrades()
    const stats = computeTradeStats(trades)
    return NextResponse.json({ trades, tradeStats: stats })
  } catch (error) {
    console.error('Trades API error', error)
    return NextResponse.json({ error: 'Trades failed' }, { status: 500 })
  }
}
