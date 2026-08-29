import { describe, expect, it } from 'vitest'
import {
  advanceCandidate,
  createCandidate,
  isShadowTrackable,
  pruneCandidatePool,
  selectSimulatedTradeEntries,
} from './candidate-policy'
import type { ScoredToken } from './types'

const NOW = Date.parse('2026-08-29T12:00:00.000Z')

function token(overrides: Partial<ScoredToken> = {}): ScoredToken {
  return {
    address: 'MintOne', symbol: 'ONE', name: 'One', chain: 'solana',
    priceUsd: 1, priceChange24h: 5, volume24h: 40_000, liquidity: 30_000,
    marketCap: 100_000, fdv: 100_000, createdAt: new Date(NOW - 30 * 60_000).toISOString(),
    pairCreatedAt: NOW - 30 * 60_000, txns24h: { buys: 70, sells: 30 }, socials: [], logoURI: '',
    score: 75, tier: 'B', signals: [], explanation: '', warnings: [],
    fetchedAt: new Date(NOW).toISOString(), signalClass: 'HIGH', rugcheck: { checked: true, safe: true },
    ...overrides,
  }
}

describe('candidate promotion policy', () => {
  it('tracks only safe near-misses', () => {
    expect(isShadowTrackable(token(), 85)).toBe(true)
    expect(isShadowTrackable(token({ score: 90, tier: 'A' }), 85)).toBe(false)
    expect(isShadowTrackable(token({ rugcheck: { checked: true, safe: false } }), 85)).toBe(false)
    expect(isShadowTrackable(token({ rugcheck: { checked: false, safe: false } }), 85)).toBe(false)
  })

  it('requires two consecutive qualifying refreshes before promotion', () => {
    const candidate = createCandidate(token(), NOW)
    const first = advanceCandidate(candidate, token({ score: 87, tier: 'A' }), NOW + 60_000)
    expect(first.ready).toBe(false)
    expect(first.record?.consecutiveQualifying).toBe(1)

    const second = advanceCandidate(first.record!, token({ score: 89, tier: 'A' }), NOW + 120_000)
    expect(second.ready).toBe(true)
    expect(second.record?.consecutiveQualifying).toBe(2)
  })

  it('resets confirmation and blocks entries that chase more than 35 percent', () => {
    const candidate = createCandidate(token(), NOW)
    const first = advanceCandidate(candidate, token({ score: 87, tier: 'A' }), NOW + 60_000)
    const droppedBack = advanceCandidate(first.record!, token({ score: 80, tier: 'B' }), NOW + 120_000)
    expect(droppedBack.record?.consecutiveQualifying).toBe(0)

    const chased = advanceCandidate(droppedBack.record!, token({ score: 90, tier: 'A', priceUsd: 1.36 }), NOW + 180_000)
    expect(chased.ready).toBe(false)
    expect(chased.record?.consecutiveQualifying).toBe(0)
    expect(chased.record?.lastReason).toContain('anti-chase')
  })

  it('drops unsafe candidates and prunes expired/overflow records', () => {
    const candidate = createCandidate(token(), NOW)
    expect(advanceCandidate(candidate, token({ rugcheck: { checked: true, safe: false } }), NOW + 60_000).record).toBeNull()

    const records = Array.from({ length: 4 }, (_, index) => ({
      ...createCandidate(token({ address: `Mint${index}`, score: 65 + index }), NOW + index),
      expiresAt: new Date(index === 0 ? NOW - 1 : NOW + 60_000).toISOString(),
    }))
    const kept = pruneCandidatePool(records, NOW, 2)
    expect(kept).toHaveLength(2)
    expect(kept.map((record) => record.token.address)).toEqual(['Mint3', 'Mint2'])
  })

  it('blocks managed candidates from direct auto-trading until promoted', () => {
    const managedAlert = token({ score: 90, tier: 'A' })
    const key = `solana:${managedAlert.address}`
    expect(selectSimulatedTradeEntries([], [managedAlert], [key], true)).toEqual([])
    expect(selectSimulatedTradeEntries([managedAlert], [managedAlert], [key], false)).toEqual([managedAlert])

    const immediate = token({ address: 'MintImmediate', score: 90, tier: 'A' })
    expect(selectSimulatedTradeEntries([], [immediate], [key], true)).toEqual([immediate])
  })
})
