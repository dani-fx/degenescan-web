import type { Chain } from './types'

const CHAIN_ALIASES: Record<string, Chain> = {
  solana: 'solana', base: 'base', ethereum: 'ethereum', eth: 'ethereum',
  bsc: 'bsc', binance: 'bsc', arbitrum: 'arbitrum',
}

export function canonicalChain(value: string): Chain | null {
  return CHAIN_ALIASES[value.trim().toLowerCase()] ?? null
}

export function canonicalIdentity(chainValue: string, addressValue: string): { chain: Chain; address: string; key: string } {
  const chain = canonicalChain(chainValue)
  const rawAddress = addressValue.trim()
  if (!chain || !rawAddress || rawAddress.length > 128) throw new Error('invalid token identity')
  const address = chain === 'solana' ? rawAddress : rawAddress.toLowerCase()
  return { chain, address, key: `${chain}:${address}` }
}
