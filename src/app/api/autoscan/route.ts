import { NextRequest, NextResponse } from 'next/server'
import { getAutoScanState, initAutoScan, setAutoScanEnabled } from '@/lib/auto-scan'
import { rateLimit, requireMutationAccess } from '@/lib/api'

// The root layout is statically rendered, so its module-level initializer only
// runs during the build. Initialize again when the server API module loads so a
// persisted enabled schedule actually resumes after a Railway restart.
initAutoScan()

export async function GET() {
  return NextResponse.json(getAutoScanState())
}

export async function POST(request: NextRequest) {
  const denied = requireMutationAccess(request); if (denied) return denied
  const limited = rateLimit(request, 10, 60_000); if (limited) return limited
  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'body must be { enabled: boolean }' }, { status: 400 })
  }
  return NextResponse.json(setAutoScanEnabled(body.enabled))
}
