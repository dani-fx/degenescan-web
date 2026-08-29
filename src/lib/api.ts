import { NextRequest, NextResponse } from 'next/server'

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(request: NextRequest, limit: number, windowMs: number): NextResponse | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const key = `${forwarded || request.headers.get('x-real-ip') || 'local'}:${request.nextUrl.pathname}`
  const now = Date.now()
  if (buckets.size > 1_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey)
  }
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }
  bucket.count++
  if (bucket.count <= limit) return null
  return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)) } })
}

export function requireMutationAccess(request: NextRequest): NextResponse | null {
  const adminToken = process.env.DEGENESCAN_ADMIN_TOKEN
  if (adminToken) {
    if (request.headers.get('authorization') === `Bearer ${adminToken}`) return null
    return NextResponse.json({ error: 'Invalid or missing admin token' }, { status: 401 })
  }
  const origin = request.headers.get('origin')
  let originMatchesHost = false
  try {
    originMatchesHost = Boolean(origin && new URL(origin).host === request.headers.get('host'))
  } catch {}
  if (origin === request.nextUrl.origin || originMatchesHost || request.headers.get('sec-fetch-site') === 'same-origin') return null
  return NextResponse.json({ error: 'Mutation requires same-origin access' }, { status: 403 })
}

export function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): NextResponse {
  return NextResponse.json({ error: 'Invalid request', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }, { status: 400 })
}
