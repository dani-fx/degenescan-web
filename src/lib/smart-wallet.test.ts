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

  it('rejects malformed upstream data instead of inventing monitor state', () => {
    expect(() => normalizeSmartWalletSnapshot({ enabled: true, status: {}, wallets: 'bad' })).toThrow('malformed')
  })
})
