import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runScan } from './scan-runner'
import { openTrade, getAllTrades, computeTradeStats } from '@/lib/trade-store'
import { getConfig, getLatestResults, setLatestResults } from '@/lib/signal-store'
import { isAutoTradeEligible } from '@/lib/scan-policy'
import { rateLimit, requireMutationAccess, validationError } from '@/lib/api'
import type { Chain } from '@/lib/types'
import { AUTO_TRADE_MIN_SCORE } from '@/lib/types'

const chain = z.enum(['solana', 'base', 'ethereum', 'bsc', 'arbitrum'])
const scanSchema = z.object({
  chains: z.array(chain).min(1).max(5).optional(), minScore: z.number().int().min(0).max(100).optional(),
  minLiquidityUsd: z.number().min(0).max(100_000_000).optional(), maxPairAgeMinutes: z.number().int().min(1).max(10_080).optional(),
  minScoreA: z.number().int().min(0).max(100).optional(), minScoreB: z.number().int().min(0).max(100).optional(), minScoreC: z.number().int().min(0).max(100).optional(),
  minVolumeSpikeMultiplier: z.number().min(0).max(100).optional(), minVolume24hUsd: z.number().min(0).max(1_000_000_000).optional(),
  minBuyPressurePercent: z.number().min(0).max(100).optional(), requireSocials: z.boolean().optional(), requireLpLocked: z.boolean().optional(),
  maxAlertsPerPoll: z.number().int().min(1).max(20).optional(), autoTrade: z.boolean().optional(),
}).strict()

let scanInFlight = false

export async function POST(request: NextRequest) {
  const denied = requireMutationAccess(request); if (denied) return denied
  const limited = rateLimit(request, 10, 60_000); if (limited) return limited
  const parsed = scanSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return validationError(parsed.error)
  if (scanInFlight) return NextResponse.json({ error: 'A scan is already running' }, { status: 409 })
  scanInFlight = true
  try {
    const savedConfig = await getConfig()
    const { autoTrade = false, minScore = 0, chains = savedConfig.chains, ...overrides } = parsed.data
    const config = { ...savedConfig, ...overrides, chains: chains as Chain[] }
    const result = await runScan(config.chains, config, minScore)
    const displaySignals = [...result.alerts, ...result.watchlist]
    await setLatestResults(displaySignals)
    const autoTraded: string[] = []
    if (autoTrade) {
      for (const entry of result.alerts) {
        if (!isAutoTradeEligible(entry, AUTO_TRADE_MIN_SCORE)) continue
        const trade = await openTrade(`${entry.chain}:${entry.address}:${Date.now()}`, entry.symbol, entry.chain, entry.address, entry.priceUsd, entry.score, entry.tier)
        if (trade) autoTraded.push(trade.symbol)
      }
    }
    const trades = await getAllTrades()
    return NextResponse.json({ ...result, alerts: displaySignals, autoTraded, tradeStats: computeTradeStats(trades) })
  } catch (error) {
    console.error('Scan API error', error)
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  } finally {
    scanInFlight = false
  }
}

export async function GET() {
  try {
    const alerts = await getLatestResults()
    return NextResponse.json({ alerts, count: alerts.length })
  } catch (error) {
    console.error('Scan read error', error)
    return NextResponse.json({ error: 'Scan read failed' }, { status: 500 })
  }
}
