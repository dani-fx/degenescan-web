import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoredToken } from './types'

const mocks = vi.hoisted(() => ({ rugcheckToken: vi.fn() }))
vi.mock('./rugcheck', () => ({ rugcheckToken: mocks.rugcheckToken }))

import { applyRugcheck } from './evaluate-token'

const token = { address: 'MintModerate', chain: 'solana' } as ScoredToken

describe('simulation safety classification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows checked moderate warnings when no rug condition exists', async () => {
    mocks.rugcheckToken.mockResolvedValue({
      checked: true,
      isRug: false,
      rugged: false,
      riskLevel: 'moderate',
      reasons: ['[warn] High holder correlation'],
    })

    const result = await applyRugcheck({ ...token })

    expect(result.hardDrop).toBe(false)
    expect(result.token.rugcheck).toEqual({ checked: true, safe: true })
  })

  it('continues to reject unknown safety results', async () => {
    mocks.rugcheckToken.mockResolvedValue({
      checked: false,
      isRug: false,
      rugged: false,
      riskLevel: 'unknown',
      reasons: ['provider unavailable'],
    })

    const result = await applyRugcheck({ ...token })

    expect(result.token.rugcheck).toEqual({ checked: false, safe: false })
  })

  it('continues to reject confirmed high-risk tokens', async () => {
    mocks.rugcheckToken.mockResolvedValue({
      checked: true,
      isRug: true,
      rugged: false,
      riskLevel: 'high',
      reasons: ['Mint authority active'],
    })

    const result = await applyRugcheck({ ...token })

    expect(result.hardDrop).toBe(true)
    expect(result.token.rugcheck).toEqual({ checked: true, safe: false })
  })
})
