import fs from 'node:fs'
import { atomicWriteSync, dataPath, fetchWithTimeout } from './storage'

// Auto-scan engine: periodically POSTs to the local /api/scan endpoint so
// signals accumulate without anyone pressing SCAN. State persists across
// restarts via data/autoscan.json.
// Now passes minScore to match manual scan parity, and auto-trades signals
// that cross AUTO_TRADE_MIN_SCORE.

const STATE_PATH = dataPath('autoscan.json')
const INTERVAL_MS = 5 * 60_000 // 5 min, matches the Telegram bot cadence

type TokenEntry = { symbol: string; chain: string; score?: number; reason: string }
type RunEntry = { at: string; result: string; scanned?: TokenEntry[]; candidates?: TokenEntry[]; rugs?: TokenEntry[]; autoTraded?: string[] }

type AutoScanState = {
  enabled: boolean
  lastRunAt: string | null
  lastResult: string | null
  runs: number
  errors: number
  history?: RunEntry[]
}

const state: AutoScanState = loadState()
let timer: ReturnType<typeof setInterval> | null = null
let running = false

function loadState(): AutoScanState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return {
      enabled: Boolean(raw.enabled),
      lastRunAt: raw.lastRunAt ?? null,
      lastResult: raw.lastResult ?? null,
      runs: raw.runs ?? 0,
      errors: raw.errors ?? 0,
      history: Array.isArray(raw.history) ? raw.history.slice(-50) : [],
    }
  } catch {
    return { enabled: false, lastRunAt: null, lastResult: null, runs: 0, errors: 0, history: [] }
  }
}

function persist() {
  atomicWriteSync(STATE_PATH, JSON.stringify(state, null, 2))
}

async function runOnce() {
  if (running) return
  running = true
  const port = process.env.PORT || '3000'
  try {
    const resp = await fetchWithTimeout(`http://localhost:${port}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` },
      body: JSON.stringify({
        chains: ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'],
        minScore: 65,
        autoTrade: true,
      }),
    }, 90_000)
    if (!resp.ok) throw new Error(`scan HTTP ${resp.status}`)
    const body = await resp.json()

    try {
      const result = await fetchWithTimeout(
        `http://localhost:${port}/api/stats?resolve=1`,
        { method: 'GET' },
        60_000,
      )
      if (!result.ok) throw new Error(`stats HTTP ${result.status}`)
    } catch (error) {
      console.warn('[auto-scan] outcome refresh failed:', (error as Error).message)
    }
    try {
      const result = await fetchWithTimeout(`http://localhost:${port}/api/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` },
        body: JSON.stringify({ action: 'refresh' }),
      }, 30_000)
      if (!result.ok) throw new Error(`trades HTTP ${result.status}`)
    } catch (error) {
      console.warn('[auto-scan] trade refresh failed:', (error as Error).message)
    }

    const meta = body?.meta
    const autoTraded = (body?.autoTraded ?? []) as string[]
    state.lastRunAt = new Date().toISOString()
    state.runs++
    state.lastResult = meta
      ? `scanned=${meta.scanned} candidates=${meta.candidates} rugs=${meta.rugsDropped}${autoTraded.length ? ` autoTraded=${autoTraded.length}` : ''}`
      : 'ok'
    const entry: RunEntry = { at: state.lastRunAt, result: state.lastResult }
    if (body?.details && typeof body.details === 'object') {
      entry.scanned = Array.isArray(body.details.scanned) ? body.details.scanned : []
      entry.candidates = Array.isArray(body.details.candidates) ? body.details.candidates : []
      entry.rugs = Array.isArray(body.details.rugs) ? body.details.rugs : []
    }
    if (autoTraded.length) entry.autoTraded = autoTraded
    if (!Array.isArray(state.history)) state.history = []
    state.history.push(entry)
    if (state.history.length > 50) state.history = state.history.slice(-50)
    console.log('[auto-scan]', state.lastResult)
  } catch (error) {
    state.errors++
    state.lastResult = `error: ${(error as Error).message}`
    if (!Array.isArray(state.history)) state.history = []
    state.history.push({ at: new Date().toISOString(), result: state.lastResult })
    if (state.history.length > 50) state.history = state.history.slice(-50)
    console.warn('[auto-scan] failed:', (error as Error).message)
  } finally {
    persist()
    running = false
  }
}

function startTimer() {
  if (timer) return
  timer = setInterval(() => {
    void runOnce()
  }, INTERVAL_MS)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getAutoScanState(): AutoScanState & { intervalMinutes: number } {
  return { ...state, history: [...(state.history ?? [])].reverse(), intervalMinutes: INTERVAL_MS / 60_000 }
}

export function setAutoScanEnabled(enabled: boolean): AutoScanState & { intervalMinutes: number } {
  state.enabled = enabled
  if (enabled) {
    startTimer()
    void runOnce() // immediate first cycle on enable
  } else {
    stopTimer()
  }
  persist()
  return getAutoScanState()
}

// Restore a previously-enabled schedule after a server restart.
export function initAutoScan() {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return
  if (state.enabled && !timer) {
    startTimer()
    setTimeout(() => void runOnce(), 2_000)
  }
}
