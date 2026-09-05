import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoredToken } from './types'

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-store-test-'))
  process.env.DATA_DIR = dataDir
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DATA_DIR
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('sql.js trade lifecycle', () => {
  it.each([{ price: 1.5, pnl: 50 }, { price: 0.01, pnl: -99 }, { price: 1, pnl: 0 }])('persists a manual close with final PnL $pnl%', async ({ price, pnl }) => {
    let store = await import('./trade-store')
    await store.openTrade('manual', 'MANUAL', 'base', '0x1', 1, 80, 'A')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ pairs: [
      { chainId: 'base', baseToken: { address: '0x1' }, priceUsd: String(price) },
    ] }))))
    await expect(store.closeTrade('manual', true)).resolves.toBe(true)
    vi.resetModules()
    store = await import('./trade-store')
    const trades = await store.getAllTrades()
    expect(trades[0]).toMatchObject({ status: 'closed', current_price_usd: price, pnl_pct: pnl })
    expect(trades[0].checkpoints).toContainEqual(expect.objectContaining({ label: 'manual_close', price_usd: price, pnl_pct: pnl }))
    expect(store.computeTradeStats(trades)).toMatchObject({ openTrades: 0, closedTrades: 1, totalPnlPct: pnl })
  })
  it('rejects non-finite entry prices and falls back from invalid discovery prices', async () => {
    const store = await import('./trade-store')
    await expect(store.openTrade('invalid', 'BAD', 'base', '0x1', Infinity, 80, 'A')).resolves.toBeNull()
    const trade = await store.openTrade('valid', 'OK', 'base', '0x2', 1, 80, 'A', Infinity)
    expect(trade?.discovery_price_usd).toBe(1)
  })

  it('ignores non-finite provider quotes without corrupting the trade or checkpoints', async () => {
    const store = await import('./trade-store')
    await store.openTrade('quote', 'QUOTE', 'base', '0x1', 1, 80, 'A')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ pairs: [
      { chainId: 'base', baseToken: { address: '0x1' }, priceUsd: 'Infinity' },
    ] }))))
    await expect(store.refreshAllTradePrices()).resolves.toEqual({ refreshed: 0, failed: 1 })
    expect((await store.getAllTrades())[0]).toMatchObject({ current_price_usd: 1, pnl_pct: 0 })
    await expect(store.closeTrade('quote', true)).resolves.toBe(true)
    expect((await store.getAllTrades())[0]).toMatchObject({ current_price_usd: 1, pnl_pct: 0, status: 'closed' })
  })

  it('prevents duplicate opens, permits a retrade after close, and caps open positions at three', async () => {
    const store = await import('./trade-store')

    const first = await store.openTrade('signal-1', 'ONE', 'ETH', '0xAbC', 1, 80, 'A', 0.8, '2026-08-29T10:00:00.000Z')
    expect(first).toMatchObject({
      signal_id: 'signal-1', chain: 'ethereum', address: '0xabc', status: 'open',
      discovery_price_usd: 0.8, discovery_at: '2026-08-29T10:00:00.000Z',
    })
    expect(first?.checkpoints).toMatchObject([{ label: 'entry', price_usd: 1, pnl_pct: 0 }])

    await expect(store.openTrade('signal-duplicate', 'ONE', 'ethereum', '0xabc', 1, 80, 'A')).resolves.toBeNull()
    await expect(store.closeTrade('signal-1')).resolves.toBe(true)
    await expect(store.closeTrade('signal-1')).resolves.toBe(false)

    const retrade = await store.openTrade('signal-2', 'ONE', 'ethereum', '0xABC', 2, 75, 'B')
    expect(retrade).toMatchObject({ signal_id: 'signal-2', address: '0xabc', status: 'open' })
    expect(retrade?.id).not.toBe(first?.id)

    expect(await store.openTrade('signal-3', 'TWO', 'base', '0x2', 1, 70, 'B')).not.toBeNull()
    expect(await store.openTrade('signal-4', 'THREE', 'solana', 'MintThree', 1, 65, 'C')).not.toBeNull()
    await expect(store.openTrade('signal-5', 'FOUR', 'bsc', '0x4', 1, 90, 'A')).resolves.toBeNull()

    const trades = await store.getAllTrades()
    expect(store.computeTradeStats(trades)).toMatchObject({ totalTrades: 4, openTrades: 3, closedTrades: 1 })
    expect(fs.existsSync(path.join(dataDir, 'trades.sqlite'))).toBe(true)
  })

  it('deduplicates legacy checkpoints before adding the uniqueness index', async () => {
    const initSqlJs = (await import('sql.js/dist/sql-asm.js')).default
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(`CREATE TABLE trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, signal_id TEXT NOT NULL UNIQUE, symbol TEXT NOT NULL,
      chain TEXT NOT NULL, address TEXT NOT NULL, entry_price_usd REAL NOT NULL,
      entry_score INTEGER NOT NULL, entry_tier TEXT NOT NULL, entry_at TEXT NOT NULL,
      current_price_usd REAL NOT NULL, pnl_pct REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT ''
    )`)
    db.run(`CREATE TABLE trade_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT, trade_id INTEGER NOT NULL, label TEXT NOT NULL,
      price_usd REAL NOT NULL, pnl_pct REAL NOT NULL, at TEXT NOT NULL
    )`)
    db.run("INSERT INTO trades (signal_id,symbol,chain,address,entry_price_usd,current_price_usd,pnl_pct,entry_score,entry_tier,entry_at,status,note) VALUES ('legacy','LEG','ethereum','0x1',1,1,0,80,'A','2026-01-01T00:00:00.000Z','open','')")
    db.run("INSERT INTO trade_checkpoints (trade_id,label,price_usd,pnl_pct,at) VALUES (1,'15m',1,0,'2026-01-01T00:15:00.000Z'),(1,'15m',1.1,10,'2026-01-01T00:16:00.000Z')")
    fs.writeFileSync(path.join(dataDir, 'trades.sqlite'), Buffer.from(db.export()))
    db.close()

    const store = await import('./trade-store')
    const trades = await store.getAllTrades()
    expect(trades).toHaveLength(1)
    expect(trades[0].checkpoints.filter((checkpoint) => checkpoint.label === '15m')).toHaveLength(1)
  })
})

