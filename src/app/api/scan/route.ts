import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runScan } from './scan-runner'
import { openTrade, getAllTrades, computeTradeStats } from '@/lib/trade-store'
import { getConfig, getLatestResults, setLatestResults } from '@/lib/signal-store'
import { isAutoTradeEligible } from '@/lib/scan-policy'
import { getCandidatePool, removeCandidate } from '@/lib/candidate-store'
import { canonicalIdentity } from '@/lib/token-identity'
import { selectSimulatedTradeEntries } from '@/lib/candidate-policy'
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
    const promotionKeys = new Set(result.promotions.map((entry) => canonicalIdentity(entry.chain, entry.address).key))
    const candidateRecords = result.promotions.length ? await getCandidatePool() : []
    const candidatesByKey = new Map(candidateRecords.map((record) => [record.key, record]))
    const tradeEntries = selectSimulatedTradeEntries(result.promotions, result.alerts, result.managedCandidateKeys, autoTrade)
    for (const entry of tradeEntries) {
      const key = canonicalIdentity(entry.chain, entry.address).key
      if (!isAutoTradeEligible(entry, AUTO_TRADE_MIN_SCORE)) continue
      const candidate = candidatesByKey.get(key)
      const trade = await openTrade(
        `${entry.chain}:${entry.address}:${Date.now()}`,
        entry.symbol,
        entry.chain,
        entry.address,
        entry.priceUsd,
        entry.score,
        entry.tier,
        candidate?.firstSeenPriceUsd,
        candidate?.firstSeenAt,
      )
      if (trade) {
        autoTraded.push(trade.symbol)
        if (promotionKeys.has(key)) await removeCandidate(key)
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
    const candidates = await getCandidatePool()
    return NextResponse.json({ alerts, count: alerts.length, candidates, candidateCount: candidates.length })
  } catch (error) {
    console.error('Scan read error', error)
    return NextResponse.json({ error: 'Scan read failed' }, { status: 500 })
  }
}
