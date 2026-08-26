export interface NarrativeLaneConfig {
  minAgeMinutes: number
  maxAgeMinutes: number
  minH1Buyers: number
  minM15Buyers: number
  maxTopHolderPct: number
  maxInsiderPct: number
  minLiquidityUsd: number
  minVolumeH1Usd: number
  intervalMs: number
  maxAlertsPerCycle: number
}

export interface NarrativeLaneFilters {
  minAgeMinutes: number
  maxAgeMinutes: number
  minH1Buyers: number
  minM15Buyers: number
  minLiquidityUsd: number
  minVolumeH1Usd: number
  maxAlertsPerCycle: number
}
