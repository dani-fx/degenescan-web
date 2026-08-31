import { describe, expect, it } from 'vitest'
import { interpretTokInFeatures } from './rugcheck'

const safeFeatures = {
  transfer_success: true,
  allowance_bypass: false,
  cannot_buy: false,
  owner_can_change_balance: false,
  has_blacklist_or_whitelist: false,
  tax_can_be_modified: false,
  pause_status_can_be_modified: false,
  trading_cap_can_be_modified: false,
  position_cap_can_be_modified: false,
  mint_or_burn_function: false,
  timebomb: false,
  dex: [{ liquidity: 80_000, buy_success: true, sell_success: true, buy_tax: 2, sell_tax: 3 }],
}

describe('TokIn safety interpretation', () => {
  it('accepts only an explicitly tradeable dominant pool with settled checks', () => {
    expect(interpretTokInFeatures(safeFeatures)).toMatchObject({
      checked: true,
      provider: 'tokin',
      isRug: false,
      riskLevel: 'safe',
    })
  })

  it('rejects a failed sell simulation or mutable contract controls', () => {
    const result = interpretTokInFeatures({
      ...safeFeatures,
      tax_can_be_modified: true,
      dex: [{ liquidity: 100_000, buy_success: true, sell_success: false, buy_tax: 0, sell_tax: null }],
    })
    expect(result.isRug).toBe(true)
    expect(result.riskLevel).toBe('high')
    expect(result.reasons).toEqual(expect.arrayContaining([
      'Trading tax can be modified',
      'Dominant pool sell simulation failed',
    ]))
  })

  it('fails closed when tri-state checks or taxes are unresolved', () => {
    const result = interpretTokInFeatures({
      ...safeFeatures,
      transfer_success: null,
      dex: [{ liquidity: 90_000, buy_success: true, sell_success: 'pending', buy_tax: 0, sell_tax: null }],
    })
    expect(result).toMatchObject({ checked: true, isRug: false, riskLevel: 'unknown' })
    expect(result.reasons).toEqual(expect.arrayContaining([
      'Transfer simulation did not settle',
      'Dominant pool sell simulation is unavailable',
      'Dominant pool sell tax is unknown',
    ]))
  })

  it('evaluates the highest-liquidity pool instead of accepting a safe dust pool', () => {
    const result = interpretTokInFeatures({
      ...safeFeatures,
      dex: [
        { liquidity: 100, buy_success: true, sell_success: true, buy_tax: 0, sell_tax: 0 },
        { liquidity: 75_000, buy_success: true, sell_success: false, buy_tax: 0, sell_tax: null },
      ],
    })
    expect(result.isRug).toBe(true)
    expect(result.reasons).toContain('Dominant pool sell simulation failed')
  })
})
