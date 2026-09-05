import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { BindParams, Database, SqlJs, Statement } from 'sql.js'
import { atomicWrite, createMutationQueue, dataPath, fetchWithTimeout } from './storage'
import { canonicalIdentity } from './token-identity'
import type { TradeEntry, TradeCheckpoint, TradeStats, TierKey } from './types'

const DB_PATH = dataPath('trades.sqlite')
export const MAX_CONCURRENT_POSITIONS = 3
export const DAILY_LOSS_CIRCUIT_BREAKER_PCT = -5
const CHECKPOINTS = [
  { minutes: 15, label: '15m' },
  { minutes: 30, label: '30m' },
  { minutes: 60, label: '60m' },
  { minutes: 120, label: '120m' },
] as const

let dbPromise: Promise<Database> | null = null
const mutate = createMutationQueue()

function rows(db: Database, sql: string, params: BindParams = []): Record<string, unknown>[] {
  const stmt: Statement = db.prepare(sql)
  stmt.bind(params)
  const result: Record<string, unknown>[] = []
  try {
    while (stmt.step()) result.push(stmt.getAsObject())
  } finally {
    stmt.free()
  }
  return result
}

async function persist(db: Database): Promise<void> {
  await atomicWrite(DB_PATH, db.export())
}

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await fs.promises.mkdir(dataPath(''), { recursive: true })
      const requireSql = createRequire(import.meta.url)
      const initSqlJs = requireSql('sql.js/dist/sql-asm.js') as () => Promise<SqlJs>
      const SQL = await initSqlJs()
      const db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database()
      db.run(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT, signal_id TEXT NOT NULL, symbol TEXT NOT NULL,
        chain TEXT NOT NULL, address TEXT NOT NULL, entry_price_usd REAL NOT NULL,
        entry_score INTEGER NOT NULL, entry_tier TEXT NOT NULL, entry_at TEXT NOT NULL,
        current_price_usd REAL NOT NULL, pnl_pct REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '')`)
      const schema = rows(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='trades'`)[0]
      if (/signal_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(String(schema?.sql ?? ''))) {
        db.run('BEGIN')
        try {
          db.run('ALTER TABLE trades RENAME TO trades_legacy')
          db.run(`CREATE TABLE trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, signal_id TEXT NOT NULL, symbol TEXT NOT NULL,
            chain TEXT NOT NULL, address TEXT NOT NULL, entry_price_usd REAL NOT NULL,
            entry_score INTEGER NOT NULL, entry_tier TEXT NOT NULL, entry_at TEXT NOT NULL,
            current_price_usd REAL NOT NULL, pnl_pct REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '')`)
          db.run(`INSERT INTO trades SELECT * FROM trades_legacy`)
          db.run('DROP TABLE trades_legacy')
          db.run('COMMIT')
        } catch (error) {
          db.run('ROLLBACK')
          throw error
        }
      }
      const tradeColumns = rows(db, `PRAGMA table_info(trades)`).map((row) => String(row.name))
      if (!tradeColumns.includes('closed_at')) db.run(`ALTER TABLE trades ADD COLUMN closed_at TEXT`)
      if (!tradeColumns.includes('discovery_price_usd')) db.run(`ALTER TABLE trades ADD COLUMN discovery_price_usd REAL`)
      if (!tradeColumns.includes('discovery_at')) db.run(`ALTER TABLE trades ADD COLUMN discovery_at TEXT`)
      db.run(`CREATE TABLE IF NOT EXISTS trade_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT, trade_id INTEGER NOT NULL, label TEXT NOT NULL,
        price_usd REAL NOT NULL, pnl_pct REAL NOT NULL, at TEXT NOT NULL)`)
      db.run(`DELETE FROM trade_checkpoints WHERE id NOT IN (
        SELECT MIN(id) FROM trade_checkpoints GROUP BY trade_id, label
      )`)
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS checkpoints_trade_label ON trade_checkpoints(trade_id, label)`)
      db.run(`CREATE INDEX IF NOT EXISTS trades_open_identity ON trades(chain, address, status)`)
      await persist(db)
      return db
    })()
  }
  return dbPromise
}

function checkpointLabel(entryAt: string, existing: Set<string>, nowMs: number): TradeCheckpoint['label'] | null {
  const elapsed = (nowMs - Date.parse(entryAt)) / 60_000
  const due = CHECKPOINTS.filter((point) => elapsed >= point.minutes && !existing.has(point.label))
  if (!due.length) return null
  const latestReached = [...CHECKPOINTS].reverse().find((point) => elapsed >= point.minutes)
  return latestReached && !existing.has(latestReached.label) ? latestReached.label : null
}

export async function openTrade(
  signalId: string,
  symbol: string,
  chain: string,
  address: string,
  entryPriceUsd: number,
  entryScore: number,
  entryTier: TierKey,
  discoveryPriceUsd?: number,
  discoveryAt?: string,
): Promise<TradeEntry | null> {
  if (!(entryPriceUsd > 0) || !Number.isFinite(entryPriceUsd) || !Number.isFinite(entryScore)) return null
  return mutate(async () => {
    const db = await getDb()
    const identity = canonicalIdentity(chain, address)
    const now = new Date().toISOString()
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    db.run('BEGIN IMMEDIATE')
    try {
      if (rows(db, `SELECT id FROM trades WHERE chain = ? AND address = ? AND status = 'open' LIMIT 1`, [identity.chain, identity.address]).length) {
        db.run('ROLLBACK')
        return null
      }
      const openCount = Number(rows(db, `SELECT COUNT(*) AS count FROM trades WHERE status = 'open'`)[0]?.count ?? 0)
      if (openCount >= MAX_CONCURRENT_POSITIONS) {
        db.run('ROLLBACK')
        return null
      }
      const dailyLoss = Number(rows(db, `SELECT COALESCE(SUM(pnl_pct), 0) AS pnl FROM trades WHERE status = 'closed' AND closed_at >= ?`, [dayStart.toISOString()])[0]?.pnl ?? 0)
      if (dailyLoss <= DAILY_LOSS_CIRCUIT_BREAKER_PCT) {
        db.run('ROLLBACK')
        return null
      }
      const firstPrice = discoveryPriceUsd && discoveryPriceUsd > 0 && Number.isFinite(discoveryPriceUsd) ? discoveryPriceUsd : entryPriceUsd
      const firstSeenAt = discoveryAt && Number.isFinite(Date.parse(discoveryAt)) ? discoveryAt : now
      db.run(`INSERT INTO trades
        (signal_id, symbol, chain, address, entry_price_usd, entry_score, entry_tier, entry_at, current_price_usd, pnl_pct, status, note, discovery_price_usd, discovery_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', '', ?, ?)`,
      [signalId, symbol, identity.chain, identity.address, entryPriceUsd, entryScore, entryTier, now, entryPriceUsd, firstPrice, firstSeenAt])
      if (db.getRowsModified() !== 1) throw new Error('trade insert failed')
      const id = Number(rows(db, 'SELECT last_insert_rowid() AS id')[0]?.id)
      db.run(`INSERT INTO trade_checkpoints (trade_id, label, price_usd, pnl_pct, at) VALUES (?, 'entry', ?, 0, ?)`, [id, entryPriceUsd, now])
      db.run('COMMIT')
      await persist(db)
      return (await getTradeById(db, id)) ?? null
    } catch (error) {
      try { db.run('ROLLBACK') } catch {}
      throw error
    }
  })
}

