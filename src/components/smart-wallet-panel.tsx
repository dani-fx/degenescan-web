'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, CircleDot, Network, Radar, RefreshCw, ShieldCheck, TriangleAlert, WalletCards, Zap } from 'lucide-react'
import type { SmartWalletSnapshot, SmartWalletTradeRow } from '@/lib/smart-wallet'

function short(value: string): string {
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

function money(value: number): string {
  const sign = value < 0 ? '-' : ''
  const amount = Math.abs(value)
  if (amount >= 1_000_000) return `${sign}$${(amount / 1_000_000).toFixed(2)}M`
  if (amount >= 1_000) return `${sign}$${(amount / 1_000).toFixed(1)}K`
  return `${sign}$${amount.toFixed(0)}`
}

function walletUrl(chain: string, address: string): string {
  if (chain === 'solana') return `https://solscan.io/account/${encodeURIComponent(address)}`
  if (chain === 'base') return `https://basescan.org/address/${encodeURIComponent(address)}`
  if (chain === 'bsc') return `https://bscscan.com/address/${encodeURIComponent(address)}`
  return `https://etherscan.io/address/${encodeURIComponent(address)}`
}

function chartUrl(trade: SmartWalletTradeRow): string {
  return `https://dexscreener.com/${encodeURIComponent(trade.chain)}/${encodeURIComponent(trade.tokenAddress)}`
}

export default function SmartWalletPanel({ pollIntervalMs }: { pollIntervalMs: number }) {
  const [snapshot, setSnapshot] = useState<SmartWalletSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/smart-wallets', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Smart-wallet monitor unavailable (${response.status})`)
      const data = await response.json() as SmartWalletSnapshot
      setSnapshot(data)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Smart-wallet monitor unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), Math.max(30_000, pollIntervalMs))
    return () => clearInterval(timer)
  }, [pollIntervalMs, refresh])

  const status = snapshot?.status
  const wallets = snapshot?.wallets.slice(0, 6) ?? []
  const trades = snapshot?.recentTrades.slice(0, 6) ?? []

  return (
    <section className="glass-card rounded-2xl overflow-hidden border border-violet-400/20">
      <div className="p-5 border-b border-border/50 bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-400/10 border border-violet-400/25 flex items-center justify-center">
              <Radar size={20} className="text-violet-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold tracking-tight">Smart Wallet Radar</h2>
                {snapshot && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"><CircleDot size={9} /> LIVE</span>}
              </div>
              <p className="text-xs text-muted-foreground">Repeat early-runner wallets · convergence · common-funder evidence</p>
            </div>
          </div>
          <button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1.5 self-start rounded-full border border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric icon={<Activity size={12} />} label="Analyzed" value={status?.analyzedTokens ?? 0} />
          <Metric icon={<WalletCards size={12} />} label="Candidates" value={status?.candidates ?? 0} />
          <Metric icon={<ShieldCheck size={12} />} label="Qualified" value={status?.qualified ?? 0} accent />
          <Metric icon={<Zap size={12} />} label="Pending" value={status?.pendingAlerts ?? 0} />
        </div>
      </div>

      {error ? (
        <div className="p-5 flex items-center gap-2 text-sm text-tier-c"><TriangleAlert size={16} />{error}</div>
      ) : loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Connecting to wallet intelligence…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-border/40">
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><WalletCards size={14} className="text-violet-300" /> Qualified wallets</h3>
              <span className="text-[10px] text-muted-foreground">Score ≥ 60</span>
            </div>
            {wallets.length === 0 ? (
              <Empty icon={<Network size={20} />} title="Learning wallet behavior" detail="No wallet has enough repeat runner history and realized PnL yet. Strict cold starts are expected." />
            ) : (
              <div className="space-y-2">
                {wallets.map((wallet) => (
                  <a key={`${wallet.chain}:${wallet.walletAddress}`} href={walletUrl(wallet.chain, wallet.walletAddress)} target="_blank" rel="noreferrer" className="block rounded-xl border border-border/50 bg-background/35 p-3 hover:border-violet-400/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold">{short(wallet.walletAddress)}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[9px] uppercase text-muted-foreground">{wallet.chain}</span></div>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">{wallet.reasons.slice(0, 2).join(' · ')}</p>
                      </div>
                      <div className="text-right"><div className="text-lg font-black text-violet-300">{wallet.score}</div><div className="text-[8px] uppercase tracking-widest text-muted-foreground">score</div></div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]"><Mini label="Hits" value={`${wallet.runnerHits}/${wallet.samples}`} /><Mini label="Win rate" value={`${Math.round(wallet.winRate * 100)}%`} /><Mini label="PnL" value={money(wallet.realizedPnlUsd)} /><Mini label="Entry" value={`#${Math.round(wallet.medianEntryRank)}`} /></div>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Zap size={14} className="text-primary" /> Recent entries</h3>
              {snapshot?.updatedAt && <span className="text-[10px] text-muted-foreground">{new Date(snapshot.updatedAt).toLocaleTimeString()}</span>}
            </div>
            {trades.length === 0 ? (
              <Empty icon={<Radar size={20} />} title="Watching for fresh entries" detail="Qualified wallets are polled continuously. New-token buys appear here and alert through Telegram when conviction passes." />
            ) : (
              <div className="space-y-2">
                {trades.map((trade) => (
                  <a key={`${trade.chain}:${trade.tokenAddress}:${trade.walletAddress}:${trade.tradedAt}`} href={chartUrl(trade)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/35 p-3 hover:border-primary/30 transition-colors">
                    <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-bold text-sm">{trade.tokenSymbol}</span><span className="text-[9px] uppercase text-muted-foreground">{trade.chain}</span></div><p className="font-mono text-[10px] text-muted-foreground">{short(trade.walletAddress)}</p></div>
                    <div className="text-right"><div className="text-xs font-semibold">{money(trade.volumeUsd)}</div><div className="text-[9px] text-muted-foreground">{new Date(trade.tradedAt).toLocaleTimeString()}</div></div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/40 px-5 py-3 text-[10px] text-muted-foreground">
        <ShieldCheck size={12} className="text-emerald-400" /> Evidence-based research signal, not proof of insider identity or financial advice.
      </div>
    </section>
  )
}

function Metric({ icon, label, value, accent = false }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
  return <div className="rounded-xl border border-border/40 bg-background/30 p-3"><div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">{icon}{label}</div><div className={`mt-1 text-xl font-black ${accent ? 'text-emerald-300' : 'text-foreground'}`}>{value}</div></div>
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/30 p-1.5"><div className="text-[8px] uppercase text-muted-foreground">{label}</div><div className="truncate font-semibold">{value}</div></div>
}

function Empty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-border/60 p-7 text-center"><div className="mx-auto mb-2 w-fit text-muted-foreground">{icon}</div><p className="text-sm font-medium">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{detail}</p></div>
}
