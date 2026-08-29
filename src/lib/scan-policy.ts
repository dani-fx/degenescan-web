import type { BotConfig, SignalClass } from './types'

export interface PolicyInput { score: number; liquidity: number; volume24h: number; ageMinutes: number }

export function classifySignal(input: PolicyInput, config: BotConfig): SignalClass | null {
  const { score, liquidity, volume24h, ageMinutes } = input
  if (!Number.isFinite(ageMinutes)) return null
  if (score >= config.minScoreC && liquidity >= config.minLiquidityUsd && volume24h >= config.minVolume24hUsd && ageMinutes <= config.maxPairAgeMinutes) return 'HIGH'
  if (score >= Math.max(0, config.minScoreC - 15) && liquidity >= config.minLiquidityUsd / 3 && volume24h >= config.minVolume24hUsd / 4 && ageMinutes <= config.maxPairAgeMinutes * 1.5) return 'LOW'
  if (score >= Math.max(0, config.minScoreC - 30) && liquidity >= config.minLiquidityUsd / 6 && ageMinutes <= config.maxPairAgeMinutes * 1.5) return 'WATCH'
  return null
}

export function isAutoTradeEligible(token: { score: number; signalClass?: SignalClass; rugcheck?: { checked: boolean; safe: boolean } }, threshold: number): boolean {
  return token.score >= threshold && token.signalClass === 'HIGH' && token.rugcheck?.checked === true && token.rugcheck.safe === true
}