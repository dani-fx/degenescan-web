import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateRecord } from './candidate-policy'
import type { BotConfig, ScoredToken } from './types'

const state = vi.hoisted(() => ({ pool: [] as CandidateRecord[] }))
vi.mock('./candidate-store', () => ({
  getCandidatePool: vi.fn(async () => structuredClone(state.pool)),
  replaceCandidatePool: vi.fn(async (next: CandidateRecord[]) => { state.pool = structuredClone(next) }),
}))
vi.mock('./live-token', () => ({ fetchLiveTokenSnapshot: vi.fn(async () => null) }))

import { refreshCandidatePipeline } from './candidate-service'

const NOW = Date.parse('2026-08-29T12:00:00.000Z')
const config: BotConfig = {
  chains: ['solana'], minLiquidityUsd: 30_000, maxPairAgeMinutes: 240,
  minScoreA: 85, minScoreB: 75, minScoreC: 65, minVolumeSpikeMultiplier: 3,
  minVolume24hUsd: 40_000, minBuyPressurePercent: 55, requireSocials: false,
  requireLpLocked: false, pollIntervalMs: 300_000, maxAlertsPerPoll: 3,
  trackRefreshChangePercent: 5,
}

function token(score: number): ScoredToken {
  return {
    address: 'MintOne', symbol: 'ONE', name: 'One', chain: 'solana', priceUsd: 1,
    priceChange24h: 5, volume24h: 100_000, liquidity: 40_000, marketCap: 100_000,
    fdv: 100_000, createdAt: new Date(NOW - 30 * 60_000).toISOString(),
    pairCreatedAt: NOW - 30 * 60_000, txns24h: { buys: 70, sells: 30 }, socials: [], logoURI: '',
    score, tier: score >= 85 ? 'A' : 'B', signals: [], explanation: '', warnings: [],
    fetchedAt: new Date(NOW).toISOString(), signalClass: 'HIGH',
    rugcheck: { checked: true, safe: true },
  }
}

beforeEach(() => { state.pool = [] })

describe('candidate pipeline', () => {
  it('persists a near-miss then promotes only after two later qualifying scans', async () => {
    const discovered = await refreshCandidatePipeline([token(75)], config, 85, NOW)
    expect(discovered.added).toBe(1)
    expect(discovered.promotions).toEqual([])
    expect(discovered.managedKeys).toEqual(['solana:MintOne'])
    expect(state.pool[0]?.firstSeenScore).toBe(75)

    const first = await refreshCandidatePipeline([token(87)], config, 85, NOW + 60_000)
    expect(first.promotions).toEqual([])
    expect(state.pool[0]?.consecutiveQualifying).toBe(1)

    const second = await refreshCandidatePipeline([token(89)], config, 85, NOW + 120_000)
    expect(second.promotions.map((entry) => entry.symbol)).toEqual(['ONE'])
    expect(state.pool[0]?.consecutiveQualifying).toBe(2)
    expect(state.pool[0]?.firstSeenPriceUsd).toBe(1)
  })
})
