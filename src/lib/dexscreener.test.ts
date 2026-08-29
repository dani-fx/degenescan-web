import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mapDexPair, type DexPair } from './dexscreener'

describe('DexScreener pair mapping', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'))
  })

  it('maps the supported numeric and token fields deterministically', () => {
    const pair: DexPair = {
      chainId: 'ETH',
      pairCreatedAt: Date.parse('2026-08-29T10:00:00.000Z'),
      priceUsd: '1.25',
      baseToken: { address: ' 0xAbC ', symbol: 'ABC', name: 'Alpha' },
      priceChange: { h24: 12.5 },
      volume: { h24: 45_000 },
      liquidity: { usd: 32_000 },
      marketCap: 125_000,
      fdv: 150_000,
      txns: { h24: { buys: 80, sells: 20 } },
    }

    expect(mapDexPair(pair, 'ethereum', '0xabc')).toMatchObject({
      address: '0xabc', chain: 'ethereum', symbol: 'ABC', name: 'Alpha',
      priceUsd: 1.25, priceChange24h: 12.5, volume24h: 45_000,
      liquidity: 32_000, marketCap: 125_000, fdv: 150_000,
      pairCreatedAt: Date.parse('2026-08-29T10:00:00.000Z'),
      createdAt: '2026-08-29T10:00:00.000Z',
      txns24h: { buys: 80, sells: 20 }, score: 0, tier: 'D',
    })
  })

  it('enforces both canonical chain and canonical address', () => {
    const pair: DexPair = { chainId: 'base', baseToken: { address: '0xAbC' } }
    expect(mapDexPair(pair, 'base', '0xabc')).not.toBeNull()
    expect(mapDexPair(pair, 'ethereum', '0xabc')).toBeNull()
    expect(mapDexPair(pair, 'base', '0xdef')).toBeNull()
    expect(mapDexPair({ chainId: 'base' }, 'base', '0xabc')).toBeNull()
    expect(mapDexPair({ chainId: 'unsupported-chain', baseToken: { address: '0xabc' } }, 'base', '0xabc')).toBeNull()
  })
})
