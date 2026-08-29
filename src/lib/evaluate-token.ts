import { estimateAgeMinutes } from './fetcher'
import { rugcheckToken } from './rugcheck'
import { classifySignal } from './scan-policy'
import { scoreToken } from './scorer'
import type { BotConfig, RawToken, ScoredToken } from './types'

export interface EvaluatedToken {
  token: ScoredToken
  reason: string
}

export function scoreAndClassifyToken(raw: RawToken, config: BotConfig): EvaluatedToken {
  const token = scoreToken(raw, config)
  const ageMinutes = estimateAgeMinutes(raw)
  const txns = raw.txns24h
  const totalTxns = (txns?.buys ?? 0) + (txns?.sells ?? 0)
  const buyPressure = totalTxns > 0 ? ((txns?.buys ?? 0) / totalTxns) * 100 : 0
  const missingSocials = config.requireSocials && !(raw.socials?.length)
  const buyPressureTooLow = totalTxns > 0 && buyPressure < config.minBuyPressurePercent
  // Discovery providers do not expose a trustworthy LP-lock field. Fail closed.
  const lpLockUnavailable = config.requireLpLocked
  token.signalClass = missingSocials || buyPressureTooLow || lpLockUnavailable
    ? undefined
    : classifySignal({ score: token.score, liquidity: raw.liquidity, volume24h: raw.volume24h, ageMinutes }, config) ?? undefined

  let reason = 'filtered'
  if (missingSocials) reason = 'required socials missing'
  else if (buyPressureTooLow) reason = `buy pressure ${buyPressure.toFixed(1)}% below ${config.minBuyPressurePercent}%`
  else if (lpLockUnavailable) reason = 'LP-lock verification unavailable'
  else if (!Number.isFinite(ageMinutes)) reason = 'age unknown'
  else if (token.signalClass) reason = `${token.signalClass} — ${token.signals.slice(0, 2).map((signal) => signal.description).join(', ')}`
  else if (token.score < Math.max(0, config.minScoreC - 30)) reason = `score ${token.score} below watch threshold`
  return { token, reason }
}

export async function applyRugcheck(token: ScoredToken): Promise<{ token: ScoredToken; hardDrop: boolean; reason: string }> {
  const check = await rugcheckToken(token.address, token.chain)
  token.rugcheck = { checked: check.checked, safe: check.checked && !check.isRug && check.riskLevel === 'safe' }
  return {
    token,
    hardDrop: check.checked && (check.isRug || check.rugged),
    reason: check.reasons[0] ?? 'RugCheck flagged',
  }
}
