import { NextResponse } from 'next/server'
import {
  fetchNarrativeGems,
  DEFAULT_NARRATIVE_CONFIG,
  scoreNarrative,
} from '@/lib/narrative'
import type { NarrativeLaneFilters } from '@/lib/narrative-configs'

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const maxAlertsPerCycle = Number(
    search.get('maxAlertsPerCycle') ?? DEFAULT_NARRATIVE_CONFIG.maxAlertsPerCycle
  )
  const minH1Buyers = Number(
    search.get('minH1Buyers') ?? DEFAULT_NARRATIVE_CONFIG.minH1Buyers
  )
  const minM15Buyers = Number(
    search.get('minM15Buyers') ?? DEFAULT_NARRATIVE_CONFIG.minM15Buyers
  )
  const minLiquidityUsd = Number(
    search.get('minLiquidityUsd') ?? DEFAULT_NARRATIVE_CONFIG.minLiquidityUsd
  )
  const minVolumeH1Usd = Number(
    search.get('minVolumeH1Usd') ?? DEFAULT_NARRATIVE_CONFIG.minVolumeH1Usd
  )

  const filters = {
    minAgeMinutes: DEFAULT_NARRATIVE_CONFIG.minAgeMinutes,
    maxAgeMinutes: DEFAULT_NARRATIVE_CONFIG.maxAgeMinutes,
    minH1Buyers,
    minM15Buyers,
    minLiquidityUsd,
    minVolumeH1Usd,
    maxAlertsPerCycle: Number.isFinite(maxAlertsPerCycle)
      ? maxAlertsPerCycle
      : DEFAULT_NARRATIVE_CONFIG.maxAlertsPerCycle,
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
