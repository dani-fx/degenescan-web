import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { Database, SqlJs } from 'sql.js'
import { canonicalIdentity } from './token-identity'
import { atomicWrite, createMutationQueue, dataPath } from './storage'
import type { TrackedSignal, ScoredToken, BotConfig } from './types'
import { DEFAULT_CONFIG } from './config'

const DB_PATH = dataPath('signals.sqlite')
const mutate = createMutationQueue()
let config: BotConfig = { ...DEFAULT_CONFIG }
let dbPromise: Promise<Database> | null = null
let readyPromise: Promise<void> | null = null
const tracked = new Map<string, TrackedSignal>()
let latestResults: ScoredToken[] = []

async function persist(db: Database): Promise<void> { await atomicWrite(DB_PATH, db.export()) }

async function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = (async () => {
    await fs.promises.mkdir(dataPath(''), { recursive: true })
    const initSqlJs = createRequire(import.meta.url)('sql.js/dist/sql-asm.js') as () => Promise<SqlJs>
    const SQL = await initSqlJs()
    const db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database()
    db.run(`CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, tracked_at TEXT NOT NULL, data TEXT NOT NULL)`)
    db.run(`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    await persist(db)
    return db
  })()
  return dbPromise
}

function readRows(db: Database, sql: string, params: Array<string | number | null> = []): Record<string, unknown>[] {
  const statement = db.prepare(sql)
  statement.bind(params)
  const output: Record<string, unknown>[] = []
  try { while (statement.step()) output.push(statement.getAsObject()) }
  finally { statement.free() }
  return output
}

export function ready(): Promise<void> {
  if (!readyPromise) readyPromise = (async () => {
    const db = await getDb()
    let migrated = false
    for (const row of readRows(db, `SELECT id, data FROM signals`)) {
      try {
        const parsed = JSON.parse(String(row.data)) as TrackedSignal
        const identity = canonicalIdentity(parsed.token.chain, parsed.token.address)
        const canonical: TrackedSignal = {
          ...parsed,
          id: identity.key,
          token: { ...parsed.token, chain: identity.chain, address: identity.address },
          entryPriceUsd: Number(parsed.entryPriceUsd ?? parsed.token.priceUsd ?? 0),
        }
        const existing = tracked.get(identity.key)
        if (!existing || canonical.trackedAt > existing.trackedAt) tracked.set(identity.key, canonical)
        if (
          String(row.id) !== identity.key ||
          parsed.id !== identity.key ||
          !Number.isFinite(Number(parsed.entryPriceUsd))
        ) migrated = true
      } catch {}
    }
    if (migrated) {
      db.run('BEGIN IMMEDIATE')
      try {
        db.run('DELETE FROM signals')
        for (const signal of tracked.values()) {
          db.run(`INSERT INTO signals (id, tracked_at, data) VALUES (?, ?, ?)`, [signal.id, signal.trackedAt, JSON.stringify(signal)])
        }
        db.run('COMMIT')
        await persist(db)
      } catch (error) {
        try { db.run('ROLLBACK') } catch {}
        throw error
      }
    }
    for (const row of readRows(db, `SELECT key, data FROM app_state WHERE key IN ('config', 'latest_results')`)) {
      try {
        if (row.key === 'config') config = { ...DEFAULT_CONFIG, ...JSON.parse(String(row.data)) as Partial<BotConfig> }
        if (row.key === 'latest_results') latestResults = JSON.parse(String(row.data)) as ScoredToken[]
      } catch {}
    }
  })()
  return readyPromise
}

async function saveState(key: string, value: unknown): Promise<void> {
  await mutate(async () => {
    const db = await getDb()
    db.run(`INSERT OR REPLACE INTO app_state (key, data, updated_at) VALUES (?, ?, ?)`, [key, JSON.stringify(value), new Date().toISOString()])
    await persist(db)
  })
}

export async function getConfig(): Promise<BotConfig> { await ready(); return { ...config, chains: [...config.chains] } }
export async function updateConfig(partial: Partial<BotConfig>): Promise<BotConfig> {
  await ready(); const previous = config; config = { ...config, ...partial }
  try { await saveState('config', config) } catch (error) { config = previous; throw error }
  return getConfig()
}
export async function getLatestResults(): Promise<ScoredToken[]> { await ready(); return latestResults }
export async function setLatestResults(results: ScoredToken[]): Promise<void> {
  await ready(); const previous = latestResults; latestResults = results
  try { await saveState('latest_results', results) } catch (error) { latestResults = previous; throw error }
}
export async function getTrackedSignals(): Promise<TrackedSignal[]> { await ready(); return Array.from(tracked.values()).sort((a, b) => b.trackedAt.localeCompare(a.trackedAt)) }
export async function getTrackedSignal(id: string): Promise<TrackedSignal | undefined> { await ready(); return tracked.get(id) }

export async function upsertTrackedSignal(token: ScoredToken): Promise<TrackedSignal> {
  await ready()
  const identity = canonicalIdentity(token.chain, token.address)
  const existing = tracked.get(identity.key)
  const now = new Date().toISOString()
  const saved: TrackedSignal = existing
    ? { ...existing, token: { ...token, chain: identity.chain, address: identity.address }, lastRefreshedAt: now }
    : {
        id: identity.key,
        token: { ...token, chain: identity.chain, address: identity.address },
        entryPriceUsd: token.priceUsd,
        trackedAt: now,
        lastRefreshedAt: now,
        outcomes: [],
      }
  tracked.set(identity.key, saved)
  try {
    await mutate(async () => {
      const db = await getDb()
      db.run(`INSERT OR REPLACE INTO signals (id, tracked_at, data) VALUES (?, ?, ?)`, [saved.id, saved.trackedAt, JSON.stringify(saved)])
      await persist(db)
    })
  } catch (error) {
    if (existing) tracked.set(identity.key, existing); else tracked.delete(identity.key)
    throw error
  }
  return saved
}

export async function recordOutcome(id: string, priceUsd: number, changeFromEntry: number): Promise<TrackedSignal | undefined> {
  await ready(); const existing = tracked.get(id); if (!existing) return undefined
  const updated = { ...existing, outcomes: [...existing.outcomes, { checkedAt: new Date().toISOString(), priceUsd, changeFromEntry }].slice(-100) }
  tracked.set(id, updated)
  await upsertTrackedSignal(updated.token)
  return updated
}

export async function removeTrackedSignal(chain: string, address: string): Promise<boolean> {
  await ready()
  const identity = canonicalIdentity(chain, address)
  const existing = tracked.get(identity.key)
  if (!existing || !tracked.delete(identity.key)) return false
  try {
    await mutate(async () => {
      const db = await getDb(); db.run(`DELETE FROM signals WHERE id = ?`, [identity.key]); await persist(db)
    })
  } catch (error) { tracked.set(identity.key, existing); throw error }
  return true
}

void ready()
