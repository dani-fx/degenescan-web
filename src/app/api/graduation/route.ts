import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  fetchGraduations,
  DEFAULT_GRADUATION_CONFIG,
  curveLabel,
} from '@/lib/graduation'
import type { GraduationConfig } from '@/lib/graduation'
import { validationError } from '@/lib/api'

const querySchema = z.object({
  maxAlertsPerCycle: z.coerce.number().int().min(1).max(10).default(DEFAULT_GRADUATION_CONFIG.maxAlertsPerCycle),
  minH1Buyers: z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_GRADUATION_CONFIG.minH1Buyers),
  minM15Buyers: z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_GRADUATION_CONFIG.minM15Buyers),
  minLiquidityUsd: z.coerce.number().min(0).max(1_000_000_000).default(DEFAULT_GRADUATION_CONFIG.minLiquidityUsd),
  maxAgeMinutes: z.coerce.number().int().min(1).max(43_200).default(DEFAULT_GRADUATION_CONFIG.maxAgeMinutes),
})

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const parsed = querySchema.safeParse(Object.fromEntries(search.entries()))
  if (!parsed.success) return validationError(parsed.error)
  const { maxAlertsPerCycle, minH1Buyers, minM15Buyers, minLiquidityUsd, maxAgeMinutes } = parsed.data

  const config = {
    minH1Buyers,
    minM15Buyers,
    minLiquidityUsd,
    maxAgeMinutes,
    intervalMs: DEFAULT_GRADUATION_CONFIG.intervalMs,
    maxAlertsPerCycle,
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
