const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === 'string' && SOLANA_ADDRESS.test(value)
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
