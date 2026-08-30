import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RawToken } from './types'

const mocks = vi.hoisted(() => ({
  fetchGeckoTokens: vi.fn(),
}))

vi.mock('./gecko', () => ({
  fetchGeckoTokens: mocks.fetchGeckoTokens,
}))

import { fetchTokensForChain } from './fetcher'

function token(overrides: Partial<RawToken> = {}): RawToken {
  return {
    address: 'fresh-token',
    symbol: 'FRESH',
    name: 'Fresh Token',
    chain: 'solana',
    priceUsd: 0.001,
    priceChange24h: 0,
    volume24h: 2_000,
    liquidity: 8_000,
    marketCap: 100_000,
    fdv: 100_000,
    createdAt: '2026-08-30T16:00:00.000Z',
    pairCreatedAt: Date.parse('2026-08-30T16:00:00.000Z'),
    txns24h: { buys: 10, sells: 5 },
    socials: [],
    logoURI: '',
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('discovery fetcher', () => {
  it('keeps fresh low-liquidity pools for downstream scoring', async () => {
    mocks.fetchGeckoTokens.mockResolvedValueOnce([token()])

    const result = await fetchTokensForChain('solana')

    expect(result).toEqual([expect.objectContaining({ address: 'fresh-token' })])
  })

  it('uses DexScreener fallback when Gecko pools are all excluded majors', async () => {
    mocks.fetchGeckoTokens.mockResolvedValueOnce([
      token({ address: 'wrapped-eth', symbol: 'WETH', chain: 'base' }),
    ])
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [{
          chainId: 'base',
          baseToken: { address: 'base-meme', symbol: 'MEME', name: 'Base Meme' },
          priceUsd: '0.001',
          volume: { h24: 5_000 },
          liquidity: { usd: 8_000 },
          marketCap: 100_000,
          fdv: 100_000,
          pairCreatedAt: Date.parse('2026-08-30T16:00:00.000Z'),
          txns: { h24: { buys: 10, sells: 5 } },
        }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTokensForChain('base')

    expect(fetchMock).toHaveBeenCalled()
    expect(result).toEqual([expect.objectContaining({ address: 'base-meme', chain: 'base' })])
  })
})
