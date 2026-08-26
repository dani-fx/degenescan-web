import { NextResponse } from 'next/server'
import {
  fetchGraduations,
  DEFAULT_GRADUATION_CONFIG,
  curveLabel,
} from '@/lib/graduation'
import type { GraduationConfig } from '@/lib/graduation'

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const maxAlertsPerCycle = Number(
    search.get('maxAlertsPerCycle') ??
      DEFAULT_GRADUATION_CONFIG.maxAlertsPerCycle
  )
  const minH1Buyers = Number(
    search.get('minH1Buyers') ?? DEFAULT_GRADUATION_CONFIG.minH1Buyers
  )
  const minM15Buyers = Number(
    search.get('minM15Buyers') ?? DEFAULT_GRADUATION_CONFIG.minM15Buyers
  )
  const minLiquidityUsd = Number(
    search.get('minLiquidityUsd') ?? DEFAULT_GRADUATION_CONFIG.minLiquidityUsd
  )
  const maxAgeMinutes = Number(
    search.get('maxAgeMinutes') ?? DEFAULT_GRADUATION_CONFIG.maxAgeMinutes
  )

  const config = {
    minH1Buyers,
    minM15Buyers,
    minLiquidityUsd,
    maxAgeMinutes: Number.isFinite(maxAgeMinutes)
      ? maxAgeMinutes
      : DEFAULT_GRADUATION_CONFIG.maxAgeMinutes,
    intervalMs: DEFAULT_GRADUATION_CONFIG.intervalMs,
    maxAlertsPerCycle: Number.isFinite(maxAlertsPerCycle)
      ? maxAlertsPerCycle
      : DEFAULT_GRADUATION_CONFIG.maxAlertsPerCycle,
  } satisfies GraduationConfig

  try {
    const grads = await fetchGraduations(config, 0)
    const enriched = grads.map((g) => ({
      ...g,
      curveLabel: curveLabel(g.curveMinutes),
    }))
    return NextResponse.json({
      chain: 'solana',
      count: enriched.length,
      graduations: enriched,
      fetchedAt: new Date().toISOString(),
      config,
    })
  } catch (error) {
    console.error('Graduation API error', error)
    return NextResponse.json(
      { error: 'Graduation scan failed' },
      { status: 500 }
    )
  }
}
