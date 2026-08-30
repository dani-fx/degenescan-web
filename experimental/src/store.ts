import fs from 'node:fs'
import path from 'node:path'
import type { BuyTrade, RunnerSignal, ServiceState, Snapshot, Stage, TokenTrack, WalletPick, WalletStats } from './types.js'
import { isIsoDate, isSolanaAddress } from './validation.js'

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const statePath = path.join(dataDir, 'experimental-state.json')
const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>
const stages = new Set<Stage>(['DISCOVERED', 'ORGANIC', 'LIQUIDITY_GROWING', 'HOLDERS_ACCELERATING', 'RUNNER', 'REJECTED'])
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function emptyState(): ServiceState {
  return { startedAt: new Date().toISOString(), lastCycleAt: null, cycles: 0, errors: 0, tracks: dictionary(), wallets: dictionary(), signals: [] }
}

function validTrade(value: unknown): value is BuyTrade {
  const trade = value as BuyTrade
  return Boolean(trade) && typeof trade.id === 'string' && trade.id.length > 0 && trade.id.length <= 128
    && isSolanaAddress(trade.wallet) && isIsoDate(trade.at) && finite(trade.priceUsd) && trade.priceUsd > 0
}

function validSnapshot(value: unknown): value is Snapshot {
  const row = value as Snapshot
  return Boolean(row) && isIsoDate(row.at) && finite(row.priceUsd) && row.priceUsd >= 0
    && finite(row.liquidityUsd) && row.liquidityUsd >= 0 && finite(row.volumeH1Usd) && row.volumeH1Usd >= 0
    && finite(row.h1Buyers) && row.h1Buyers >= 0 && finite(row.h1Sellers) && row.h1Sellers >= 0
    && finite(row.m15Buyers) && row.m15Buyers >= 0
    && (row.totalHolders === null || (finite(row.totalHolders) && row.totalHolders >= 0))
    && (row.rugSafe === null || typeof row.rugSafe === 'boolean')
    && Array.isArray(row.buyTrades) && row.buyTrades.length <= 100 && row.buyTrades.every(validTrade)
}

function sanitizeTrack(key: string, value: unknown): TokenTrack | null {
  const track = value as TokenTrack
  if (!isSolanaAddress(key) || track?.mint !== key || !isSolanaAddress(track.poolAddress)
    || typeof track.symbol !== 'string' || typeof track.name !== 'string'
    || !isIsoDate(track.createdAt) || !isIsoDate(track.discoveredAt) || !stages.has(track.stage)
    || !Array.isArray(track.snapshots) || track.snapshots.length > 96 || !track.snapshots.every(validSnapshot)) return null
  const stageTimes: TokenTrack['stageTimes'] = {}
  for (const [stage, at] of Object.entries(track.stageTimes ?? {})) if (stages.has(stage as Stage) && isIsoDate(at)) stageTimes[stage as Stage] = at
  const organicBaseline = track.organicBaseline && isIsoDate(track.organicBaseline.at) && finite(track.organicBaseline.liquidityUsd)
    ? track.organicBaseline : undefined
  const holderBaseline = track.holderBaseline && isIsoDate(track.holderBaseline.at) && finite(track.holderBaseline.totalHolders) && track.holderBaseline.totalHolders > 0
    ? track.holderBaseline : undefined
  const holderSamples = Array.isArray(track.holderSamples)
    ? track.holderSamples.filter((sample) => isIsoDate(sample?.at) && finite(sample?.totalHolders) && sample.totalHolders > 0).slice(-3) : []
  if (track.stage !== 'DISCOVERED' && track.stage !== 'REJECTED' && (!organicBaseline || !stageTimes.ORGANIC)) return null
  if (['LIQUIDITY_GROWING', 'HOLDERS_ACCELERATING', 'RUNNER'].includes(track.stage) && !stageTimes.LIQUIDITY_GROWING) return null
  if (['HOLDERS_ACCELERATING', 'RUNNER'].includes(track.stage) && (!holderBaseline || !stageTimes.HOLDERS_ACCELERATING)) return null
  return {
    ...track, stageTimes, organicBaseline, holderBaseline, holderSamples,
    reasons: Array.isArray(track.reasons) ? track.reasons.filter((reason) => typeof reason === 'string').slice(-20) : [],
    alerted: Boolean(track.alerted),
    seenTradeIds: Array.isArray(track.seenTradeIds) ? track.seenTradeIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128).slice(-500) : [],
  }
}

