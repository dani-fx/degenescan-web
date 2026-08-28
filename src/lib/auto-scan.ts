import fs from 'node:fs'
import path from 'node:path'

// Auto-scan engine: periodically POSTs to the local /api/scan endpoint so
// signals accumulate without anyone pressing SCAN. State persists across
// restarts via data/autoscan.json.
// Now passes minScore to match manual scan parity, and auto-trades signals
// that cross AUTO_TRADE_MIN_SCORE.

const STATE_PATH = path.join('/home/dani/degenescan-web/data', 'autoscan.json')
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

let state: AutoScanState = loadState()
let timer: ReturnType<typeof setInterval> | null = null

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
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

async function runOnce() {
  const port = process.env.PORT || '3000'
  try {
    const resp = await fetch(`http://localhost:${port}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chains: ['solana', 'base', 'ethereum', 'bsc', 'arbitrum'],
        minScore: 65,           // parity with manual scan default
        autoTrade: true,        // open simulated trades for signals >= 85
      }),
    })
    const body = await resp.json()
    // Resolve pending outcome checkpoints (15m/30m/60m/120m) each cycle.
    try {
      await fetch(`http://localhost:${port}/api/stats?resolve=1`, { method: 'GET' })
    } catch {}
    // Also refresh open trade prices each cycle.
    try {
      await fetch(`http://localhost:${port}/api/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: true }),
      })
    } catch {}

    const meta = body?.meta
    const autoTraded = (body?.autoTraded ?? []) as string[]
    state.lastRunAt = new Date().toISOString()
    state.lastResult = meta
      ? `scanned=${meta.scanned} candidates=${meta.candidates} rugs=${meta.rugsDropped}${autoTraded.length ? ` autoTraded=${autoTraded.length}` : ''}`
      : 'ok'
    const entry: RunEntry = { at: state.lastRunAt, result: state.lastResult }
    if (body?.details && typeof body.details === 'object') {
      entry.scanned = Array.isArray(body.details.scanned) ? body.details.scanned : []
      entry.candidates = Array.isArray(body.details.candidates) ? body.details.candidates : []
      entry.rugs = Array.isArray(body.details.rugs) ? body.details.rugs : []
    }
    if (Array.isArray(autoTraded) && autoTraded.length > 0) {
      entry.autoTraded = autoTraded
    }
    if (!Array.isArray(state.history)) state.history = []
    state.history.push(entry)
    if (state.history.length > 50) state.history = state.history.slice(-50)
    console.log('[auto-scan]', state.lastResult)
  } catch (e) {
    state.errors++
    state.lastResult = `error: ${(e as Error).message}`
    if (!Array.isArray(state.history)) state.history = []
    state.history.push({ at: new Date().toISOString(), result: state.lastResult })
    if (state.history.length > 50) state.history = state.history.slice(-50)
    console.warn('[auto-scan] failed:', (e as Error).message)
  }
  persist()
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
  if (state.enabled) startTimer()
}
