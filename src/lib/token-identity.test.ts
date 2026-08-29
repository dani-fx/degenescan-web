import { describe, expect, it } from 'vitest'
import { canonicalChain, canonicalIdentity } from './token-identity'

describe('canonical token identity', () => {
  it('normalizes chain aliases, whitespace, and EVM address case', () => {
    expect(canonicalChain(' ETH ')).toBe('ethereum')
    expect(canonicalChain('binance')).toBe('bsc')
    expect(canonicalIdentity('ETH', ' 0xAbCd ')).toEqual({
      chain: 'ethereum', address: '0xabcd', key: 'ethereum:0xabcd',
    })
  })

  it('preserves case for Solana addresses', () => {
    expect(canonicalIdentity(' solana ', ' AbC123 ')).toEqual({
      chain: 'solana', address: 'AbC123', key: 'solana:AbC123',
    })
  })

  it.each([
    ['unknown', '0xabc'],
    ['ethereum', '   '],
    ['base', 'x'.repeat(129)],
  ])('rejects invalid identity (%s, %s)', (chain, address) => {
    expect(() => canonicalIdentity(chain, address)).toThrow('invalid token identity')
  })
})
