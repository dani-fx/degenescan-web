import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeLegend } from './legend-policy'
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

function token(address = 'MintLegendPersist'): ScoredToken {
  const now = Date.now()
  return {
    address, symbol: 'KEEP', name: 'Keep', chain: 'solana', priceUsd: 1,
    priceChange24h: 10, volume24h: 150_000, liquidity: 75_000, marketCap: 300_000,
    fdv: 300_000, createdAt: new Date(now - 60_000).toISOString(), pairCreatedAt: now - 60_000,
    txns24h: { buys: 120, sells: 40 }, socials: [], logoURI: '', score: 75, tier: 'B',
    signals: [], explanation: '', warnings: [], fetchedAt: new Date(now).toISOString(),
    signalClass: 'LOW', rugcheck: { checked: true, safe: true },
  }
}

describe('legend store', () => {
  it('atomically persists observatory records across module reloads', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    vi.resetModules()
    const store = await import('./legend-store')
    const record = observeLegend(null, token())!

    await store.replaceLegendRecords([record])
    expect((await store.getLegendRecords()).map((entry) => entry.key)).toEqual([record.key])
    expect(JSON.parse(fs.readFileSync(path.join(tempDir, 'legend-observatory.json'), 'utf8'))).toHaveLength(1)

    vi.resetModules()
    const reloaded = await import('./legend-store')
    expect((await reloaded.getLegendRecords())[0]?.firstSeenPriceUsd).toBe(1)
  })

  it('persists verified EVM observatory records', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    vi.resetModules()
    const store = await import('./legend-store')
    const record = observeLegend(null, { ...token(), chain: 'base', address: '0xAbC' })!

    await store.replaceLegendRecords([record])

    expect((await store.getLegendRecords())[0]?.key).toBe('base:0xabc')
  })

  it('fails closed without overwriting corrupt observatory data', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    const file = path.join(tempDir, 'legend-observatory.json')
    fs.writeFileSync(file, '{broken-json')
    vi.resetModules()
    const store = await import('./legend-store')

    await expect(store.getLegendRecords()).rejects.toThrow()
    await expect(store.getLegendRecordsSafe()).resolves.toEqual({ records: [], unavailable: true })
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken-json')
  })

  it('rejects persisted records without verified safe RugCheck state', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    const record = observeLegend(null, token())!
    fs.writeFileSync(path.join(tempDir, 'legend-observatory.json'), JSON.stringify([
      { ...record, token: { ...record.token, rugcheck: { checked: false, safe: false } } },
    ]))
    vi.resetModules()
    const store = await import('./legend-store')
    await expect(store.getLegendRecords()).rejects.toThrow('Invalid legend observatory storage')
  })

  it('rejects malformed nested records and mismatched canonical identities', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    const record = observeLegend(null, token())!
    const invalidRecords = [
      { ...record, key: 'solana:DifferentMint' },
      { ...record, snapshots: [{}] },
      { ...record, drivers: [42] },
      { ...record, token: { ...record.token, score: undefined } },
    ]

    for (const invalid of invalidRecords) {
      fs.writeFileSync(path.join(tempDir, 'legend-observatory.json'), JSON.stringify([invalid]))
      vi.resetModules()
      const store = await import('./legend-store')
      await expect(store.getLegendRecords()).rejects.toThrow('Invalid legend observatory storage')
    }
  })

  it('does not expose expired records', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    vi.resetModules()
    const store = await import('./legend-store')
    const record = observeLegend(null, token())!
    await store.replaceLegendRecords([{ ...record, expiresAt: new Date(Date.now() - 1).toISOString() }])
    await expect(store.getLegendRecords()).resolves.toEqual([])
  })

  it('serializes the complete read-modify-write transaction', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    vi.resetModules()
    const store = await import('./legend-store')
    const first = observeLegend(null, token('First'))!
    const second = observeLegend(null, token('Second'))!

    await Promise.all([first, second].map((record) => store.mutateLegendRecords(async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const records = [...current, record]
      return { records, result: records.length }
    })))

    expect((await store.getLegendRecords()).map((record) => record.key).sort()).toEqual(['solana:First', 'solana:Second'])
  })

  it('caps read visibility and hides records beyond the absolute 14-day horizon', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'degenescan-legends-'))
    process.env.DATA_DIR = tempDir
    vi.resetModules()
    const store = await import('./legend-store')
    const now = Date.now()
    const visible = Array.from({ length: 101 }, (_, index) => observeLegend(null, token(`Mint${index}`), now)!)
    const overlong = {
      ...observeLegend(null, token('Overlong'), now)!,
      expiresAt: new Date(now + 14 * 24 * 60 * 60_000 + 1).toISOString(),
    }
    await store.replaceLegendRecords([...visible, overlong])

    const loaded = await store.getLegendRecords(now)
    expect(loaded).toHaveLength(100)
    expect(loaded.some((record) => record.key === overlong.key)).toBe(false)
  })
})