describe('tracked signal migration', () => {
  it('rewrites legacy raw-address IDs to canonical chain/address IDs', async () => {
    const initSqlJs = (await import('sql.js/dist/sql-asm.js')).default
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run('CREATE TABLE signals (id TEXT PRIMARY KEY, tracked_at TEXT NOT NULL, data TEXT NOT NULL)')
    const token = { symbol: 'LEG', chain: 'ethereum', address: '0xAbC', score: 70, tier: 'B', priceUsd: 1 }
    const legacyTracked = { id: '0xAbC', token, trackedAt: '2026-01-01T00:00:00.000Z', lastRefreshedAt: '2026-01-01T00:00:00.000Z', outcomes: [] }
    db.run('INSERT INTO signals (id, tracked_at, data) VALUES (?, ?, ?)', ['0xAbC', legacyTracked.trackedAt, JSON.stringify(legacyTracked)])
    fs.writeFileSync(path.join(dataDir, 'signals.sqlite'), Buffer.from(db.export()))
    db.close()

    const store = await import('./signal-store')
    const tracked = await store.getTrackedSignals()
    expect(tracked).toHaveLength(1)
    expect(tracked[0].id).toBe('ethereum:0xabc')
    expect(tracked[0].entryPriceUsd).toBe(1)
  })

  it('keeps the entry price immutable across live refreshes and reloads', async () => {
    let store = await import('./signal-store')
    const token: ScoredToken = {
      address: '0xAbC', symbol: 'ONE', name: 'One', chain: 'ethereum' as const,
      priceUsd: 1, priceChange24h: 0, volume24h: 40_000, liquidity: 30_000,
      marketCap: 100_000, fdv: 100_000, createdAt: new Date().toISOString(),
      pairCreatedAt: Date.now(), logoURI: '', score: 85, tier: 'A', signals: [],
      explanation: '', warnings: [], fetchedAt: new Date().toISOString(),
    }
    await store.upsertTrackedSignal(token)
    await store.upsertTrackedSignal({ ...token, priceUsd: 1.5, fetchedAt: new Date().toISOString() })
    expect((await store.getTrackedSignals())[0]).toMatchObject({ entryPriceUsd: 1, token: { priceUsd: 1.5 } })

    vi.resetModules()
    store = await import('./signal-store')
    expect((await store.getTrackedSignals())[0]).toMatchObject({ entryPriceUsd: 1, token: { priceUsd: 1.5 } })
  })
})

describe('sql.js outcome aggregation', () => {
  it('records a canonical cohort once and computes completed outcome stats', async () => {
    const outcomes = await import('./outcome-store')
    const base = new Date()
    base.setUTCSeconds(0, 0)
    const firstSeen = base.toISOString()

    await expect(outcomes.record({ signal_id: 'one', symbol: 'ONE', chain: 'ETH', address: '0xAbC', first_price_usd: 1, first_seen_at: firstSeen })).resolves.toBe(true)
    await expect(outcomes.record({ signal_id: 'duplicate', symbol: 'ONE', chain: 'ethereum', address: '0xabc', first_price_usd: 1, first_seen_at: firstSeen })).resolves.toBe(false)
    await expect(outcomes.record({ signal_id: 'two', symbol: 'TWO', chain: 'base', address: '0x2', first_price_usd: 1, first_seen_at: firstSeen })).resolves.toBe(true)
    await expect(outcomes.record({ signal_id: 'three', symbol: 'THREE', chain: 'solana', address: 'Mint3', first_price_usd: 1, first_seen_at: firstSeen })).resolves.toBe(true)

    const pending = await outcomes.getPendingOutcomes()
    expect(pending).toHaveLength(3)
    await expect(outcomes.updateFields(pending[0].id, { price_at_120m: 1.25, change_120m: 25 })).resolves.toBe(true)
    await expect(outcomes.updateFields(pending[1].id, { price_at_120m: 0.9, change_120m: -10 })).resolves.toBe(true)
    await expect(outcomes.updateFields(pending[2].id, { price_at_120m: 1, change_120m: 0 })).resolves.toBe(true)

    expect(await outcomes.computeOutcomeStats()).toEqual({
      winRate: 1 / 3,
      avgGain: 25,
      avgLoss: -5,
      best: 25,
      worst: -10,
      sampleSize: 3,
    })
    expect(await outcomes.getPendingOutcomes()).toHaveLength(0)
    expect(fs.existsSync(path.join(dataDir, 'outcomes.sqlite'))).toBe(true)
  })
})
