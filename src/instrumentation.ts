export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return
  const [{ initAutoScan }, { getConfig }] = await Promise.all([
    import('./lib/auto-scan'),
    import('./lib/signal-store'),
  ])
  await initAutoScan(getConfig)
}