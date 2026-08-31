import { describe, expect, it, vi } from 'vitest'

vi.mock('./storage', () => ({
  atomicWriteSync: vi.fn(),
  dataPath: () => '/tmp/degenescan-auto-scan-test/missing.json',
  fetchWithTimeout: vi.fn(),
}))

import { getAutoScanState, initAutoScan, isExpectedScanContention, normalizeAutoScanIntervalMs, setAutoScanInterval } from './auto-scan'

describe('autoscan interval', () => {
  it('uses an injected persisted interval and clamps unsafe values', async () => {
    vi.useFakeTimers()
    expect(normalizeAutoScanIntervalMs(120_000)).toBe(120_000)
    expect(normalizeAutoScanIntervalMs(1)).toBe(30_000)
    expect(normalizeAutoScanIntervalMs(Number.POSITIVE_INFINITY)).toBe(300_000)
    expect(isExpectedScanContention(409)).toBe(true)
    expect(isExpectedScanContention(429)).toBe(false)

    let persistedInterval = 120_000
    const configLoader = vi.fn(async () => ({ pollIntervalMs: persistedInterval }))
    await initAutoScan(configLoader)
    expect(getAutoScanState().intervalMinutes).toBe(2)
    expect(setAutoScanInterval(120_000).intervalMinutes).toBe(2)

    persistedInterval = 60_000
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getAutoScanState().intervalMinutes).toBe(1)

    let resolveRefresh!: (value: { pollIntervalMs: number }) => void
    configLoader.mockImplementation(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const callsBeforeStall = configLoader.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(configLoader).toHaveBeenCalledTimes(callsBeforeStall + 1)
    resolveRefresh({ pollIntervalMs: 180_000 })
    await vi.waitFor(() => expect(getAutoScanState().intervalMinutes).toBe(3))

    vi.resetModules()
    const secondModuleInstance = await import('./auto-scan')
    secondModuleInstance.setAutoScanInterval(90_000)
    expect(getAutoScanState().intervalMinutes).toBe(1.5)
    expect(secondModuleInstance.getAutoScanState().intervalMinutes).toBe(1.5)
    vi.useRealTimers()
  })
})
