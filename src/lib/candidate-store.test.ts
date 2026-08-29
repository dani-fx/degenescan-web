import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCandidate } from './candidate-policy'
import type { ScoredToken } from './types'

let tempDir = ''
const originalDataDir = process.env.DATA_DIR

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalDataDir
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
  vi.resetModules()
})

function token(): ScoredToken {
  const now = Date.now()
  return {
    address: 'MintPersist', symbol: 'SAVE', name: 'Save', chain: 'solana', priceUsd: 1,
    priceChange24h: 0, volume24h: 100_000, liquidity: 40_000, marketCap: 100_000,
    fdv: 100_000, createdAt: new Date(now - 60_000).toISOString(), pairCreatedAt: now - 60_000,
    txns24h: { buys: 70, sells: 30 }, socials: [], logoURI: '', score: 75, tier: 'B',
    signals: [], explanation: '', warnings: [], fetchedAt: new Date(now).toISOString(),
    signalClass: 'HIGH', rugcheck: { checked: true, safe: true },
  }
}

describe('candidate store', () => {
  it('atomically persists and removes candidate records', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-candidates-'))
    process.env.DATA_DIR = tempDir
    vi.resetModules()
    const store = await import('./candidate-store')
    const record = createCandidate(token())

    await store.replaceCandidatePool([record])
    expect((await store.getCandidatePool()).map((entry) => entry.key)).toEqual([record.key])
    expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'candidate-pool.json'), 'utf8'))).toHaveLength(1)

    expect(await store.removeCandidate(record.key)).toBe(true)
    expect(await store.getCandidatePool()).toEqual([])
    expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'candidate-pool.json'), 'utf8'))).toEqual([])
  })

  it('fails closed without overwriting a corrupt pool', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-candidates-'))
    process.env.DATA_DIR = tempDir
    const file = path.join(tempDir, 'candidate-pool.json')
    fs.writeFileSync(file, '{broken-json')
    vi.resetModules()
    const store = await import('./candidate-store')

    await expect(store.getCandidatePool()).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken-json')
  })
})
