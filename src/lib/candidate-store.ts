import fs from 'node:fs'
import { atomicWrite, createMutationQueue, dataPath } from './storage'
import type { CandidateRecord } from './candidate-policy'

const STORE_PATH = dataPath('candidate-pool.json')
const mutate = createMutationQueue()
let loaded = false
let records: CandidateRecord[] = []

async function load(): Promise<void> {
  if (loaded) return
  try {
    const parsed = JSON.parse(await fs.promises.readFile(STORE_PATH, 'utf8')) as unknown
    if (!Array.isArray(parsed) || !parsed.every(isCandidateRecord)) throw new Error('Candidate pool has an invalid shape')
    records = parsed
    loaded = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      records = []
      loaded = true
      return
    }
    console.error('Candidate pool read failed', error)
    throw error
  }
}

function isCandidateRecord(value: unknown): value is CandidateRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<CandidateRecord>
  return typeof record.key === 'string'
    && typeof record.firstSeenAt === 'string'
    && typeof record.firstSeenPriceUsd === 'number'
    && typeof record.firstSeenScore === 'number'
    && typeof record.highestScore === 'number'
    && typeof record.lastEvaluatedAt === 'string'
    && typeof record.expiresAt === 'string'
    && typeof record.consecutiveQualifying === 'number'
    && typeof record.lastReason === 'string'
    && Boolean(record.token && typeof record.token.address === 'string' && typeof record.token.chain === 'string')
}

async function persist(): Promise<void> {
  await atomicWrite(STORE_PATH, JSON.stringify(records, null, 2))
}

export async function getCandidatePool(): Promise<CandidateRecord[]> {
  await load()
  return structuredClone(records)
}

export async function replaceCandidatePool(next: CandidateRecord[]): Promise<void> {
  await mutate(async () => {
    await load()
    records = structuredClone(next)
    await persist()
  })
}

export async function removeCandidate(key: string): Promise<boolean> {
  return mutate(async () => {
    await load()
    const before = records.length
    records = records.filter((record) => record.key !== key)
    if (records.length === before) return false
    await persist()
    return true
  })
}
