/**
 * Simple in-memory cache with TTL.
 * Used by holder-distribution.ts for RugCheck report caching.
 */

export class MemoryCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxSize) {
      // evict oldest
      const oldest = Array.from(this.store.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
      if (oldest) this.store.delete(oldest[0])
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }
}
