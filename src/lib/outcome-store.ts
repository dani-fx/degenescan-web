import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const DB_PATH = path.join('/home/dani/degenescan-web/data/outcomes.sqlite')

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
        const buffer = fs.readFileSync(DB_PATH)
        db = new SQL.Database(buffer)
      } else {
        db = new SQL.Database()
      }
      db.run(`
        CREATE TABLE IF NOT EXISTS outcomes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          signal_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          chain TEXT NOT NULL,
          address TEXT NOT NULL,
          first_price_usd REAL,
          price_at_15m REAL,
          change_15m REAL,
          price_at_30m REAL,
          price_at_60m REAL,
          price_at_120m REAL,
          change_30m REAL,
          change_60m REAL,
          change_120m REAL,
          first_seen_at TEXT NOT NULL
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

export async function record(payload: {
  signal_id: string
  symbol: string
  chain: string
  address: string
  first_price_usd: number | null
  first_seen_at: string
}): Promise<void> {
  const db = await getDb()
  db.run(
    `INSERT INTO outcomes (signal_id, symbol, chain, address, first_price_usd, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      payload.signal_id,
      payload.symbol,
      payload.chain,
      payload.address,
      payload.first_price_usd,
      payload.first_seen_at,
    ]
  )
  persist(db)
}

export async function getPendingOutcomes(): Promise<
  Array<{
    id: number
    signal_id: string
    symbol: string
    chain: string
    address: string
    first_price_usd: number | null
    price_at_30m: number | null
    price_at_60m: number | null
    price_at_120m: number | null
    change_30m: number | null
    change_60m: number | null
    change_120m: number | null
    first_seen_at: string
  }>
> {
  const db = await getDb()
  const stmt = db.prepare(
    `SELECT id, signal_id, symbol, chain, address, first_price_usd, price_at_30m, price_at_60m, price_at_120m, change_30m, change_60m, change_120m, first_seen_at FROM outcomes WHERE price_at_120m IS NULL ORDER BY id ASC`
  )
  const results: any[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push({
      id: Number(row.id),
      signal_id: String(row.signal_id),
      symbol: String(row.symbol),
      chain: String(row.chain),
      address: String(row.address),
      first_price_usd: row.first_price_usd != null ? Number(row.first_price_usd) : null,
      price_at_30m: row.price_at_30m != null ? Number(row.price_at_30m) : null,
      price_at_60m: row.price_at_60m != null ? Number(row.price_at_60m) : null,
      price_at_120m: row.price_at_120m != null ? Number(row.price_at_120m) : null,
      change_30m: row.change_30m != null ? Number(row.change_30m) : null,
      change_60m: row.change_60m != null ? Number(row.change_60m) : null,
      change_120m: row.change_120m != null ? Number(row.change_120m) : null,
      first_seen_at: String(row.first_seen_at),
    })
  }
  stmt.free()
  return results
}

export async function updateFields(id: number, fields: {
  price_at_15m?: number | null
  change_15m?: number | null
  price_at_30m?: number | null
  price_at_60m?: number | null
  price_at_120m?: number | null
  change_30m?: number | null
  change_60m?: number | null
  change_120m?: number | null
}): Promise<void> {
  const db = await getDb()
  const sets: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`)
    values.push(value)
  }
  values.push(id)
  db.run(`UPDATE outcomes SET ${sets.join(', ')} WHERE id = ?`, values)
  persist(db)
}
