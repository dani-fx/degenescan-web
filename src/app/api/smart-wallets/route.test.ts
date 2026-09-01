import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

afterEach(() => {
  delete process.env.SMART_WALLET_API_URL
  delete process.env.SMART_WALLET_API_TOKEN
  vi.unstubAllGlobals()
})

const payload = {
  enabled: true,
  updatedAt: '2026-09-01T20:00:00.000Z',
  status: { analyzedTokens: 0, candidates: 0, qualified: 0, pendingAlerts: 0 },
  wallets: [],
  recentTrades: [],
}

describe('GET /api/smart-wallets', () => {
  it('returns unavailable when the internal monitor is not configured', async () => {
    const response = await GET()
    expect(response.status).toBe(503)
  })

  it('proxies the authenticated internal snapshot without exposing credentials', async () => {
    process.env.SMART_WALLET_API_URL = 'http://degenscan.internal:3000/api/smart-wallets'
    process.env.SMART_WALLET_API_TOKEN = 'server-secret'
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-secret')
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
