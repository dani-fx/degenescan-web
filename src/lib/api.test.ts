import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { requireMutationAccess } from './api'

afterEach(() => {
  delete process.env.DEGENESCAN_ADMIN_TOKEN
})

function sameOriginRequest(authorization?: string): NextRequest {
  const headers = new Headers({ origin: 'https://example.test', host: 'example.test' })
  if (authorization) headers.set('authorization', authorization)
  return new NextRequest('https://example.test/api/scan', { method: 'POST', headers })
}

describe('mutation access', () => {
  it('allows a same-origin mutation when owner authentication is not configured', () => {
    expect(requireMutationAccess(sameOriginRequest())).toBeNull()
  })

  it('requires the configured admin token even for a same-origin request', () => {
    process.env.DEGENESCAN_ADMIN_TOKEN = 'owner-secret'
    expect(requireMutationAccess(sameOriginRequest())?.status).toBe(401)
    expect(requireMutationAccess(sameOriginRequest('Bearer wrong'))?.status).toBe(401)
    expect(requireMutationAccess(sameOriginRequest('Bearer owner-secret'))).toBeNull()
  })
})
