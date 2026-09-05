export interface SmartWalletStatus {
  analyzedTokens: number
  candidates: number
  qualified: number
  pendingAlerts: number
}

export interface SmartWalletRow {
  chain: string
  walletAddress: string
  score: number
  samples: number
  runnerHits: number
  hitRate: number
  winRate: number
  realizedPnlUsd: number
  medianEntryRank: number
  funderAddress: string | null
  funderName: string | null
  reasons: string[]
}

export interface SmartWalletTradeRow {
  chain: string
  walletAddress: string
  tokenAddress: string
  tokenSymbol: string
  tradedAt: string
  volumeUsd: number
  alertedAt: string | null
}

export interface SmartWalletCandidate {
  chain: string
  walletAddress: string
  score: number
  samples: number
  runnerHits: number
  winRate: number | null
  realizedPnlUsd: number | null
  performanceFetchedAt: string | null
  blockers: string[]
}

export interface SmartWalletSnapshot {
  enabled: true
  updatedAt: string
  status: SmartWalletStatus
  candidates?: SmartWalletCandidate[]
  wallets: SmartWalletRow[]
  recentTrades: SmartWalletTradeRow[]
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Smart-wallet response was malformed')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Smart-wallet response was malformed')
  return value
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Smart-wallet response was malformed')
  return value
}

function nullableText(value: unknown): string | null {
  return value == null ? null : text(value)
}

export function normalizeSmartWalletSnapshot(input: unknown): SmartWalletSnapshot {
  const root = record(input)
  const status = record(root.status)
  if (root.enabled !== true || typeof root.updatedAt !== 'string' || !Array.isArray(root.wallets) || !Array.isArray(root.recentTrades)) {
    throw new Error('Smart-wallet response was malformed')
  }

  if (root.candidates !== undefined && !Array.isArray(root.candidates)) throw new Error('Smart-wallet response was malformed')
  return {
    ...(Array.isArray(root.candidates) ? { candidates: root.candidates.slice(0, 20).map(value => {
      const row = record(value)
      if (!Array.isArray(row.blockers)) throw new Error('Smart-wallet response was malformed')
      return { chain: text(row.chain), walletAddress: text(row.walletAddress), score: number(row.score),
        samples: number(row.samples), runnerHits: number(row.runnerHits),
        winRate: row.winRate === null ? null : number(row.winRate),
        realizedPnlUsd: row.realizedPnlUsd === null ? null : number(row.realizedPnlUsd),
        performanceFetchedAt: nullableText(row.performanceFetchedAt), blockers: row.blockers.map(text) }
    }) } : {}),
    enabled: true,
    updatedAt: root.updatedAt,
    status: {
      analyzedTokens: number(status.analyzedTokens),
      candidates: number(status.candidates),
      qualified: number(status.qualified),
      pendingAlerts: number(status.pendingAlerts),
    },
    wallets: root.wallets.slice(0, 20).map((value) => {
      const row = record(value)
      if (!Array.isArray(row.reasons)) throw new Error('Smart-wallet response was malformed')
      return {
        chain: text(row.chain),
        walletAddress: text(row.walletAddress),
        score: number(row.score),
        samples: number(row.samples),
        runnerHits: number(row.runnerHits),
        hitRate: number(row.hitRate),
        winRate: number(row.winRate),
        realizedPnlUsd: number(row.realizedPnlUsd),
        medianEntryRank: number(row.medianEntryRank),
        funderAddress: nullableText(row.funderAddress),
        funderName: nullableText(row.funderName),
        reasons: row.reasons.map(text),
      }
    }),
    recentTrades: root.recentTrades.slice(0, 30).map((value) => {
      const row = record(value)
      return {
        chain: text(row.chain),
        walletAddress: text(row.walletAddress),
        tokenAddress: text(row.tokenAddress),
        tokenSymbol: text(row.tokenSymbol),
        tradedAt: text(row.tradedAt),
        volumeUsd: number(row.volumeUsd),
        alertedAt: nullableText(row.alertedAt),
      }
    }),
  }
}
