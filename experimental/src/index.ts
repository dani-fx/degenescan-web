import http from 'node:http'
import { normalizeIntervalMs, normalizePort } from './config.js'
import { getState, isCycleRunning, runCycle } from './runner.js'

const port = normalizePort(process.env.PORT)
const intervalMs = normalizeIntervalMs(process.env.POLL_INTERVAL_MS)

function publicState() {
  const state = getState()
  const stages = Object.values(state.tracks).reduce<Record<string, number>>((out, track) => { out[track.stage] = (out[track.stage] || 0) + 1; return out }, {})
  return {
    service: 'Experimental', mode: 'shadow', affectsTrading: false, chain: 'solana',
    startedAt: state.startedAt, lastCycleAt: state.lastCycleAt, cycles: state.cycles,
    errors: state.errors, running: isCycleRunning(), stages, tracked: Object.keys(state.tracks).length,
    learnedWallets: Object.keys(state.wallets).length, signals: state.signals.length, intervalMs,
  }
}

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  if (request.method === 'GET' && (request.url === '/' || request.url?.startsWith('/health'))) {
    response.end(JSON.stringify(publicState()))
    return
  }
  if (request.method === 'GET' && request.url?.startsWith('/signals')) {
    const signals = [...getState().signals].reverse().slice(0, 50).map(({ qualifiedWallets, ...signal }) => ({
      ...signal, qualifiedWalletCount: qualifiedWallets.length,
    }))
    response.end(JSON.stringify({ mode: 'shadow', affectsTrading: false, signals }))
    return
  }
  if (request.method === 'GET' && request.url?.startsWith('/tracks')) {
    const tracks = Object.values(getState().tracks).sort((a, b) => Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt)).slice(0, 50).map((track) => {
      const latest = track.snapshots.at(-1)
      return {
        mint: track.mint, poolAddress: track.poolAddress, symbol: track.symbol, stage: track.stage,
        createdAt: track.createdAt, discoveredAt: track.discoveredAt, lastObservedAt: latest?.at ?? null,
        liquidityUsd: latest?.liquidityUsd ?? null, totalHolders: latest?.totalHolders ?? null,
        reasons: track.reasons.slice(-5),
      }
    })
    response.end(JSON.stringify({ tracks }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'not found' }))
})

server.listen(port, () => {
  console.log(`[experimental] listening on :${port}; shadow=true; trading=false; intervalMs=${intervalMs}`)
  void runCycle()
})

setInterval(() => void runCycle(), intervalMs)

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
