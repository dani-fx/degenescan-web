export function normalizeIntervalMs(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 60_000
  return Math.max(30_000, Math.min(10 * 60_000, Math.round(parsed)))
}

export function normalizePort(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return 8080
  return parsed
}
