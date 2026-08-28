import { NextRequest, NextResponse } from 'next/server'
import { runScan } from './scan-runner'
import { openTrade, getAllTrades, computeTradeStats, refreshAllTradePrices } from '@/lib/trade-store'
import type { Chain, ScoredToken, TierKey } from '@/lib/types'
import { AUTO_TRADE_MIN_SCORE } from '@/lib/types'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      chains?: Chain[] | string
      minLiquidityUsd?: number
      maxPairAgeMinutes?: number
      minScoreA?: number
      minScoreB?: number
      minScoreC?: number
      minScore?: number
      minVolumeSpikeMultiplier?: number
      minVolume24hUsd?: number
      minBuyPressurePercent?: number
      requireSocials?: boolean
      requireLpLocked?: boolean
      maxAlertsPerPoll?: number
      autoTrade?: boolean
    } | null

    const rawChains = body?.chains ?? ['solana', 'base', 'ethereum', 'bsc', 'arbitrum']
    const chains: Chain[] = Array.isArray(rawChains)
      ? rawChains.filter((c): c is Chain => ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'].includes(c))
      : [rawChains].filter(Boolean) as Chain[]

    if (!chains.length) {
      return NextResponse.json({ error: 'No valid chains provided' }, { status: 400 })
    }

    const minScore = typeof body?.minScore === 'number' ? body.minScore : 0
    const autoTrade = body?.autoTrade === true || (typeof body?.autoTrade !== 'boolean' && minScore >= AUTO_TRADE_MIN_SCORE)

    const configOverrides: Record<string, unknown> = {}
    if (typeof body?.minLiquidityUsd === 'number') configOverrides.minLiquidityUsd = body.minLiquidityUsd
    if (typeof body?.maxPairAgeMinutes === 'number') configOverrides.maxPairAgeMinutes = body.maxPairAgeMinutes
    if (typeof body?.minScoreA === 'number') configOverrides.minScoreA = body.minScoreA
    if (typeof body?.minScoreB === 'number') configOverrides.minScoreB = body.minScoreB
    if (typeof body?.minScoreC === 'number') configOverrides.minScoreC = body.minScoreC
    if (typeof body?.minVolumeSpikeMultiplier === 'number') configOverrides.minVolumeSpikeMultiplier = body.minVolumeSpikeMultiplier
    if (typeof body?.minVolume24hUsd === 'number') configOverrides.minVolume24hUsd = body.minVolume24hUsd
    if (typeof body?.minBuyPressurePercent === 'number') configOverrides.minBuyPressurePercent = body.minBuyPressurePercent
    if (typeof body?.requireSocials === 'boolean') configOverrides.requireSocials = body.requireSocials
    if (typeof body?.requireLpLocked === 'boolean') configOverrides.requireLpLocked = body.requireLpLocked
    if (typeof body?.maxAlertsPerPoll === 'number') configOverrides.maxAlertsPerPoll = body.maxAlertsPerPoll

    const WEB_DEFAULTS: Record<string, unknown> = {
      chains,
      minLiquidityUsd: 10000,
      maxPairAgeMinutes: 360,
      minScoreA: 85,
      minScoreB: 75,
      minScoreC: 50,
      minVolumeSpikeMultiplier: 3.0,
      minVolume24hUsd: 10000,
      minBuyPressurePercent: 60,
      requireSocials: false,
      requireLpLocked: false,
      pollIntervalMs: 5 * 60_000,
      maxAlertsPerPoll: 3,
      trackRefreshChangePercent: 5,
    }

    const config = { ...WEB_DEFAULTS, ...configOverrides }

    const result = await runScan(chains, config as any, minScore)
    const autoTraded: string[] = []

    if (autoTrade) {
      for (const alert of result.alerts) {
        if (alert.score >= AUTO_TRADE_MIN_SCORE) {
          const entry: ScoredToken = alert as any
          const tier: TierKey = entry.tier
          const trade = await openTrade(
            entry.address,
            entry.symbol,
            entry.chain,
            entry.address,
            entry.priceUsd,
            entry.score,
            tier
          )
          if (trade) {
            autoTraded.push(trade.symbol)
          }
        }
      }
    }

    const trades = await getAllTrades()
    const stats = computeTradeStats(trades)

    return NextResponse.json({
      ...result,
      autoTraded,
      tradeStats: stats,
    })
  } catch (error) {
    console.error('Scan API error', error)
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const rawChains = search.get('chains') ?? ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'].join(',')
  const chains: Chain[] = rawChains
    .split(',')
    .map((s) => s.trim())
    .filter((c): c is Chain => ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'].includes(c as Chain))

  if (!chains.length) {
    return NextResponse.json({ error: 'No valid chains provided' }, { status: 400 })
  }

  const maxPairAgeMinutes = Number(search.get('maxPairAgeMinutes') ?? 360)
  const maxAlertsPerPoll = Number(search.get('maxAlertsPerPoll') ?? 3)
  const minScore = Number(search.get('minScore') ?? 0)

  const WEB_DEFAULTS: Record<string, unknown> = {
    chains,
    minLiquidityUsd: 10000,
    maxPairAgeMinutes,
    minScoreA: 85,
    minScoreB: 75,
    minScoreC: 50,
    minVolumeSpikeMultiplier: 3.0,
    minVolume24hUsd: 10000,
    minBuyPressurePercent: 60,
    requireSocials: false,
    requireLpLocked: false,
    pollIntervalMs: 5 * 60_000,
    maxAlertsPerPoll,
    trackRefreshChangePercent: 5,
  }

  try {
    const result = await runScan(chains, WEB_DEFAULTS as any, minScore)
    const trades = await getAllTrades()
    const stats = computeTradeStats(trades)
    return NextResponse.json({ ...result, tradeStats: stats })
  } catch (error) {
    console.error('Scan API error', error)
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  }
}