function sanitizeWallet(key: string, value: unknown): WalletStats | null {
  const input = value as WalletStats
  if (!isSolanaAddress(key) || input?.wallet !== key || !input.picks || typeof input.picks !== 'object') return null
  const picks = dictionary<WalletPick>()
  let wins = 0, losses = 0, resolved = 0, sumMultiple = 0
  for (const [mint, raw] of Object.entries(input.picks).slice(-25)) {
    const pick = raw as WalletPick
    if (!isSolanaAddress(mint) || pick?.mint !== mint || !isIsoDate(pick.enteredAt)
      || !finite(pick.entryPrice) || pick.entryPrice <= 0 || !finite(pick.bestPrice) || pick.bestPrice <= 0
      || typeof pick.resolved !== 'boolean') continue
    if (pick.resolved && (!finite(pick.multiple) || pick.multiple <= 0 || pick.multiple > 1_000_000)) continue
    picks[mint] = pick
    if (pick.resolved) {
      resolved++
      sumMultiple += pick.multiple!
      if (pick.multiple! >= 1.5) wins++
      else losses++
    }
  }
  return { wallet: key, wins, losses, resolved, sumMultiple, picks }
}

function sanitizeSignal(value: unknown): RunnerSignal | null {
  const signal = value as RunnerSignal
  if (!isSolanaAddress(signal?.mint) || !isSolanaAddress(signal?.poolAddress) || typeof signal.symbol !== 'string'
    || signal.stage !== 'RUNNER' || !isIsoDate(signal.detectedAt)
    || !finite(signal.liquidityGrowthPct) || !finite(signal.holderGrowthPct)
    || !Array.isArray(signal.qualifiedWallets) || !signal.qualifiedWallets.every(isSolanaAddress)) return null
  return {
    ...signal, symbol: signal.symbol.slice(0, 32), qualifiedWallets: signal.qualifiedWallets.slice(0, 20),
    reasons: Array.isArray(signal.reasons) ? signal.reasons.filter((reason) => typeof reason === 'string').slice(-20) : [],
  }
}

export function loadState(): ServiceState {
  const clean = emptyState()
  if (!fs.existsSync(statePath)) return clean
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<ServiceState>
    clean.lastCycleAt = isIsoDate(raw.lastCycleAt) ? raw.lastCycleAt : null
    clean.cycles = finite(raw.cycles) ? Math.max(0, Math.floor(raw.cycles)) : 0
    clean.errors = finite(raw.errors) ? Math.max(0, Math.floor(raw.errors)) : 0
    for (const [key, value] of Object.entries(raw.tracks ?? {})) {
      const track = sanitizeTrack(key, value)
      if (track) clean.tracks[key] = track
    }
    for (const [key, value] of Object.entries(raw.wallets ?? {})) {
      const wallet = sanitizeWallet(key, value)
      if (wallet) clean.wallets[key] = wallet
    }
    clean.signals = Array.isArray(raw.signals)
      ? raw.signals.slice(-200).map(sanitizeSignal).filter((signal): signal is RunnerSignal => signal !== null)
      : []
  } catch {
    clean.errors++
    try { fs.renameSync(statePath, `${statePath}.corrupt-${Date.now()}`) } catch { /* best effort quarantine */ }
  }
  return clean
}

export function saveState(state: ServiceState): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const temp = `${statePath}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(state, null, 2))
  fs.renameSync(temp, statePath)
}