export async function closeTrade(signalId: string, refreshPrice = false): Promise<boolean> {
  let livePrice: number | null = null
  if (refreshPrice) {
    const db = await getDb()
    const open = rows(db, `SELECT address, chain FROM trades WHERE signal_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, [signalId])[0]
    if (!open) return false
    try { livePrice = await currentPrice(String(open.address), String(open.chain)) } catch { livePrice = null }
  }
  return mutate(async () => {
    const db = await getDb()
    db.run('BEGIN IMMEDIATE')
    try {
      const row = rows(db, `SELECT id, entry_price_usd, current_price_usd, pnl_pct FROM trades WHERE signal_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, [signalId])[0]
      if (!row) { db.run('ROLLBACK'); return false }
      const now = new Date().toISOString()
      const tradeId = Number(row.id)
      const currentPriceUsd = livePrice && livePrice > 0 ? livePrice : Number(row.current_price_usd)
      const entryPriceUsd = Number(row.entry_price_usd)
      const pnlPct = currentPriceUsd > 0 && entryPriceUsd > 0
        ? Math.round(((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 10_000) / 100
        : Number(row.pnl_pct)
      db.run(`UPDATE trades SET current_price_usd = ?, pnl_pct = ?, status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'`, [currentPriceUsd, pnlPct, now, tradeId])
      if (db.getRowsModified() !== 1) { db.run('ROLLBACK'); return false }
      db.run(`INSERT OR IGNORE INTO trade_checkpoints (trade_id, label, price_usd, pnl_pct, at) VALUES (?, 'manual_close', ?, ?, ?)`, [tradeId, currentPriceUsd, pnlPct, now])
      db.run('COMMIT')
      await persist(db)
      return true
    } catch (error) {
      try { db.run('ROLLBACK') } catch {}
      throw error
    }
  })
}

