import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceTrack, qualifyWallet, unseenTrades } from './engine.js'
import { normalizeIntervalMs, normalizePort } from './config.js'
import { parseRugReport } from './sources.js'
import { sanitizeText } from './validation.js'
import type { Snapshot, TokenTrack, WalletStats } from './types.js'

const snap = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  at: '2026-08-30T10:00:00.000Z', priceUsd: 0.001, liquidityUsd: 8_000,
  volumeH1Usd: 2_000, h1Buyers: 20, h1Sellers: 8, m15Buyers: 8,
  totalHolders: 100, buyTrades: [], rugSafe: true, ...overrides,
})

const track = (): TokenTrack => ({
  mint: 'mint', poolAddress: 'pool', symbol: 'RUN', name: 'Runner',
  createdAt: '2026-08-30T09:30:00.000Z', discoveredAt: '2026-08-30T09:35:00.000Z',
  stage: 'DISCOVERED', snapshots: [], stageTimes: {}, reasons: [], alerted: false, seenTradeIds: [],
})

test('requires the evidence sequence before declaring a runner', () => {
  let t = advanceTrack(track(), snap())
  assert.equal(t.stage, 'ORGANIC')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:06:00.000Z', liquidityUsd: 11_000, totalHolders: 105 }))
  assert.equal(t.stage, 'LIQUIDITY_GROWING')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:12:00.000Z', liquidityUsd: 12_000, totalHolders: 130, buyTrades: [{ id: 'old', wallet: 'smart', at: '2026-08-30T10:11:00.000Z', priceUsd: 0.001 }] }), new Set(['smart']))
  assert.equal(t.stage, 'HOLDERS_ACCELERATING')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:13:00.000Z', liquidityUsd: 12_500, totalHolders: 135, buyTrades: [{ id: 'old', wallet: 'smart', at: '2026-08-30T10:11:00.000Z', priceUsd: 0.001 }] }), new Set(['smart']))
  assert.equal(t.stage, 'HOLDERS_ACCELERATING')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:14:00.000Z', liquidityUsd: 12_500, totalHolders: 136, buyTrades: [{ id: 'new', wallet: 'smart', at: '2026-08-30T10:14:00.000Z', priceUsd: 0.0012 }] }), new Set(['smart']))
  assert.equal(t.stage, 'RUNNER')
})

test('holder growth must accelerate rather than merely increase', () => {
  let t = advanceTrack(track(), snap())
  t = advanceTrack(t, snap({ at: '2026-08-30T10:06:00.000Z', liquidityUsd: 11_000, totalHolders: 120 }))
  assert.equal(t.stage, 'LIQUIDITY_GROWING')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:12:00.000Z', liquidityUsd: 12_000, totalHolders: 140 }))
  assert.equal(t.stage, 'LIQUIDITY_GROWING')
})

test('flat or declining prior holder velocity cannot count as acceleration', () => {
  let t = advanceTrack(track(), snap())
  t = advanceTrack(t, snap({ at: '2026-08-30T10:06:00.000Z', liquidityUsd: 11_000, totalHolders: 100 }))
  t = advanceTrack(t, snap({ at: '2026-08-30T10:12:00.000Z', liquidityUsd: 12_000, totalHolders: 130 }))
  assert.equal(t.stage, 'LIQUIDITY_GROWING')
})

test('recovers holder baseline after a temporary holder-data outage', () => {
  let t = advanceTrack(track(), snap({ totalHolders: 0, rugSafe: null }))
  assert.equal(t.stage, 'ORGANIC')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:06:00.000Z', liquidityUsd: 11_000, totalHolders: 100 }))
  assert.equal(t.stage, 'LIQUIDITY_GROWING')
  t = advanceTrack(t, snap({ at: '2026-08-30T10:12:00.000Z', liquidityUsd: 12_000, totalHolders: 105 }))
  t = advanceTrack(t, snap({ at: '2026-08-30T10:18:00.000Z', liquidityUsd: 13_000, totalHolders: 130 }))
  assert.equal(t.stage, 'HOLDERS_ACCELERATING')
})

test('does not advance on wash-like volume or unsafe rugcheck', () => {
  assert.equal(advanceTrack(track(), snap({ h1Buyers: 2, volumeH1Usd: 40_000 })).stage, 'DISCOVERED')
  assert.equal(advanceTrack(track(), snap({ rugSafe: false })).stage, 'REJECTED')
})

test('invalid intervals cannot create a hot loop', () => {
  assert.equal(normalizeIntervalMs('broken'), 60_000)
  assert.equal(normalizeIntervalMs(1), 30_000)
  assert.equal(normalizeIntervalMs(99_000_000), 600_000)
  assert.equal(normalizePort('bad'), 8080)
  assert.equal(normalizePort(70_000), 8080)
})

test('malformed RugCheck reports never become safe', () => {
  assert.deepEqual(parseRugReport({}), { totalHolders: null, rugSafe: null })
  assert.deepEqual(parseRugReport({ rugged: false, mintAuthority: null, freezeAuthority: null, risks: [], totalHolders: 12 }), { totalHolders: 12, rugSafe: true })
})

test('processed trade IDs cannot replay as new entries', () => {
  const trades = [{ id: 'old', wallet: '11111111111111111111111111111111', at: '2026-08-30T10:00:00.000Z', priceUsd: 1 }]
  assert.equal(unseenTrades(trades, ['old']).length, 0)
})

test('display metadata strips control and bidi characters', () => {
  assert.equal(sanitizeText('\u202eNEW\u0000', 32), 'NEW')
})

test('wallet quality requires a real resolved track record', () => {
  const weak: WalletStats = { wallet: 'w', wins: 2, losses: 0, resolved: 2, sumMultiple: 4, picks: {} }
  const good: WalletStats = { wallet: 'w', wins: 2, losses: 1, resolved: 3, sumMultiple: 5, picks: {} }
  assert.equal(qualifyWallet(weak), false)
  assert.equal(qualifyWallet(good), true)
})
