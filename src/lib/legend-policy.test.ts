import { describe, expect, it } from 'vitest'
import { observeLegend, pruneLegendObservatory, type LegendRecord } from './legend-policy'
import type { ScoredToken } from './types'

const NOW = Date.parse('2026-08-29T18:00:00.000Z')

function token(overrides: Partial<ScoredToken> = {}): ScoredToken {
  return {
    address: 'MintLegend', symbol: 'FIRE', name: 'Fire', chain: 'solana', priceUsd: 1,
    priceChange24h: 25, volume24h: 120_000, liquidity: 60_000, marketCap: 300_000,
    fdv: 300_000, createdAt: new Date(NOW - 10 * 60_000).toISOString(),
    pairCreatedAt: NOW - 10 * 60_000, txns24h: { buys: 140, sells: 60 },
    socials: [{ type: 'twitter', url: 'https://example.com/fire' }], logoURI: '',
    score: 72, tier: 'C', signals: [{ type: 'volume', strength: 'strong', description: 'Volume accelerating', points: 10 }],
    explanation: '', warnings: [], fetchedAt: new Date(NOW).toISOString(),
    signalClass: 'WATCH', rugcheck: { checked: true, safe: true },
    ...overrides,
  }
}

describe('legend policy', () => {
  it('rejects unchecked, unsafe, and non-Solana tokens', () => {
    expect(observeLegend(null, token({ rugcheck: { checked: false, safe: false } }), NOW)).toBeNull()
    expect(observeLegend(null, token({ rugcheck: { checked: true, safe: false } }), NOW)).toBeNull()
    expect(observeLegend(null, token({ chain: 'base' }), NOW)).toBeNull()
  })

  it('rejects non-finite admission values before persistence', () => {
    expect(observeLegend(null, token({ priceUsd: Number.POSITIVE_INFINITY }), NOW)).toBeNull()
    expect(observeLegend(null, token({ liquidity: Number.POSITIVE_INFINITY }), NOW)).toBeNull()
    expect(observeLegend(null, token({ priceUsd: Number.NaN }), NOW)).toBeNull()
  })

  it('advances through evidence-backed stages without changing trade eligibility', () => {
    const first = observeLegend(null, token(), NOW)
    expect(first?.stage).toBe('WATCH')
    expect(first?.snapshots).toHaveLength(1)
    expect(first?.entryQuality).toBe('EARLY')

    const emerging = observeLegend(first!, token({ score: 78, tier: 'B', signalClass: 'LOW', volume24h: 220_000, liquidity: 90_000, txns24h: { buys: 260, sells: 90 }, priceUsd: 1.2 }), NOW + 15 * 60_000)
    expect(emerging?.stage).toBe('EARLY_ALERT')
    expect(emerging?.drivers.some((driver) => driver.includes('demand'))).toBe(true)

    const breakout = observeLegend(emerging!, token({ score: 88, tier: 'A', signalClass: 'HIGH', volume24h: 500_000, liquidity: 180_000, marketCap: 700_000, txns24h: { buys: 600, sells: 160 }, priceUsd: 1.3 }), NOW + 60 * 60_000)
    expect(breakout?.stage).toBe('BREAKOUT_CANDIDATE')
    expect(breakout?.legendScore).toBeGreaterThanOrEqual(75)
    expect(breakout?.risks).toContain('Wallet-distribution analysis pending')
  })

  it('retains an admitted safe token through temporary score deterioration', () => {
    const first = observeLegend(null, token(), NOW)!
    const cooled = observeLegend(first, token({ score: 58, tier: 'D', signalClass: undefined, priceChange24h: -10 }), NOW + 15 * 60_000)
    expect(cooled).not.toBeNull()
    expect(cooled?.stage).toBe('WATCH')
    expect(cooled?.risks).toContain('classic signal score fell below admission threshold')
  })

  it('marks extended entries separately from legend potential', () => {
    const first = observeLegend(null, token(), NOW)!
    const moved = observeLegend(first, token({ priceUsd: 1.5, score: 90, tier: 'A', signalClass: 'HIGH' }), NOW + 15 * 60_000)!
    expect(moved.entryQuality).toBe('EXTENDED')
    expect(moved.legendScore).toBeGreaterThan(0)
  })

  it('uses a bounded horizon instead of extending expiry on every refresh', () => {
    const first = observeLegend(null, token(), NOW)!
    const refreshed = observeLegend(first, token(), NOW + 60 * 60_000)!
    expect(refreshed.expiresAt).toBe(first.expiresAt)
    expect(new Date(first.expiresAt).getTime()).toBe(NOW + 72 * 60 * 60_000)
  })

  it('does not award persistence evidence on the first observation', () => {
    const first = observeLegend(null, token(), NOW)!
    expect(first.snapshots).toHaveLength(1)
    expect(first.drivers).not.toContain('liquidity holding or improving')
    expect(first.drivers).not.toContain('price resilient versus observed high')
    expect(first.dataCompleteness).toBeLessThan(70)
  })

  it('does not count rapid repeated scans as independent persistence evidence', () => {
    const strong = token({ score: 90, tier: 'A', signalClass: 'HIGH' })
    const first = observeLegend(null, token(), NOW)!
    const afterOneMinute = observeLegend(first, strong, NOW + 60_000)!
    const afterTwoMinutes = observeLegend(afterOneMinute, strong, NOW + 2 * 60_000)!
    const afterThreeMinutes = observeLegend(afterTwoMinutes, strong, NOW + 3 * 60_000)!

    expect(afterThreeMinutes.snapshots).toHaveLength(1)
    expect(afterThreeMinutes.stage).toBe('WATCH')

    const afterFourMinutes = observeLegend(afterThreeMinutes, strong, NOW + 4 * 60_000)!
    expect(afterFourMinutes.snapshots).toHaveLength(2)
  })

  it('retains persistent leaders longer while pruning bounded records', () => {
    const base = observeLegend(null, token(), NOW)!
    const expired: LegendRecord = { ...base, expiresAt: new Date(NOW - 1).toISOString() }
    const leader: LegendRecord = {
      ...base,
      key: 'solana:Leader',
      stage: 'PERSISTENT_LEADER',
      legendScore: 90,
      expiresAt: new Date(NOW + 1).toISOString(),
    }
    expect(pruneLegendObservatory([expired, leader], NOW, 1).map((record) => record.key)).toEqual(['solana:Leader'])
  })
})
