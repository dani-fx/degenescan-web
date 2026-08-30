import fs from 'node:fs'
import { atomicWrite, createMutationQueue, dataPath } from './storage'
import {
  LEGEND_LEADER_TTL_MS,
  LEGEND_MAX_RECORDS,
  LEGEND_MAX_SNAPSHOTS,
  type LegendRecord,
  type LegendSnapshot,
} from './legend-policy'
import { canonicalIdentity } from './token-identity'
import type { ScoredToken } from './types'

const STORE_PATH = dataPath('legend-observatory.json')
const mutate = createMutationQueue()
let loaded = false
let records: LegendRecord[] = []

function finiteNumber(value: unknown, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isLegendSnapshot(value: unknown): value is LegendSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<LegendSnapshot>
  return validDate(snapshot.observedAt)
    && finiteNumber(snapshot.priceUsd, 0)
    && finiteNumber(snapshot.score, 0, 100)
    && finiteNumber(snapshot.liquidity, 0)
    && finiteNumber(snapshot.volume24h, 0)
    && finiteNumber(snapshot.marketCap, 0)
    && finiteNumber(snapshot.buys24h, 0)
    && finiteNumber(snapshot.sells24h, 0)
}

function isScoredToken(value: unknown): value is ScoredToken {
  if (!value || typeof value !== 'object') return false
  const token = value as Partial<ScoredToken>
  const signalsValid = Array.isArray(token.signals) && token.signals.every((signal) => Boolean(
    signal && typeof signal === 'object'
    && typeof signal.type === 'string'
    && typeof signal.strength === 'string'
    && typeof signal.description === 'string'
    && finiteNumber(signal.points),
  ))
  const socialsValid = token.socials === undefined || (Array.isArray(token.socials) && token.socials.every((social) => Boolean(
    social && typeof social.type === 'string' && typeof social.url === 'string',
  )))
  const txnsValid = token.txns24h === undefined || Boolean(
    finiteNumber(token.txns24h.buys, 0) && finiteNumber(token.txns24h.sells, 0),
  )
  return typeof token.address === 'string' && token.address.length > 0
    && typeof token.symbol === 'string'
    && typeof token.name === 'string'
    && token.chain === 'solana'
    && finiteNumber(token.priceUsd, Number.MIN_VALUE)
    && finiteNumber(token.priceChange24h)
    && finiteNumber(token.volume24h, 0)
    && finiteNumber(token.liquidity, Number.MIN_VALUE)
    && finiteNumber(token.marketCap, 0)
    && finiteNumber(token.fdv, 0)
    && validDate(token.createdAt)
    && finiteNumber(token.pairCreatedAt, 0)
    && typeof token.logoURI === 'string'
    && finiteNumber(token.score, 0, 100)
    && ['A', 'B', 'C', 'D'].includes(String(token.tier))
    && signalsValid
    && typeof token.explanation === 'string'
    && stringArray(token.warnings)
    && validDate(token.fetchedAt)
    && (token.signalClass === undefined || ['HIGH', 'LOW', 'WATCH'].includes(token.signalClass))
    && socialsValid
    && txnsValid
    && Boolean(token.rugcheck && token.rugcheck.checked === true && token.rugcheck.safe === true)
}

function isLegendRecord(value: unknown): value is LegendRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<LegendRecord>
  if (!isScoredToken(record.token)) return false
  let expectedKey: string
  try { expectedKey = canonicalIdentity(record.token.chain, record.token.address).key }
  catch { return false }
  return record.key === expectedKey
    && validDate(record.firstSeenAt)
    && finiteNumber(record.firstSeenPriceUsd, Number.MIN_VALUE)
    && validDate(record.lastObservedAt)
    && validDate(record.lastAttemptedAt)
    && validDate(record.expiresAt)
    && finiteNumber(record.legendScore, 0, 100)
    && ['WATCH', 'EARLY_ALERT', 'BREAKOUT_CANDIDATE', 'PERSISTENT_LEADER'].includes(String(record.stage))
    && ['EARLY', 'EXTENDED', 'OVERHEATED'].includes(String(record.entryQuality))
    && finiteNumber(record.dataCompleteness, 0, 100)
    && stringArray(record.drivers)
    && stringArray(record.risks)
    && Array.isArray(record.snapshots)
    && record.snapshots.length > 0
    && record.snapshots.length <= LEGEND_MAX_SNAPSHOTS
    && record.snapshots.every(isLegendSnapshot)
}

function validateRecords(value: unknown): asserts value is LegendRecord[] {
  if (!Array.isArray(value) || !value.every(isLegendRecord)) {
    throw new Error('Invalid legend observatory storage')
  }
}

async function load(): Promise<void> {
  if (loaded) return
  try {
    const parsed = JSON.parse(await fs.promises.readFile(STORE_PATH, 'utf8')) as unknown
    validateRecords(parsed)
    records = parsed
    loaded = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      records = []
      loaded = true
      return
    }
    console.error('Legend observatory read failed', error)
    throw error
  }
}

async function persist(next: LegendRecord[]): Promise<void> {
  await atomicWrite(STORE_PATH, JSON.stringify(next, null, 2))
}

function activeRecords(nowMs = Date.now()): LegendRecord[] {
  return records
    .filter((record) => {
      const expiresAt = Date.parse(record.expiresAt)
      const absoluteLimit = Date.parse(record.firstSeenAt) + LEGEND_LEADER_TTL_MS
      return expiresAt > nowMs && expiresAt <= absoluteLimit
    })
    .sort((a, b) => b.legendScore - a.legendScore || Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt))
    .slice(0, LEGEND_MAX_RECORDS)
}

export async function getLegendRecords(nowMs = Date.now()): Promise<LegendRecord[]> {
  await load()
  return structuredClone(activeRecords(nowMs))
}

export async function getLegendRecordsSafe(nowMs = Date.now()): Promise<{ records: LegendRecord[]; unavailable: boolean }> {
  try {
    return { records: await getLegendRecords(nowMs), unavailable: false }
  } catch {
    return { records: [], unavailable: true }
  }
}

export async function mutateLegendRecords<T>(
  operation: (current: LegendRecord[]) => Promise<{ records: LegendRecord[]; result: T }>,
  nowMs = Date.now(),
): Promise<T> {
  return mutate(async () => {
    await load()
    const mutation = await operation(structuredClone(activeRecords(nowMs)))
    validateRecords(mutation.records)
    const next = structuredClone(mutation.records)
    await persist(next)
    records = next
    return mutation.result
  })
}

export async function replaceLegendRecords(next: LegendRecord[]): Promise<void> {
  await mutateLegendRecords(async () => ({ records: next, result: undefined }))
}
