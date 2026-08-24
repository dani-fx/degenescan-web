import type { RawToken, ScoredToken, Signal, BotConfig } from './types'
import { estimateAgeMinutes } from './fetcher'

export function scoreToken(token: RawToken, config: BotConfig): ScoredToken {
  const ageMin = estimateAgeMinutes(token)
  const ageHours = ageMin / 60
  const signals: Signal[] = []
  let score = 0
  const warnings: string[] = []

  if (ageMin < 45) {
    score += 14
    signals.push({ type: 'fresh_pair', strength: 'extreme', description: 'Pair <45m old', points: 14 })
  } else if (ageMin < 120) {
    score += 8
    signals.push({ type: 'fresh_pair', strength: 'strong', description: 'Pair <2h old', points: 8 })
  } else if (ageMin < 240) {
    score += 2
    signals.push({ type: 'fresh_pair', strength: 'moderate', description: 'Pair <4h old', points: 2 })
  } else {
    warnings.push(`Pair age is ${ageHours.toFixed(1)}h; older than ideal runner window`)
  }

  if (token.liquidity >= 200_000) {
    score += 14
    signals.push({ type: 'liquidity', strength: 'strong', description: `$${(token.liquidity / 1000).toFixed(0)}k liquidity`, points: 14 })
  } else if (token.liquidity >= 80_000) {
    score += 6
    signals.push({ type: 'liquidity', strength: 'moderate', description: 'Liquidity above baseline', points: 6 })
  } else {
    warnings.push(`Liquidity $${token.liquidity.toFixed(0)} below threshold`)
  }

  if (token.volume24h > 0 && token.liquidity > 0 && token.volume24h / token.liquidity >= 3.0) {
    score += 18
    signals.push({ type: 'volume_velocity', strength: 'extreme', description: `Vol/Liq ${(token.volume24h / token.liquidity).toFixed(1)}x`, points: 18 })
  } else if (token.volume24h > 0 && token.liquidity > 0 && token.volume24h / token.liquidity >= 1.8) {
    score += 8
    signals.push({ type: 'volume_velocity', strength: 'moderate', description: `Vol/Liq ${(token.volume24h / token.liquidity).toFixed(1)}x`, points: 8 })
  }

  const buyPressure = computeBuyPressure(token.txns24h)
  if (buyPressure < 0) {
    warnings.push('No txn data')
  } else if (buyPressure >= 65) {
    score += 12
    signals.push({ type: 'buy_pressure', strength: 'strong', description: `Buy pressure ${buyPressure}%`, points: 12 })
  } else if (buyPressure >= 55) {
    score += 4
    signals.push({ type: 'buy_pressure', strength: 'weak', description: `Buy pressure ${buyPressure}%`, points: 4 })
  } else {
    warnings.push(`Buy pressure ${buyPressure}% is weak`)
  }

  if (token.txns24h) {
    const txnTotal = token.txns24h.buys + token.txns24h.sells
    if (txnTotal >= 500) {
      score += 6
      signals.push({ type: 'organic_activity', strength: 'moderate', description: `${txnTotal} txs in 24h`, points: 6 })
    }
  }

  if (token.marketCap > 0 && token.marketCap < 25_000) {
    score -= 8
    warnings.push(`Very small market cap $${token.marketCap.toFixed(0)}`)
  }

  const socialCount = token.socials?.length || 0
  if (socialCount >= 2) {
    score += 8
    signals.push({ type: 'socials', strength: 'strong', description: `${socialCount} social links`, points: 8 })
  } else if (config.requireSocials && socialCount === 0) {
    warnings.push('No social links found')
  }

  const symbol = token.symbol.toLowerCase()
  const narrativeMatches = symbol.includes('pepe') || symbol.includes('inu')
  if (narrativeMatches) {
    score += 2
    signals.push({ type: 'narrative', strength: 'weak', description: 'Matches runner-like narrative pattern', points: 2 })
  }

  if (token.liquidity < 20_000) {
    score -= 10
    warnings.push('Low-liquidity pair is easier to manipulate')
  }
  if (token.priceUsd <= 0) {
    score = Math.max(0, score - 15)
    warnings.push('Bad price data')
  }

  score = Math.max(0, Math.min(100, score))

  const tier =
    score >= (config.minScoreA ?? 85) ? 'A' :
    score >= (config.minScoreB ?? 75) ? 'B' :
    score >= (config.minScoreC ?? 65) ? 'C' : 'D'
  const explanation = buildExplanation(token, score, tier, signals, warnings, ageMin, buyPressure)

  return {
    ...token,
    score,
    tier,
    signals,
    explanation,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}

function computeBuyPressure(txns24h: { buys: number; sells: number } | undefined): number {
  // -1 = unknown; callers treat any negative value as failing the
  // buy-pressure check (no points, warning added).
  if (!txns24h || typeof txns24h !== 'object') return -1
  const total = txns24h.buys + txns24h.sells
  if (!(total > 0)) return -1
  return Math.round((txns24h.buys / total) * 100)
}

function buildExplanation(
  token: RawToken,
  score: number,
  tier: string,
  signals: Signal[],
  warnings: string[],
  ageMin: number,
  buyPressure: number
): string {
  const ageLabel = ageMin < 60 ? `${ageMin}m` : `${(ageMin / 60).toFixed(1)}h`
  const volLabel = token.volume24h >= 1_000_000 ? `$${(token.volume24h / 1_000_000).toFixed(2)}M` : `$${(token.volume24h / 1000).toFixed(0)}k`
  const liqLabel = `$${(token.liquidity / 1000).toFixed(0)}k`

  let text = `$${token.symbol} score ${score}/100 (${tier})`
  const buyLabel = buyPressure < 0 ? 'n/a' : `${buyPressure}%`
  text += ` | ${ageLabel} old | Vol ${volLabel} | Liq ${liqLabel} | Buy ${buyLabel}`
  if (signals.length > 0) text += `\n• ${signals.map((s) => `+${s.points} ${s.description}`).join('\n• ')}`
  if (warnings.length > 0) text += `\n⚠️ ${warnings[0]}`
  return text
}
