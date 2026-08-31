import fs from 'node:fs'
import { atomicWriteSync, dataPath, fetchWithTimeout } from './storage'

// Auto-scan engine: periodically POSTs to the local /api/scan endpoint so
// signals accumulate without anyone pressing SCAN. State persists across
// restarts via data/autoscan.json.
// Now passes minScore to match manual scan parity, and auto-trades signals
// that cross AUTO_TRADE_MIN_SCORE.

const STATE_PATH = dataPath('autoscan.json')
const DEFAULT_INTERVAL_MS = 5 * 60_000
const MIN_INTERVAL_MS = 30_000
const MAX_INTERVAL_MS = 24 * 60 * 60_000
const CONFIG_REFRESH_INTERVAL_MS = 30_000

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

type IntervalConfigLoader = () => Promise<{ pollIntervalMs: unknown }>
type AutoScanRuntime = {
  state: AutoScanState
  timer: ReturnType<typeof setInterval> | null
  running: boolean
  intervalMs: number
  initializationStarted: boolean
  intervalConfigLoader: IntervalConfigLoader | null
  configRefreshTimer: ReturnType<typeof setInterval> | null
  configRefreshPromise: Promise<void> | null
}

const AUTO_SCAN_RUNTIME = Symbol.for('degenescan.autoscan.runtime')
const runtimeHost = globalThis as unknown as { [key: symbol]: AutoScanRuntime | undefined }
const runtime = runtimeHost[AUTO_SCAN_RUNTIME] ?? {
  state: loadState(),
  timer: null,
  running: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  initializationStarted: false,
  intervalConfigLoader: null,
  configRefreshTimer: null,
  configRefreshPromise: null,
}
runtimeHost[AUTO_SCAN_RUNTIME] = runtime

export function normalizeAutoScanIntervalMs(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(parsed)))
}

export function isExpectedScanContention(status: number): boolean {
  return status === 409
}

async function refreshConfiguredInterval(): Promise<void> {
  if (!runtime.intervalConfigLoader) return
  if (runtime.configRefreshPromise) return runtime.configRefreshPromise
  runtime.configRefreshPromise = (async () => {
    try {
      setAutoScanInterval((await runtime.intervalConfigLoader!()).pollIntervalMs)
    } catch (error) {
      console.warn('[auto-scan] interval refresh failed:', (error as Error).message)
    }
  })()
  try {
    await runtime.configRefreshPromise
  } finally {
    runtime.configRefreshPromise = null
  }
}

function startConfigRefreshTimer(): void {
  if (runtime.configRefreshTimer || !runtime.intervalConfigLoader) return
  runtime.configRefreshTimer = setInterval(() => {
    void refreshConfiguredInterval()
  }, CONFIG_REFRESH_INTERVAL_MS)
}

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
  atomicWriteSync(STATE_PATH, JSON.stringify(runtime.state, null, 2))
}

async function runOnce() {
  if (runtime.running) return
  runtime.running = true
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
    if (isExpectedScanContention(resp.status)) {
      // A manual scan (or another route instance) owns the shared scan lock.
      // This is expected contention, not an autoscan failure; preserve the
      // last successful result and let the next scheduled cycle try again.
      console.info('[auto-scan] skipped: scan already in progress')
      return
    }
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
    const admission = meta?.legendAdmissionDiagnostics
    const admissionReasons = admission && typeof admission.reasons === 'object' && admission.reasons
      ? Object.entries(admission.reasons as Record<string, unknown>)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0)
          .map(([reason, count]) => `${reason}=${count}`)
          .join(',')
      : ''
    const admissionStatus = admission
      && Number.isFinite(admission.evaluated)
      && Number.isFinite(admission.eligible)
      && Number.isFinite(admission.rejected)
      ? ` legendNew=${admission.eligible}/${admission.evaluated} rejected=${admission.rejected}${admissionReasons ? `(${admissionReasons})` : ''}`
      : ''
    runtime.state.lastRunAt = new Date().toISOString()
    runtime.state.runs++
    runtime.state.lastResult = meta
      ? `scanned=${meta.scanned} candidates=${meta.candidates} pool=${meta.candidatePool ?? 0} promoted=${meta.candidatePromotions ?? 0} legends=${meta.legendPool ?? 0}${admissionStatus} rugs=${meta.rugsDropped}${autoTraded.length ? ` autoTraded=${autoTraded.length}` : ''}`
      : 'ok'
    const entry: RunEntry = { at: runtime.state.lastRunAt, result: runtime.state.lastResult }
    if (body?.details && typeof body.details === 'object') {
      entry.scanned = Array.isArray(body.details.scanned) ? body.details.scanned : []
      entry.candidates = Array.isArray(body.details.candidates) ? body.details.candidates : []
      entry.rugs = Array.isArray(body.details.rugs) ? body.details.rugs : []
    }
    if (autoTraded.length) entry.autoTraded = autoTraded
    if (!Array.isArray(runtime.state.history)) runtime.state.history = []
    runtime.state.history.push(entry)
    if (runtime.state.history.length > 50) runtime.state.history = runtime.state.history.slice(-50)
    console.log('[auto-scan]', runtime.state.lastResult)
  } catch (error) {
    runtime.state.errors++
    runtime.state.lastResult = `error: ${(error as Error).message}`
    if (!Array.isArray(runtime.state.history)) runtime.state.history = []
    runtime.state.history.push({ at: new Date().toISOString(), result: runtime.state.lastResult })
    if (runtime.state.history.length > 50) runtime.state.history = runtime.state.history.slice(-50)
    console.warn('[auto-scan] failed:', (error as Error).message)
  } finally {
    persist()
    try {
      await refreshConfiguredInterval()
    } finally {
      runtime.running = false
    }
  }
}

function startTimer() {
  if (runtime.timer) return
  runtime.timer = setInterval(() => {
    void runOnce()
  }, runtime.intervalMs)
}

function stopTimer() {
  if (runtime.timer) {
    clearInterval(runtime.timer)
    runtime.timer = null
  }
}

export function getAutoScanState(): AutoScanState & { intervalMinutes: number } {
  return { ...runtime.state, history: [...(runtime.state.history ?? [])].reverse(), intervalMinutes: runtime.intervalMs / 60_000 }
}

export function setAutoScanInterval(value: unknown): AutoScanState & { intervalMinutes: number } {
  const next = normalizeAutoScanIntervalMs(value)
  if (next === runtime.intervalMs) return getAutoScanState()
  runtime.intervalMs = next
  if (runtime.state.enabled) {
    stopTimer()
    startTimer()
  }
  return getAutoScanState()
}

export function setAutoScanEnabled(enabled: boolean): AutoScanState & { intervalMinutes: number } {
  runtime.state.enabled = enabled
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
export async function initAutoScan(configLoader?: IntervalConfigLoader): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return
  if (runtime.initializationStarted) return
  runtime.initializationStarted = true
  runtime.intervalConfigLoader = configLoader ?? null
  if (runtime.intervalConfigLoader) {
    await refreshConfiguredInterval()
    startConfigRefreshTimer()
  }
  if (runtime.state.enabled && !runtime.timer) {
    startTimer()
    setTimeout(() => void runOnce(), 2_000)
  }
}
