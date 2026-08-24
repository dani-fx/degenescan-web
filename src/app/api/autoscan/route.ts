import { NextRequest, NextResponse } from 'next/server'
import { getAutoScanState, setAutoScanEnabled } from '@/lib/auto-scan'

export async function GET() {
  return NextResponse.json(getAutoScanState())
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { enabled?: boolean }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'body must be { enabled: boolean }' }, { status: 400 })
  }
  return NextResponse.json(setAutoScanEnabled(body.enabled))
}
