import { NextRequest, NextResponse } from 'next/server'
import { getTrackedSignals, upsertTrackedSignal, removeTrackedSignal } from '@/lib/signal-store'
import type { ScoredToken } from '@/lib/types'

export async function GET() {
  const tracked = getTrackedSignals()
  const withPrices = await Promise.all(
    tracked.map(async (signal) => {
      const token = signal.token
      const entryPrice = token.priceUsd
      try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(token.address)}`
        const resp = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 0 } })
        if (!resp.ok) {
          return {
            ...signal,
            token: { ...token, priceUsd: entryPrice, fetchedAt: new Date().toISOString() },
            lastRefreshedAt: new Date().toISOString(),
            priceChange: 0,
            firstPrice: entryPrice,
          }
        }
        const data = await resp.json()
        const pair = data?.pairs?.[0]
        if (!pair) {
          return {
            ...signal,
            token: { ...token, priceUsd: entryPrice, fetchedAt: new Date().toISOString() },
            lastRefreshedAt: new Date().toISOString(),
            priceChange: 0,
            firstPrice: entryPrice,
          }
        }
        const livePrice = Number(pair.priceUsd || pair.price || entryPrice) || entryPrice
        // Refresh volume / liquidity / 24h change / txns too — not just price.
        const liveVolume24h = Number.isFinite(Number(pair.volume?.h24 ?? pair.volume24h))
          ? Number(pair.volume?.h24 ?? pair.volume24h)
          : token.volume24h
        const liveLiquidity = Number.isFinite(Number(pair.liquidity?.usd ?? pair.liquidityUsd))
          ? Number(pair.liquidity?.usd ?? pair.liquidityUsd)
          : token.liquidity
        const livePriceChange24h = Number.isFinite(Number(pair.priceChange?.h24 ?? pair.priceChange))
          ? Number(pair.priceChange?.h24 ?? pair.priceChange)
          : token.priceChange24h
        const liveBuys = Number.isFinite(Number(pair.txns?.h24?.buys ?? pair.txns?.buys))
          ? Number(pair.txns?.h24?.buys ?? pair.txns?.buys)
          : (token.txns24h?.buys ?? 0)
        const liveSells = Number.isFinite(Number(pair.txns?.h24?.sells ?? pair.txns?.sells))
          ? Number(pair.txns?.h24?.sells ?? pair.txns?.sells)
          : (token.txns24h?.sells ?? 0)
        const liveMarketCap = Number.isFinite(Number(pair.marketCap)) ? Number(pair.marketCap) : token.marketCap
        const liveFdv = Number.isFinite(Number(pair.fdv)) ? Number(pair.fdv) : token.fdv
        const updatedToken = {
          ...token,
          priceUsd: livePrice,
          priceChange24h: livePriceChange24h,
          volume24h: liveVolume24h,
          liquidity: liveLiquidity,
          marketCap: liveMarketCap,
          fdv: liveFdv,
          txns24h: { buys: liveBuys, sells: liveSells },
          fetchedAt: new Date().toISOString(),
        }
        const change = entryPrice > 0 ? ((livePrice - entryPrice) / entryPrice) * 100 : 0
        return {
          ...signal,
          token: updatedToken,
          lastRefreshedAt: new Date().toISOString(),
          priceChange: change,
          firstPrice: entryPrice,
        }
      } catch {
        return {
          ...signal,
          token: { ...token, priceUsd: entryPrice, fetchedAt: new Date().toISOString() },
          lastRefreshedAt: new Date().toISOString(),
          priceChange: 0,
          firstPrice: entryPrice,
        }
      }
    })
  )

  return NextResponse.json({ tracked: withPrices })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { address?: string; action?: 'track' | 'untrack' }
    const { address, action } = body

    if (!address) {
      return NextResponse.json({ error: 'address required' }, { status: 400 })
    }

    if (action === 'untrack') {
      const removed = removeTrackedSignal(address)
      return NextResponse.json({ ok: true, removed })
    }

    // Default: upsert as tracked signal — load latest token data first.
    const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(address)}`
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 0 } })
    let tokenData: any = null
    if (resp.ok) {
      const data = await resp.json()
      const pair = data?.pairs?.[0]
      if (pair) {
        tokenData = {
          address: address,
          symbol: pair.baseToken?.symbol ?? address.slice(0, 6),
          name: pair.baseToken?.name ?? '',
          chain: pair.chainId?.toLowerCase() === 'solana' ? 'solana' : pair.chainId?.toLowerCase() ?? 'solana',
          priceUsd: Number(pair.priceUsd) || 0,
          priceChange24h: Number(pair.priceChange) || 0,
          volume24h: Number(pair.liquidity) || 0,
          liquidity: Number(pair.liquidity) || 0,
          marketCap: Number(pair.marketCap) || 0,
          fdv: Number(pair.fdv) || 0,
          createdAt: new Date().toISOString(),
          pairCreatedAt: Number(pair.pairCreatedAt) || Date.now(),
          txns24h: {
            buys: Number(pair.mbp?.buys?.[0]?.failed ?? 0) || 0,
            sells: Number(pair.mbp?.sells?.[0]?.failed ?? 0) || 0,
          },
        }
      }
    }

    if (!tokenData) {
      return NextResponse.json({ error: 'token not found on dexscreener' }, { status: 404 })
    }

    const scored: ScoredToken = {
      ...tokenData,
      score: 0,
      tier: 'D',
      signals: [],
      explanation: 'Manually tracked',
      warnings: [],
      fetchedAt: new Date().toISOString(),
    }

    const saved = upsertTrackedSignal(scored)
    return NextResponse.json({ ok: true, tracked: saved })
  } catch (error) {
    console.error('Track API POST error', error)
    return NextResponse.json({ error: 'Track failed' }, { status: 500 })
  }
}
