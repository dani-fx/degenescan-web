import { NextResponse } from 'next/server'
import { getLegendRecords } from '@/lib/legend-store'

export async function GET() {
  try {
    const legends = await getLegendRecords()
    const stageCounts = {
      WATCH: 0,
      EARLY_ALERT: 0,
      BREAKOUT_CANDIDATE: 0,
      PERSISTENT_LEADER: 0,
    }
    for (const record of legends) stageCounts[record.stage] += 1
    return NextResponse.json({
      legends,
      count: legends.length,
      stageCounts,
      mode: 'shadow',
      affectsTrading: false,
    })
  } catch (error) {
    console.error('Legend observatory read error', error)
    return NextResponse.json({ error: 'Legend observatory read failed' }, { status: 500 })
  }
}