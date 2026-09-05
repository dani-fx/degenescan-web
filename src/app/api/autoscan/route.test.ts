import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auto-scan', () => ({
  getAutoScanState: vi.fn(() => ({ enabled: false })),
  setAutoScanEnabled: vi.fn((enabled: boolean) => ({ enabled })),
}))
vi.mock('@/lib/api', () => ({
  requireMutationAccess: vi.fn(() => null),
  rateLimit: vi.fn(() => null),
}))

import { POST } from './route'
import { setAutoScanEnabled } from '@/lib/auto-scan'

function request(body: string) {
  return new NextRequest('http://localhost/api/autoscan', { method: 'POST', body })
}

afterEach(() => vi.clearAllMocks())

describe('POST /api/autoscan validation', () => {
  it.each(['null', '[]', 'true', '"enabled"', '{}', '{"enabled":"true"}', '{'])('rejects invalid body %s without changing scheduler state', async (body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    expect(setAutoScanEnabled).not.toHaveBeenCalled()
  })

  it.each([true, false])('accepts enabled=%s', async (enabled) => {
    const response = await POST(request(JSON.stringify({ enabled })))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled })
    expect(setAutoScanEnabled).toHaveBeenCalledExactlyOnceWith(enabled)
  })
})
