import { describe, expect, it } from 'vitest'
import { classifySignal, isAutoTradeEligible } from './scan-policy'
import { DEFAULT_CONFIG } from './types'

const config = {
  ...DEFAULT_CONFIG,
  minScoreC: 60,
  minLiquidityUsd: 30_000,
  minVolume24hUsd: 40_000,
  maxPairAgeMinutes: 120,
}

describe('scan policy boundaries', () => {
  it.each([
    ['HIGH', { score: 60, liquidity: 30_000, volume24h: 40_000, ageMinutes: 120 }],
    ['LOW', { score: 45, liquidity: 10_000, volume24h: 10_000, ageMinutes: 180 }],
    ['WATCH', { score: 30, liquidity: 5_000, volume24h: 0, ageMinutes: 180 }],
  ] as const)('classifies the inclusive %s threshold', (expected, input) => {
    expect(classifySignal(input, config)).toBe(expected)
  })

  it.each([
    { score: 59.99, liquidity: 30_000, volume24h: 40_000, ageMinutes: 120 },
    { score: 60, liquidity: 29_999.99, volume24h: 40_000, ageMinutes: 120 },
    { score: 60, liquidity: 30_000, volume24h: 39_999.99, ageMinutes: 120 },
    { score: 60, liquidity: 30_000, volume24h: 40_000, ageMinutes: 120.01 },
  ])('does not classify values just outside HIGH as HIGH', (input) => {
    expect(classifySignal(input, config)).not.toBe('HIGH')
  })

  it('rejects values outside WATCH and non-finite age', () => {
    expect(classifySignal({ score: 29.99, liquidity: 5_000, volume24h: 0, ageMinutes: 180 }, config)).toBeNull()
    expect(classifySignal({ score: 100, liquidity: 100_000, volume24h: 100_000, ageMinutes: Number.NaN }, config)).toBeNull()
  })

  it('distinguishes selected HIGH alerts from executable safe HIGH alerts', () => {
    expect(isAutoTradeEligible({ score: 72, signalClass: 'HIGH', rugcheck: { checked: true, safe: true } }, 72)).toBe(true)
    expect(isAutoTradeEligible({ score: 99, signalClass: 'LOW', rugcheck: { checked: true, safe: true } }, 72)).toBe(false)
    expect(isAutoTradeEligible({ score: 99, signalClass: 'HIGH', rugcheck: { checked: false, safe: true } }, 72)).toBe(false)
    expect(isAutoTradeEligible({ score: 99, signalClass: 'HIGH', rugcheck: { checked: true, safe: false } }, 72)).toBe(false)
    expect(isAutoTradeEligible({ score: 71.99, signalClass: 'HIGH', rugcheck: { checked: true, safe: true } }, 72)).toBe(false)
  })
})
