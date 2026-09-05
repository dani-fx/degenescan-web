import { describe, expect, it } from 'vitest'
import { normalizeSmartWalletSnapshot } from './smart-wallet'

const wallet = (index: number) => ({
  chain: 'solana',
  walletAddress: `wallet-${index}`,
  score: 70 + index,
  samples: 4,
  runnerHits: 3,
  hitRate: 0.75,
  winRate: 0.6,
  realizedPnlUsd: 1200,
  medianEntryRank: 5,
  funderAddress: null,
  funderName: null,
  reasons: ['3/4 runner hits'],
})

const trade = (index: number) => ({
  chain: 'solana',
  walletAddress: `wallet-${index}`,
  tokenAddress: `token-${index}`,
  tokenSymbol: `RUN${index}`,
  tradedAt: new Date((1000 + index) * 1000).toISOString(),
  volumeUsd: 250,
  alertedAt: null,
})

describe('normalizeSmartWalletSnapshot', () => {
  it('normalizes and caps dashboard rows', () => {
    const snapshot = normalizeSmartWalletSnapshot({
      enabled: true,
      updatedAt: '2026-09-01T20:00:00.000Z',
      status: { analyzedTokens: 8, candidates: 31, qualified: 4, pendingAlerts: 2 },
      wallets: Array.from({ length: 25 }, (_, index) => wallet(index)),
      recentTrades: Array.from({ length: 35 }, (_, index) => trade(index)),
    })

    expect(snapshot.wallets).toHaveLength(20)
    expect(snapshot.recentTrades).toHaveLength(30)
    expect(snapshot.status.qualified).toBe(4)
    expect(snapshot.wallets[0].reasons).toEqual(['3/4 runner hits'])
  })

  it('preserves missing performance, caps candidates, and rejects invalid candidate data', () => {
    const base = { enabled: true, updatedAt: '2026-09-05T00:00:00Z', status: { analyzedTokens: 6, candidates: 225, qualified: 0, pendingAlerts: 0 }, wallets: [], recentTrades: [] }
    const candidate = { chain: 'solana', walletAddress: 'test', score: 20, samples: 1, runnerHits: 0, winRate: null, realizedPnlUsd: null, performanceFetchedAt: null, blockers: ['Samples 1/3', 'PnL / win rate not fetched'] }
    const result = normalizeSmartWalletSnapshot({ ...base, candidates: Array(25).fill(candidate) })
    expect(result.candidates).toHaveLength(20)
    expect(result.candidates![0].realizedPnlUsd).toBeNull()
    expect(result.candidates![0].blockers).toEqual(candidate.blockers)
    expect(normalizeSmartWalletSnapshot(base).candidates).toBeUndefined()
    expect(() => normalizeSmartWalletSnapshot({ ...base, candidates: 'bad' })).toThrow('malformed')
    expect(() => normalizeSmartWalletSnapshot({ ...base, candidates: [{ ...candidate, score: Infinity }] })).toThrow('malformed')
  })

  it('rejects malformed upstream data instead of inventing monitor state', () => {
    expect(() => normalizeSmartWalletSnapshot({ enabled: true, status: {}, wallets: 'bad' })).toThrow('malformed')
  })
})
