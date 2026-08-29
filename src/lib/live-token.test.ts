import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveTokenSnapshot } from './live-token'

afterEach(() => vi.unstubAllGlobals())

describe('live token snapshots', () => {
  it('uses the deepest matching pool instead of trusting API pair order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pairs: [
        { chainId: 'solana', baseToken: { address: 'MintOne' }, priceUsd: '1', liquidity: { usd: 5_000 } },
        { chainId: 'base', baseToken: { address: 'MintOne' }, priceUsd: '99', liquidity: { usd: 999_999 } },
        { chainId: 'solana', baseToken: { address: 'MintOne' }, priceUsd: '2', liquidity: { usd: 50_000 }, volume: { h24: 80_000 }, txns: { h24: { buys: 70, sells: 30 } } },
      ],
    }), { status: 200 })))

    const snapshot = await fetchLiveTokenSnapshot('MintOne', 'solana')
    expect(snapshot?.priceUsd).toBe(2)
    expect(snapshot?.liquidity).toBe(50_000)
    expect(snapshot?.buys24h).toBe(70)
  })
})
