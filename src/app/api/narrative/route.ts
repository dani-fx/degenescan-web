import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  fetchNarrativeGems,
  DEFAULT_NARRATIVE_CONFIG,
} from '@/lib/narrative'
import type { NarrativeLaneFilters } from '@/lib/narrative-configs'
import { validationError } from '@/lib/api'

const querySchema = z.object({
  maxAlertsPerCycle: z.coerce.number().int().min(1).max(10).default(DEFAULT_NARRATIVE_CONFIG.maxAlertsPerCycle),
  minH1Buyers: z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_NARRATIVE_CONFIG.minH1Buyers),
  minM15Buyers: z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_NARRATIVE_CONFIG.minM15Buyers),
  minLiquidityUsd: z.coerce.number().min(0).max(1_000_000_000).default(DEFAULT_NARRATIVE_CONFIG.minLiquidityUsd),
  minVolumeH1Usd: z.coerce.number().min(0).max(1_000_000_000).default(DEFAULT_NARRATIVE_CONFIG.minVolumeH1Usd),
})

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const parsed = querySchema.safeParse(Object.fromEntries(search.entries()))
  if (!parsed.success) return validationError(parsed.error)
  const { maxAlertsPerCycle, minH1Buyers, minM15Buyers, minLiquidityUsd, minVolumeH1Usd } = parsed.data

  const filters = {
    minAgeMinutes: DEFAULT_NARRATIVE_CONFIG.minAgeMinutes,
    maxAgeMinutes: DEFAULT_NARRATIVE_CONFIG.maxAgeMinutes,
    minH1Buyers,
    minM15Buyers,
    minLiquidityUsd,
    minVolumeH1Usd,
    maxAlertsPerCycle,
  } satisfies NarrativeLaneFilters

  try {
    const solanaGems = await fetchNarrativeGems('solana', filters, 0)
    return NextResponse.json({
      chain: 'solana',
      count: solanaGems.length,
      gems: solanaGems,
      fetchedAt: new Date().toISOString(),
      filters,
    })
  } catch (error) {
    console.error('Narrative API error', error)
    return NextResponse.json({ error: 'Narrative scan failed' }, { status: 500 })
  }
}
