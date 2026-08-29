import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type RawToken, type ScoredToken } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  fetchTokensForChain: vi.fn(),
  record: vi.fn(async () => true),
  upsertTrackedSignal: vi.fn(async () => undefined),
}))

vi.mock('@/lib/fetcher', () => ({
  fetchTokensForChain: mocks.fetchTokensForChain,
  estimateAgeMinutes: () => 10,
}))
vi.mock('@/lib/scorer', () => ({
  scoreToken: (token: RawToken): ScoredToken => ({
    ...token,
    score: token.marketCap,
    tier: 'C',
    signals: [],
    explanation: '',
    warnings: [],
    fetchedAt: '2026-08-29T12:00:00.000Z',
  }),
}))
vi.mock('@/lib/rugcheck', () => ({
  rugcheckToken: vi.fn(async () => ({ checked: true, isRug: false, rugged: false, riskLevel: 'safe', reasons: [] })),
}))
vi.mock('@/lib/outcome-store', () => ({ record: mocks.record }))
vi.mock('@/lib/signal-store', () => ({ upsertTrackedSignal: mocks.upsertTrackedSignal }))

import { runScan } from './scan-runner'

function token(symbol: string, chain: RawToken['chain'], score: number, liquidity: number, volume24h: number): RawToken {
  return {
    address: `${chain}-${symbol}`, symbol, name: symbol, chain,
    priceUsd: 1, priceChange24h: 0, volume24h, liquidity,
    marketCap: score, fdv: 0, createdAt: '2026-08-29T11:50:00.000Z',
    pairCreatedAt: Date.parse('2026-08-29T11:50:00.000Z'), logoURI: '',
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('global scan selection', () => {
  it('sorts candidates globally before applying the alert cap and keeps WATCH non-executable', async () => {
    vi.useFakeTimers()
    mocks.fetchTokensForChain.mockImplementation(async (chain: RawToken['chain']) => chain === 'solana'
      ? [token('HIGH80', chain, 80, 30_000, 40_000), token('WATCH40', chain, 40, 5_000, 0)]
      : [token('HIGH90', chain, 90, 30_000, 40_000), token('LOW55', chain, 55, 10_000, 10_000)])

    const config = { ...DEFAULT_CONFIG, minScoreC: 60, maxAlertsPerPoll: 2 }
    const pending = runScan(['solana', 'base'], config, 0)
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.alerts.map(({ symbol }) => symbol)).toEqual(['HIGH90', 'HIGH80'])
    expect(result.watchlist.map(({ symbol }) => symbol)).toEqual(['WATCH40'])
    expect(result.alerts).not.toContainEqual(expect.objectContaining({ symbol: 'LOW55' }))
    expect(mocks.record).toHaveBeenCalledTimes(2)
    expect(mocks.upsertTrackedSignal).toHaveBeenCalledTimes(2)
  })
})
