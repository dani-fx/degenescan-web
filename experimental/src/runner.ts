import { advanceTrack, percentageGrowth, qualifyWallet, unseenTrades } from './engine.js'
import { notify } from './notify.js'
import { enrich, fetchCandidates, type PoolCandidate } from './sources.js'
import { loadState, saveState } from './store.js'
import type { BuyTrade, RunnerSignal, ServiceState, TokenTrack, WalletStats } from './types.js'

const MAX_ENRICH_PER_CYCLE = 12
const MAX_TRACKS = 500
const MAX_WALLETS = 5_000
const MAX_PICKS_PER_WALLET = 25
const TRACK_NEWER_THAN_MS = 90 * 60_000
const state = loadState()
let cyclePromise: Promise<void> | null = null

const stagePriority: Record<TokenTrack['stage'], number> = {
  HOLDERS_ACCELERATING: 0, LIQUIDITY_GROWING: 1, ORGANIC: 2, DISCOVERED: 3, RUNNER: 4, REJECTED: 5,
}

function walletStats(wallet: string): WalletStats {
  return state.wallets[wallet] ??= { wallet, wins: 0, losses: 0, resolved: 0, sumMultiple: 0, picks: {} }
}

function updateWalletLearning(track: TokenTrack, priceUsd: number, trades: BuyTrade[], now: string): void {
  if (!(priceUsd > 0)) return
  for (const stats of Object.values(state.wallets)) {
    const pick = stats.picks[track.mint]
    if (!pick || pick.resolved) continue
    pick.bestPrice = Math.max(pick.bestPrice, priceUsd)
    const bestMultiple = pick.bestPrice / pick.entryPrice
    const ageMs = Date.parse(now) - Date.parse(pick.enteredAt)
    if (bestMultiple >= 2 || ageMs >= 90 * 60_000) {
      const multiple = bestMultiple >= 2 ? bestMultiple : priceUsd / pick.entryPrice
      pick.multiple = multiple
      pick.resolved = true
      stats.resolved++
      stats.sumMultiple += multiple
      if (multiple >= 1.5) stats.wins++
      else stats.losses++
    }
  }
  for (const trade of trades) {
    const tradeAge = Date.parse(trade.at) - Date.parse(track.createdAt)
    if (tradeAge < 0 || tradeAge > TRACK_NEWER_THAN_MS) continue
    const stats = walletStats(trade.wallet)
    if (!stats.picks[track.mint]) {
      stats.picks[track.mint] = { mint: track.mint, enteredAt: trade.at, entryPrice: trade.priceUsd, bestPrice: trade.priceUsd, resolved: false }
    }
    const keys = Object.keys(stats.picks)
    if (keys.length > MAX_PICKS_PER_WALLET) for (const key of keys.slice(0, keys.length - MAX_PICKS_PER_WALLET)) delete stats.picks[key]
  }
}

function qualifiedWalletSet(): Set<string> {
  return new Set(Object.values(state.wallets).filter(qualifyWallet).map((w) => w.wallet))
}

function newTrack(pool: PoolCandidate): TokenTrack {
  return {
    mint: pool.mint, poolAddress: pool.poolAddress, symbol: pool.symbol, name: pool.name,
    createdAt: pool.createdAt, discoveredAt: new Date().toISOString(), stage: 'DISCOVERED',
    snapshots: [], stageTimes: {}, reasons: [], alerted: false, seenTradeIds: [],
  }
}

function signalFor(track: TokenTrack, qualified: Set<string>): RunnerSignal {
  const latest = track.snapshots.at(-1)!
  const organicLiquidity = track.organicBaseline?.liquidityUsd || latest.liquidityUsd
  const holderBaseline = track.holderBaseline?.totalHolders || latest.totalHolders || 0
  return {
    mint: track.mint, poolAddress: track.poolAddress, symbol: track.symbol, stage: track.stage,
    detectedAt: latest.at,
    liquidityGrowthPct: percentageGrowth(latest.liquidityUsd, organicLiquidity),
    holderGrowthPct: percentageGrowth(latest.totalHolders || 0, holderBaseline),
    qualifiedWallets: latest.buyTrades.map((trade) => trade.wallet).filter((wallet) => qualified.has(wallet)), reasons: [...track.reasons],
  }
}