interface DexPair { chainId?: string; priceUsd?: string; baseToken?: { address?: string } }
interface DexResponse { pairs?: DexPair[] }

async function currentPrice(address: string, chain: string): Promise<number | null> {
  const response = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  const data = await response.json() as DexResponse
  const requested = canonicalIdentity(chain, address)
  const pair = data.pairs?.find((candidate) => {
    try {
      return canonicalIdentity(candidate.chainId ?? '', candidate.baseToken?.address ?? '').key === requested.key
    } catch { return false }
  })
  const price = Number(pair?.priceUsd)
  return price > 0 && Number.isFinite(price) ? price : null
}

export async function refreshAllTradePrices(): Promise<{ refreshed: number; failed: number }> {
  const db = await getDb()
  const open = rows(db, `SELECT id, address, chain, entry_price_usd, entry_at FROM trades WHERE status = 'open'`).slice(0, MAX_CONCURRENT_POSITIONS)
  const snapshots = await Promise.all(open.map(async (row) => {
    try { return { row, price: await currentPrice(String(row.address), String(row.chain)) } }
    catch { return { row, price: null } }
  }))
  return mutate(async () => {
    let refreshed = 0
    let failed = 0
    const writable = await getDb()
    const now = new Date().toISOString()
    for (const { row, price } of snapshots) {
      if (!(price && price > 0)) { failed++; continue }
      const entry = Number(row.entry_price_usd)
      const pnl = Math.round(((price - entry) / entry) * 10_000) / 100
      const tradeId = Number(row.id)
      writable.run(`UPDATE trades SET current_price_usd = ?, pnl_pct = ? WHERE id = ? AND status = 'open'`, [price, pnl, tradeId])
      if (writable.getRowsModified() !== 1) continue
      const labels = new Set(rows(writable, `SELECT label FROM trade_checkpoints WHERE trade_id = ?`, [tradeId]).map((item) => String(item.label)))
      const label = checkpointLabel(String(row.entry_at), labels, Date.now())
      if (label) writable.run(`INSERT OR IGNORE INTO trade_checkpoints (trade_id, label, price_usd, pnl_pct, at) VALUES (?, ?, ?, ?, ?)`, [tradeId, label, price, pnl, now])
      refreshed++
    }
    if (refreshed) await persist(writable)
    return { refreshed, failed }
  })
}

async function getTradeById(db: Database, id: number): Promise<TradeEntry | undefined> {
  const row = rows(db, `SELECT * FROM trades WHERE id = ?`, [id])[0]
  if (!row) return undefined
  const checkpoints = rows(db, `SELECT label, price_usd, pnl_pct, at FROM trade_checkpoints WHERE trade_id = ? ORDER BY id`, [id]).map((point) => ({
    at: String(point.at), label: String(point.label) as TradeCheckpoint['label'], price_usd: Number(point.price_usd), pnl_pct: Number(point.pnl_pct),
  }))
  return {
    id: Number(row.id), signal_id: String(row.signal_id), symbol: String(row.symbol), chain: String(row.chain) as TradeEntry['chain'],
    address: String(row.address), entry_price_usd: Number(row.entry_price_usd), entry_score: Number(row.entry_score),
    entry_tier: String(row.entry_tier) as TierKey, entry_at: String(row.entry_at), current_price_usd: Number(row.current_price_usd),
    discovery_price_usd: Number(row.discovery_price_usd) || Number(row.entry_price_usd), discovery_at: String(row.discovery_at || row.entry_at),
    pnl_pct: Number(row.pnl_pct), status: String(row.status) as TradeEntry['status'], checkpoints, note: String(row.note ?? ''),
  }
}

export async function getAllTrades(): Promise<TradeEntry[]> {
  const db = await getDb()
  const ids = rows(db, `SELECT id FROM trades ORDER BY id DESC`)
  return (await Promise.all(ids.map((row) => getTradeById(db, Number(row.id))))).filter((trade): trade is TradeEntry => Boolean(trade))
}

export function computeTradeStats(trades: TradeEntry[]): TradeStats {
  const pnl = trades.map((trade) => trade.pnl_pct)
  const sum = pnl.reduce((total, value) => total + value, 0)
  return {
    totalTrades: trades.length,
    openTrades: trades.filter((trade) => trade.status === 'open').length,
    closedTrades: trades.filter((trade) => trade.status === 'closed').length,
    avgPnlPct: trades.length ? Math.round((sum / trades.length) * 100) / 100 : 0,
    bestPnlPct: trades.length ? Math.round(Math.max(...pnl) * 100) / 100 : 0,
    worstPnlPct: trades.length ? Math.round(Math.min(...pnl) * 100) / 100 : 0,
    totalPnlPct: Math.round(sum * 100) / 100,
  }
}
