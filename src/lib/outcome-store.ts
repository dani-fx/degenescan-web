import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { Database, SqlJs } from 'sql.js'
import { canonicalIdentity } from './token-identity'
import { atomicWrite, createMutationQueue, dataPath } from './storage'

const DB_PATH = dataPath('outcomes.sqlite')
const RETENTION_DAYS = 30
const MAX_PENDING = 100
const mutate = createMutationQueue()
let dbPromise: Promise<Database> | null = null

export interface OutcomeRow {
  id: number; signal_id: string; symbol: string; chain: string; address: string
  first_price_usd: number | null; price_at_15m: number | null; change_15m: number | null
  price_at_30m: number | null; price_at_60m: number | null; price_at_120m: number | null
  change_30m: number | null; change_60m: number | null; change_120m: number | null; first_seen_at: string
}
export type OutcomeFields = Partial<Pick<OutcomeRow, 'price_at_15m' | 'change_15m' | 'price_at_30m' | 'price_at_60m' | 'price_at_120m' | 'change_30m' | 'change_60m' | 'change_120m'>>

function rows(db: Database, sql: string, params: Array<string | number | null> = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql); stmt.bind(params); const output: Record<string, unknown>[] = []
  try { while (stmt.step()) output.push(stmt.getAsObject()) } finally { stmt.free() }
  return output
}
async function persist(db: Database): Promise<void> { await atomicWrite(DB_PATH, db.export()) }
async function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = (async () => {
    await fs.promises.mkdir(dataPath(''), { recursive: true })
    const initSqlJs = createRequire(import.meta.url)('sql.js/dist/sql-asm.js') as () => Promise<SqlJs>
    const SQL = await initSqlJs()
    const db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database()
    db.run(`CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_key TEXT, signal_id TEXT NOT NULL, symbol TEXT NOT NULL,
      chain TEXT NOT NULL, address TEXT NOT NULL, first_price_usd REAL, price_at_15m REAL, change_15m REAL,
      price_at_30m REAL, price_at_60m REAL, price_at_120m REAL, change_30m REAL, change_60m REAL,
      change_120m REAL, first_seen_at TEXT NOT NULL)`)
    const columns = rows(db, `PRAGMA table_info(outcomes)`).map((row) => String(row.name))
    if (!columns.includes('cohort_key')) db.run(`ALTER TABLE outcomes ADD COLUMN cohort_key TEXT`)
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS outcomes_cohort_key ON outcomes(cohort_key)`)
    db.run(`CREATE INDEX IF NOT EXISTS outcomes_pending ON outcomes(price_at_120m, first_seen_at)`)
    await persist(db); return db
  })()
  return dbPromise
}

function cohortKey(chain: string, address: string, at: string): string {
  const identity = canonicalIdentity(chain, address)
  const bucket = Math.floor(Date.parse(at) / (5 * 60_000))
  return `${identity.key}:${bucket}`
}

export async function record(payload: { signal_id: string; symbol: string; chain: string; address: string; first_price_usd: number | null; first_seen_at: string }): Promise<boolean> {
  return mutate(async () => {
    const db = await getDb(); const identity = canonicalIdentity(payload.chain, payload.address)
    db.run(`INSERT OR IGNORE INTO outcomes (cohort_key, signal_id, symbol, chain, address, first_price_usd, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cohortKey(identity.chain, identity.address, payload.first_seen_at), payload.signal_id, payload.symbol, identity.chain, identity.address, payload.first_price_usd, payload.first_seen_at])
    const inserted = db.getRowsModified() === 1
    db.run(`DELETE FROM outcomes WHERE first_seen_at < ?`, [new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()])
    if (inserted || db.getRowsModified()) await persist(db)
    return inserted
  })
}

function toOutcome(row: Record<string, unknown>): OutcomeRow {
  const nullable = (value: unknown) => value == null ? null : Number(value)
  return {
    id: Number(row.id), signal_id: String(row.signal_id), symbol: String(row.symbol), chain: String(row.chain), address: String(row.address),
    first_price_usd: nullable(row.first_price_usd), price_at_15m: nullable(row.price_at_15m), change_15m: nullable(row.change_15m),
    price_at_30m: nullable(row.price_at_30m), price_at_60m: nullable(row.price_at_60m), price_at_120m: nullable(row.price_at_120m),
    change_30m: nullable(row.change_30m), change_60m: nullable(row.change_60m), change_120m: nullable(row.change_120m), first_seen_at: String(row.first_seen_at),
  }
}

export async function getPendingOutcomes(): Promise<OutcomeRow[]> {
  const db = await getDb()
  return rows(db, `SELECT * FROM outcomes WHERE price_at_120m IS NULL AND first_seen_at >= ? ORDER BY id LIMIT ?`, [new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString(), MAX_PENDING]).map(toOutcome)
}

export async function updateFields(id: number, fields: OutcomeFields): Promise<boolean> {
  const allowed = new Set(['price_at_15m','change_15m','price_at_30m','price_at_60m','price_at_120m','change_30m','change_60m','change_120m'])
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key))
  if (!entries.length) return false
  return mutate(async () => {
    const db = await getDb(); const values = entries.map(([, value]) => value ?? null)
    db.run(`UPDATE outcomes SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`, [...values, id])
    const changed = db.getRowsModified() === 1; if (changed) await persist(db); return changed
  })
}

export interface OutcomeStats { winRate: number; avgGain: number; avgLoss: number; best: number; worst: number; sampleSize: number }
export async function computeOutcomeStats(): Promise<OutcomeStats> {
  const db = await getDb()
  const changes = rows(db, `SELECT change_120m AS change FROM outcomes WHERE change_120m IS NOT NULL ORDER BY id DESC LIMIT 1000`).map((row) => Number(row.change))
  if (!changes.length) return { winRate: 0, avgGain: 0, avgLoss: 0, best: 0, worst: 0, sampleSize: 0 }
  const wins = changes.filter((value) => value > 0); const losses = changes.filter((value) => value <= 0)
  return {
    winRate: wins.length / changes.length,
    avgGain: wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0,
    best: Math.max(...changes), worst: Math.min(...changes), sampleSize: changes.length,
  }
}
