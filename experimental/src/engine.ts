import type { BuyTrade, Snapshot, TokenTrack, WalletStats } from './types.js'

const MAX_SNAPSHOTS = 96

export function qualifyWallet(stats: WalletStats): boolean {
  if (stats.resolved < 3) return false
  const winRate = stats.wins / stats.resolved
  const averageMultiple = stats.sumMultiple / stats.resolved
  return stats.wins >= 2 && winRate >= 0.6 && averageMultiple >= 1.4
}

function organic(s: Snapshot): boolean {
  const volumePerBuyer = s.h1Buyers > 0 ? s.volumeH1Usd / s.h1Buyers : Infinity
  return s.volumeH1Usd >= 250 && s.volumeH1Usd <= 50_000
    && s.h1Buyers >= 8 && s.m15Buyers >= 3
    && s.h1Buyers > s.h1Sellers
    && volumePerBuyer >= 5 && volumePerBuyer <= 500
}

function growth(current: number, baseline: number): number {
  return baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
}

export function advanceTrack(existing: TokenTrack, snapshot: Snapshot, qualifiedWallets = new Set<string>()): TokenTrack {
  if (existing.stage === 'REJECTED' || existing.stage === 'RUNNER') return existing
  const stageAtStart = existing.stage
  const track: TokenTrack = {
    ...existing,
    snapshots: [...existing.snapshots, snapshot].slice(-MAX_SNAPSHOTS),
    stageTimes: { ...existing.stageTimes }, reasons: [...existing.reasons],
    holderSamples: [...(existing.holderSamples ?? [])],
  }
  if (snapshot.rugSafe === false) {
    track.stage = 'REJECTED'
    track.stageTimes.REJECTED = snapshot.at
    track.reasons.push('RugCheck unsafe')
    return track
  }

  if (stageAtStart === 'DISCOVERED') {
    if (organic(snapshot)) {
      track.stage = 'ORGANIC'
      track.stageTimes.ORGANIC = snapshot.at
      track.organicBaseline = { at: snapshot.at, liquidityUsd: snapshot.liquidityUsd }
      if (typeof snapshot.totalHolders === 'number' && snapshot.totalHolders > 0) {
        track.holderBaseline = { at: snapshot.at, totalHolders: snapshot.totalHolders }
        track.holderSamples = [{ at: snapshot.at, totalHolders: snapshot.totalHolders }]
      }
      track.reasons.push(`organic: ${snapshot.h1Buyers} buyers / $${Math.round(snapshot.volumeH1Usd)} h1`)
    }
    return track
  }

  if (typeof snapshot.totalHolders === 'number' && snapshot.totalHolders > 0) {
    const sample = { at: snapshot.at, totalHolders: snapshot.totalHolders }
    if (!track.holderBaseline) track.holderBaseline = sample
    if (!track.holderSamples?.some((entry) => entry.at === sample.at)) {
      track.holderSamples = [...(track.holderSamples ?? []), sample].slice(-3)
    }
  }

  if (stageAtStart === 'ORGANIC' && track.organicBaseline) {
    const pct = growth(snapshot.liquidityUsd, track.organicBaseline.liquidityUsd)
    if (snapshot.liquidityUsd >= 5_000 && snapshot.liquidityUsd - track.organicBaseline.liquidityUsd >= 2_000 && pct >= 20) {
      track.stage = 'LIQUIDITY_GROWING'
      track.stageTimes.LIQUIDITY_GROWING = snapshot.at
      track.reasons.push(`liquidity +${pct.toFixed(1)}%`)
    }
    return track
  }

  if (stageAtStart === 'LIQUIDITY_GROWING' && track.holderBaseline && (track.holderSamples?.length ?? 0) >= 3) {
    const [beforePrevious, previous, current] = track.holderSamples!.slice(-3)
    const previousMinutes = (Date.parse(previous.at) - Date.parse(beforePrevious.at)) / 60_000
    const currentMinutes = (Date.parse(current.at) - Date.parse(previous.at)) / 60_000
    const previousRate = previousMinutes > 0 ? (previous.totalHolders - beforePrevious.totalHolders) / previousMinutes : 0
    const currentRate = currentMinutes > 0 ? (current.totalHolders - previous.totalHolders) / currentMinutes : 0
    const delta = current.totalHolders - track.holderBaseline.totalHolders
    const pct = growth(current.totalHolders, track.holderBaseline.totalHolders)
    const accelerating = previousRate > 0 && currentRate >= previousRate * 1.5
    if (delta >= 15 && pct >= 20 && accelerating) {
      track.stage = 'HOLDERS_ACCELERATING'
      track.stageTimes.HOLDERS_ACCELERATING = snapshot.at
      track.reasons.push(`holders +${delta} (+${pct.toFixed(1)}%)`)
    }
    return track
  }

  if (stageAtStart === 'HOLDERS_ACCELERATING' && snapshot.rugSafe === true) {
    const after = Date.parse(track.stageTimes.HOLDERS_ACCELERATING || '')
    const entrants = snapshot.buyTrades.filter((trade) => Date.parse(trade.at) > after && qualifiedWallets.has(trade.wallet))
    if (entrants.length > 0) {
      track.stage = 'RUNNER'
      track.stageTimes.RUNNER = snapshot.at
      track.reasons.push(`proven wallet entered: ${entrants[0].wallet}`)
    }
  }
  return track
}

export function percentageGrowth(current: number, baseline: number): number { return growth(current, baseline) }

export function unseenTrades(trades: BuyTrade[], seenIds: Iterable<string>): BuyTrade[] {
  const seen = new Set(seenIds)
  return trades.filter((trade) => !seen.has(trade.id))
}
