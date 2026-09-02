import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observeLegend, type LegendRecord } from './legend-policy'
import type { BotConfig, ScoredToken } from './types'

const state = vi.hoisted(() => ({
  records: [] as LegendRecord[],
  liveSnapshot: null as null | Record<string, number>,
  hardDrop: false,
}))
vi.mock('./legend-store', () => ({
  mutateLegendRecords: vi.fn(async (operation: (current: LegendRecord[]) => Promise<{ records: LegendRecord[]; result: unknown }>) => {
    const mutation = await operation(structuredClone(state.records))
    state.records = structuredClone(mutation.records)
    return mutation.result
  }),
}))
vi.mock('./live-token', () => ({ fetchLiveTokenSnapshot: vi.fn(async () => state.liveSnapshot) }))
vi.mock('./evaluate-token', () => ({
  scoreAndClassifyToken: vi.fn((raw: ScoredToken) => ({ token: { ...raw, score: 75, tier: 'B', signalClass: 'LOW', signals: [], explanation: '', warnings: [], fetchedAt: new Date().toISOString() } })),
  applyRugcheck: vi.fn(async (candidate: ScoredToken) => state.hardDrop
    ? { token: { ...candidate, rugcheck: { checked: true, safe: false } }, hardDrop: true, reason: 'unsafe' }
    : { token: { ...candidate, rugcheck: { checked: true, safe: true } }, hardDrop: false, reason: 'safe' }),
}))

import { refreshLegendObservatory } from './legend-service'

const NOW = Date.parse('2026-08-29T19:00:00.000Z')
const config: BotConfig = {
  chains: ['solana'], minLiquidityUsd: 30_000, maxPairAgeMinutes: 240,
  minScoreA: 85, minScoreB: 75, minScoreC: 65, minVolumeSpikeMultiplier: 3,
  minVolume24hUsd: 40_000, minBuyPressurePercent: 55, requireSocials: false,
  requireLpLocked: false, pollIntervalMs: 300_000, maxAlertsPerPoll: 3,
  trackRefreshChangePercent: 5,
}

function token(overrides: Partial<ScoredToken> = {}): ScoredToken {
  return {
    address: 'MintLegendService', symbol: 'LEG', name: 'Legend', chain: 'solana', priceUsd: 1,
    priceChange24h: 10, volume24h: 150_000, liquidity: 70_000, marketCap: 300_000,
    fdv: 300_000, createdAt: new Date(NOW - 10 * 60_000).toISOString(), pairCreatedAt: NOW - 10 * 60_000,
    txns24h: { buys: 120, sells: 40 }, socials: [], logoURI: '', score: 72, tier: 'C',
    signals: [], explanation: '', warnings: [], fetchedAt: new Date(NOW).toISOString(),
    signalClass: 'WATCH', rugcheck: { checked: true, safe: true }, ...overrides,
  }
}

beforeEach(() => {
  state.records = []
  state.liveSnapshot = null
  state.hardDrop = false
})

describe('legend service', () => {
  it('persists safe discoveries and advances them on later scans', async () => {
    const first = await refreshLegendObservatory([token()], config, NOW)
    expect(first.added).toBe(1)
    expect(first.records[0]?.stage).toBe('WATCH')

    const second = await refreshLegendObservatory([token({ score: 80, tier: 'B', volume24h: 260_000, liquidity: 100_000, txns24h: { buys: 260, sells: 80 }, priceUsd: 1.2 })], config, NOW + 15 * 60_000)
    expect(second.refreshed).toBe(1)
    expect(second.records[0]?.stage).toBe('EARLY_ALERT')
    expect(state.records[0]?.snapshots).toHaveLength(2)
  })

  it('admits verified EVM discoveries and rejects unchecked discoveries', async () => {
    const result = await refreshLegendObservatory([
      token({ chain: 'base', address: '0xAbC' }),
      token({ address: 'MintUnchecked', rugcheck: { checked: false, safe: false } }),
    ], config, NOW)
    expect(result.records.map((record) => record.key)).toEqual(['base:0xabc'])
    expect(result.admissionDiagnostics).toEqual({
      evaluated: 2,
      eligible: 1,
      rejected: 1,
      reasons: { rugcheck_unchecked: 1 },
    })
  })

  it('reports only new admission attempts and their exact rejection reasons', async () => {
    state.records = [observeLegend(null, token({ address: 'Known' }), NOW - 5 * 60_000)!]
    const result = await refreshLegendObservatory([
      token({ address: 'Known', score: 40 }),
      token({ address: 'Low', score: 64 }),
      token({ address: 'Dry', liquidity: 0 }),
      token({ address: 'Eligible' }),
    ], config, NOW)

    expect(result.admissionDiagnostics).toEqual({
      evaluated: 3,
      eligible: 1,
      rejected: 2,
      reasons: { score_below_65: 1, invalid_liquidity: 1 },
    })
  })

  it('refreshes the least recently observed records instead of starving low-ranked records', async () => {
    const oldestToken = token({ address: 'Oldest', symbol: 'OLD', score: 65 })
    const oldest = observeLegend(null, oldestToken, NOW - 60 * 60_000)!
    const recent = Array.from({ length: 20 }, (_, index) => {
      const current = token({ address: `Recent${index}`, symbol: `R${index}`, score: 90, tier: 'A', signalClass: 'HIGH' })
      return observeLegend(null, current, NOW - 5 * 60_000)!
    })
    state.records = [...recent, oldest]

    const result = await refreshLegendObservatory(
      [...recent.map((record) => record.token), oldestToken], config, NOW,
    )

    expect(result.records.find((record) => record.key === oldest.key)?.snapshots).toHaveLength(2)
  })

  it('removes a tracked token when a fresh RugCheck hard-drops it', async () => {
    state.records = [observeLegend(null, token(), NOW - 5 * 60_000)!]
    state.liveSnapshot = {
      priceUsd: 1, priceChange24h: -20, volume24h: 100_000, liquidity: 50_000,
      marketCap: 250_000, fdv: 250_000, buys24h: 100, sells24h: 80,
    }
    state.hardDrop = true

    const result = await refreshLegendObservatory([], config, NOW)

    expect(result.records).toEqual([])
    expect(state.records).toEqual([])
  })
})