async function doCycle(): Promise<void> {
  const pools = await fetchCandidates()
  const poolByTrack = new Map(pools.map((pool) => [`${pool.mint}:${pool.poolAddress}`, pool]))
  const now = Date.now()
  for (const pool of pools) {
    if (!state.tracks[pool.mint] && now - Date.parse(pool.createdAt) <= TRACK_NEWER_THAN_MS) state.tracks[pool.mint] = newTrack(pool)
  }
  const work = Object.values(state.tracks)
    .filter((track) => poolByTrack.has(`${track.mint}:${track.poolAddress}`) && track.stage !== 'RUNNER' && track.stage !== 'REJECTED')
    .sort((a, b) => {
      const stageDelta = stagePriority[a.stage] - stagePriority[b.stage]
      if (stageDelta) return stageDelta
      const aObserved = a.snapshots.at(-1)?.at || a.discoveredAt
      const bObserved = b.snapshots.at(-1)?.at || b.discoveredAt
      return Date.parse(aObserved) - Date.parse(bObserved)
    })
    .slice(0, MAX_ENRICH_PER_CYCLE)

  for (let i = 0; i < work.length; i += 3) {
    await Promise.all(work.slice(i, i + 3).map(async (track) => {
      const pool = poolByTrack.get(`${track.mint}:${track.poolAddress}`)!
      const rawSnapshot = await enrich(pool)
      const newTrades = unseenTrades(rawSnapshot.buyTrades, track.seenTradeIds ?? [])
      const snapshot = { ...rawSnapshot, buyTrades: newTrades }
      updateWalletLearning(track, snapshot.priceUsd, newTrades, snapshot.at)
      const qualified = qualifiedWalletSet()
      let advanced = advanceTrack({
        ...track, symbol: pool.symbol, name: pool.name,
        seenTradeIds: [...(track.seenTradeIds ?? []), ...newTrades.map((trade) => trade.id)].slice(-500),
      }, snapshot, qualified)
      if (advanced.stage === 'RUNNER' && !advanced.alerted) {
        const signal = signalFor(advanced, qualified)
        state.signals.push(signal)
        advanced.alerted = true
        console.log('[experimental] RUNNER', JSON.stringify(signal))
        try { await notify(signal) } catch (error) { console.warn('[experimental] notify failed:', (error as Error).message) }
      }
      advanced = {
        ...advanced,
        snapshots: advanced.snapshots.map((entry, index, all) => index === all.length - 1 ? entry : { ...entry, buyTrades: [] }),
      }
      state.tracks[track.mint] = advanced
    }))
  }
  state.signals = state.signals.slice(-200)
  const tracks = Object.values(state.tracks)
    .sort((a, b) => stagePriority[a.stage] - stagePriority[b.stage] || Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt))
    .slice(0, MAX_TRACKS)
  state.tracks = Object.fromEntries(tracks.map((track) => [track.mint, track]))
  const wallets = Object.values(state.wallets)
    .sort((a, b) => {
      const qualityDelta = Number(qualifyWallet(b)) - Number(qualifyWallet(a))
      if (qualityDelta) return qualityDelta
      const latest = (stats: WalletStats) => Math.max(0, ...Object.values(stats.picks).map((pick) => Date.parse(pick.enteredAt)))
      return latest(b) - latest(a)
    })
    .slice(0, MAX_WALLETS)
  state.wallets = Object.fromEntries(wallets.map((wallet) => [wallet.wallet, wallet]))
  state.lastCycleAt = new Date().toISOString()
  state.cycles++
  saveState(state)
  const counts = Object.values(state.tracks).reduce<Record<string, number>>((out, t) => { out[t.stage] = (out[t.stage] || 0) + 1; return out }, {})
  console.log('[experimental] cycle', JSON.stringify({ discovered: pools.length, enriched: work.length, stages: counts, qualifiedWallets: qualifiedWalletSet().size }))
}

export function runCycle(): Promise<void> {
  if (cyclePromise) return cyclePromise
  cyclePromise = doCycle().catch((error) => {
    state.errors++
    state.lastCycleAt = new Date().toISOString()
    try { saveState(state) } catch (saveError) { console.error('[experimental] state save failed:', saveError) }
    console.error('[experimental] cycle failed:', error)
  }).finally(() => { cyclePromise = null })
  return cyclePromise
}

export function getState(): ServiceState { return state }
export function isCycleRunning(): boolean { return cyclePromise !== null }
