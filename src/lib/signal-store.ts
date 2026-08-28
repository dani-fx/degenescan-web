import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { TrackedSignal, ScoredToken, BotConfig } from './types'
import { DEFAULT_CONFIG } from './config'

const DB_PATH = path.join('/home/dani/degenescan-web/data/signals.sqlite')

let config: BotConfig = { ...DEFAULT_CONFIG }
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
        CREATE TABLE IF NOT EXISTS signals (
          id TEXT PRIMARY KEY,
          tracked_at TEXT NOT NULL,
          data TEXT NOT NULL
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

// In-memory mirror so reads stay synchronous (exported API is sync).
const tracked = new Map<string, TrackedSignal>()
let loaded = false

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  const db = await getDb()
  const stmt = db.prepare(`SELECT id, tracked_at, data FROM signals`)
  while (stmt.step()) {
    const row = stmt.getAsObject()
    try {
      const parsed = JSON.parse(String(row.data)) as TrackedSignal
      tracked.set(String(row.id), parsed)
    } catch {
      // Skip corrupt rows.
    }
  }
  stmt.free()
}

export function getConfig(): BotConfig {
  return config
}

export function updateConfig(partial: Partial<BotConfig>): BotConfig {
  config = { ...config, ...partial }
  return config
}

export function getTrackedSignals(): TrackedSignal[] {
  return Array.from(tracked.values()).sort((a, b) => (b.trackedAt > a.trackedAt ? 1 : -1))
}

export function getTrackedSignal(id: string): TrackedSignal | undefined {
  return tracked.get(id)
}

function saveSignal(signal: TrackedSignal): void {
  getDb()
    .then((db) => {
      db.run(
        `INSERT OR REPLACE INTO signals (id, tracked_at, data) VALUES (?, ?, ?)`,
        [signal.id, signal.trackedAt, JSON.stringify(signal)]
      )
      persist(db)
    })
    .catch((err) => console.error('signal-store persist failed', err))
}

export function upsertTrackedSignal(token: ScoredToken): TrackedSignal {
  const existing = tracked.get(token.address)
  const now = new Date().toISOString()
  if (existing) {
    const updated: TrackedSignal = {
      ...existing,
      token,
      lastRefreshedAt: now,
    }
    tracked.set(token.address, updated)
    saveSignal(updated)
    return updated
  }
  const created: TrackedSignal = {
    id: token.address,
    token,
    trackedAt: now,
    lastRefreshedAt: now,
    outcomes: [],
  }
  tracked.set(token.address, created)
  saveSignal(created)
  return created
}

export function recordOutcome(id: string, priceUsd: number, changeFromEntry: number): TrackedSignal | undefined {
  const existing = tracked.get(id)
  if (!existing) return undefined
  existing.outcomes.push({
    checkedAt: new Date().toISOString(),
    priceUsd,
    changeFromEntry,
  })
  saveSignal(existing)
  return existing
}

export function removeTrackedSignal(address: string): boolean {
  const existing = tracked.get(address)
  if (!existing) return false
  tracked.delete(address)
  getDb()
    .then((db) => {
      db.run(`DELETE FROM signals WHERE id = ?`, [address])
      persist(db)
    })
    .catch((err) => console.error('signal-store remove failed', err))
  return true
}

// Warm the cache from sqlite on first import in a server context.
void ensureLoaded()
