import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { TradeEntry, TradeCheckpoint, TradeStats, TierKey } from './types'

const DB_PATH = path.join('/home/dani/degenescan-web/data', 'trades.sqlite')

let dbPromise: Promise<any> | null = null

function getDb(): Promise<any> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await fs.promises.mkdir(path.dirname(DB_PATH), { recursive: true })
      const requireSql = createRequire(import.meta.url)
      const initSqlJs = requireSql('sql.js/dist/sql-asm.js')
      const SQL = await initSqlJs()
      let db: any
      if (fs.existsSync(DB_PATH)) {
        db = new SQL.Database(fs.readFileSync(DB_PATH))
      } else {
        db = new SQL.Database()
      }
      db.run(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          signal_id TEXT NOT NULL UNIQUE,
          symbol TEXT NOT NULL,
          chain TEXT NOT NULL,
          address TEXT NOT NULL,
          entry_price_usd REAL NOT NULL,
          entry_score INTEGER NOT NULL,
          entry_tier TEXT NOT NULL,
          entry_at TEXT NOT NULL,
          current_price_usd REAL NOT NULL,
          pnl_pct REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          note TEXT NOT NULL DEFAULT ''
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS trade_checkpoints (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trade_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          price_usd REAL NOT NULL,
          pnl_pct REAL NOT NULL,
          at TEXT NOT NULL
        )
      `)
      persist(db)
      return db
    })()
  }
  return dbPromise
}

function persist(db: any): void {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(DB_PATH, buffer)
}

export async function openTrade(
  signal_id: string,
  symbol: string,
  chain: string,
  address: string,
  entry_price_usd: number,
  entry_score: number,
  entry_tier: TierKey
): Promise<TradeEntry | null> {
  const db = await getDb()
  const now = new Date().toISOString()
  try {
    db.run(
      `INSERT OR IGNORE INTO trades (signal_id, symbol, chain, address, entry_price_usd, entry_score, entry_tier, entry_at, current_price_usd, pnl_pct, status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', '')`,
      [signal_id, symbol, chain, address, entry_price_usd, entry_score, entry_tier, now]
    )
    const rs = db.exec(`SELECT id FROM trades WHERE signal_id = ?`, [signal_id])
    const row = rs[0]?.rows?.[0]
    if (!row) return null
    const id = Number(row.id)
    db.run(
      `INSERT INTO trade_checkpoints (trade_id, label, price_usd, pnl_pct, at) VALUES (?, 'entry', ?, 0, ?)`,
      [id, entry_price_usd, now]
    )
    persist(db)
    return {
      id,
      signal_id,
      symbol,
      chain: chain as TradeEntry['chain'],
      address,
      entry_price_usd,
      entry_score,
      entry_tier,
      entry_at: now,
      current_price_usd: entry_price_usd,
      pnl_pct: 0,
      status: 'open',
      checkpoints: [{ at: now, label: 'entry', price_usd: entry_price_usd, pnl_pct: 0 }],
      note: '',
    }
  } catch {
    return null
  }
}

export async function closeTrade(signal_id: string): Promise<void> {
  const db = await getDb()
  const now = new Date().toISOString()
  db.run(`UPDATE trades SET status = 'closed' WHERE signal_id = ?`, [signal_id])
  const rs = db.exec(`SELECT id, pnl_pct FROM trades WHERE signal_id = ?`, [signal_id])
  const row = rs[0]?.rows?.[0]
  if (row) {
    db.run(
      `INSERT INTO trade_checkpoints (trade_id, label, price_usd, pnl_pct, at) VALUES (?, 'manual_close', 0, ?, ?)`,
      [Number(row.id), Number(row.pnl_pct), now]
    )
  }
  persist(db)
}

export async function refreshAllTradePrices(): Promise<void> {
  const db = await getDb()
  const now = new Date().toISOString()
  const rows = db.exec(`SELECT id, address, chain, entry_price_usd, current_price_usd, pnl_pct, status FROM trades WHERE status = 'open'`)
  for (const row of rows[0]?.rows ?? []) {
    try {
      const resp = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(String(row.address))}`,
        { headers: { Accept: 'application/json' } }
      )
      if (!resp.ok) continue
      const data = (await resp.json()) as any
      const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : []
      const preferred = pairs.find((p: any) => String(p.chainId || '').toLowerCase().includes(String(row.chain))) || pairs[0]
      const price = Number(preferred?.priceUsd || 0)
      if (!(price > 0)) continue
      const entry = Number(row.entry_price_usd)
      const pnl = entry > 0 ? Math.round(((price - entry) / entry) * 10000) / 100 : 0
      db.run(`UPDATE trades SET current_price_usd = ?, pnl_pct = ? WHERE id = ?`, [price, pnl, Number(row.id)])
      db.run(
        `INSERT INTO trade_checkpoints (trade_id, label, price_usd, pnl_pct, at) VALUES (?, '120m', ?, ?, ?)`,
        [Number(row.id), price, pnl, now]
      )
    } catch {}
  }
  persist(db)
}

export async function getAllTrades(): Promise<TradeEntry[]> {
  const db = await getDb()
  const rows = db.exec(`SELECT * FROM trades ORDER BY id ASC`)
  const trades: TradeEntry[] = []
  for (const row of rows[0]?.rows ?? []) {
    const cpRows = db.exec(`SELECT label, price_usd, pnl_pct, at FROM trade_checkpoints WHERE trade_id = ? ORDER BY id ASC`, [Number(row.id)])
    const checkpoints: TradeCheckpoint[] = (cpRows[0]?.rows ?? []).map((r: any) => ({
      at: String(r.at),
      label: String(r.label) as TradeCheckpoint['label'],
      price_usd: Number(r.price_usd),
      pnl_pct: Number(r.pnl_pct),
    }))
    trades.push({
      id: Number(row.id),
      signal_id: String(row.signal_id),
      symbol: String(row.symbol),
      chain: String(row.chain) as TradeEntry['chain'],
      address: String(row.address),
      entry_price_usd: Number(row.entry_price_usd),
      entry_score: Number(row.entry_score),
      entry_tier: String(row.entry_tier) as TierKey,
      entry_at: String(row.entry_at),
      current_price_usd: Number(row.current_price_usd),
      pnl_pct: Number(row.pnl_pct),
      status: String(row.status) as TradeEntry['status'],
      checkpoints,
      note: String(row.note || ''),
    })
  }
  return trades
}

export function computeTradeStats(trades: TradeEntry[]): TradeStats {
  const pnlValues = trades.map((t) => t.pnl_pct)
  const total = trades.length
  const avgPnl = total > 0 ? pnlValues.reduce((s, v) => s + v, 0) / total : 0
  const best = total > 0 ? Math.max(...pnlValues) : 0
  const worst = total > 0 ? Math.min(...pnlValues) : 0
  return {
    totalTrades: total,
    openTrades: trades.filter((t) => t.status === 'open').length,
    closedTrades: trades.filter((t) => t.status === 'closed').length,
    avgPnlPct: Math.round(avgPnl * 100) / 100,
    bestPnlPct: Math.round(best * 100) / 100,
    worstPnlPct: Math.round(worst * 100) / 100,
    totalPnlPct: Math.round(pnlValues.reduce((s, v) => s + v, 0) * 100) / 100,
  }
}
