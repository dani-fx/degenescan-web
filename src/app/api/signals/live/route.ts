import { NextRequest, NextResponse } from 'next/server'
import { fetchLiveTokenSnapshot } from '@/lib/live-token'
import { canonicalIdentity } from '@/lib/token-identity'
import { rateLimit } from '@/lib/api'

const MAX_IDENTITIES = 25

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 60, 60_000); if (limited) return limited
  const raw = request.nextUrl.searchParams.get('tokens')?.split(',').filter(Boolean) ?? []
  if (raw.length > MAX_IDENTITIES) return NextResponse.json({ error: `Maximum ${MAX_IDENTITIES} tokens` }, { status: 400 })
  const identities = []
  try {
    for (const value of raw) {
      const separator = value.indexOf(':')
      if (separator < 1) throw new Error('invalid identity')
      identities.push(canonicalIdentity(value.slice(0, separator), value.slice(separator + 1)))
    }
  } catch { return NextResponse.json({ error: 'tokens must be canonical chain:address identities' }, { status: 400 }) }
  const settled = await Promise.all(identities.map(async (identity) => {
    try { return await fetchLiveTokenSnapshot(identity.address, identity.chain) } catch { return null }
  }))
  const live = settled.filter((snapshot) => snapshot !== null)
  return NextResponse.json({ live, requested: identities.length, failed: identities.length - live.length, partial: live.length !== identities.length })
}
