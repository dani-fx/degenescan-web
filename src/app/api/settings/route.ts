import { NextRequest, NextResponse } from 'next/server'
import { getConfig, updateConfig } from '@/lib/signal-store'

export async function GET() {
  const config = getConfig()
  return NextResponse.json({ settings: config })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const allowed = [
      'chains',
      'minLiquidityUsd',
      'maxPairAgeMinutes',
      'minScoreA',
      'minScoreB',
      'minScoreC',
      'minVolumeSpikeMultiplier',
      'minVolume24hUsd',
      'minBuyPressurePercent',
      'requireSocials',
      'requireLpLocked',
      'pollIntervalMs',
      'maxAlertsPerPoll',
      'trackRefreshChangePercent',
    ] as const

    const partial: Record<string, unknown> = {}
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        partial[key] = (body as Record<string, unknown>)[key]
      }
    }

    const updated = updateConfig(partial as never)
    return NextResponse.json({ settings: updated })
  } catch (error) {
    console.error('Settings API error', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
