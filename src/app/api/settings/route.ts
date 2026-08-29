import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getConfig, updateConfig } from '@/lib/signal-store'
import { rateLimit, requireMutationAccess, validationError } from '@/lib/api'

const settingsSchema = z.object({
  chains: z.array(z.enum(['solana', 'base', 'ethereum', 'bsc', 'arbitrum'])).min(1).max(5).optional(),
  minLiquidityUsd: z.number().finite().min(0).max(100_000_000).optional(),
  maxPairAgeMinutes: z.number().finite().int().min(1).max(43_200).optional(),
  minScoreA: z.number().finite().int().min(0).max(100).optional(),
  minScoreB: z.number().finite().int().min(0).max(100).optional(),
  minScoreC: z.number().finite().int().min(0).max(100).optional(),
  minVolumeSpikeMultiplier: z.number().finite().min(0).max(100).optional(),
  minVolume24hUsd: z.number().finite().min(0).max(1_000_000_000).optional(),
  minBuyPressurePercent: z.number().finite().min(0).max(100).optional(),
  requireSocials: z.boolean().optional(), requireLpLocked: z.boolean().optional(),
  pollIntervalMs: z.number().finite().int().min(30_000).max(86_400_000).optional(),
  maxAlertsPerPoll: z.number().finite().int().min(1).max(25).optional(),
  trackRefreshChangePercent: z.number().finite().min(0).max(100).optional(),
}).strict()

export async function GET() {
  const config = await getConfig()
  return NextResponse.json({ settings: config })
}

export async function POST(request: NextRequest) {
  const denied = requireMutationAccess(request); if (denied) return denied
  const limited = rateLimit(request, 20, 60_000); if (limited) return limited
  try {
    const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationError(parsed.error)
    const current = await getConfig()
    const merged = { ...current, ...parsed.data }
    if (!(merged.minScoreA >= merged.minScoreB && merged.minScoreB >= merged.minScoreC)) {
      return NextResponse.json({ error: 'Score thresholds must satisfy A >= B >= C' }, { status: 400 })
    }
    const updated = await updateConfig(parsed.data)
    return NextResponse.json({ settings: updated })
  } catch (error) {
    console.error('Settings API error', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
