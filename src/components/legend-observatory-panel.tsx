'use client'

import { useCallback, useEffect, useState } from 'react'
import { Flame, Radar, ShieldCheck, TrendingUp, TriangleAlert } from 'lucide-react'
import type { LegendRecord, LegendStage } from '@/lib/legend-policy'

interface LegendResponse {
  legends: LegendRecord[]
  count: number
  mode: 'shadow'
  affectsTrading: false
}

const stageLabel: Record<LegendStage, string> = {
  WATCH: 'WATCH',
  EARLY_ALERT: 'EARLY',
  BREAKOUT_CANDIDATE: 'BREAKOUT',
  PERSISTENT_LEADER: 'LEADER',
}

const stageClass: Record<LegendStage, string> = {
  WATCH: 'border-border/60 bg-muted/40 text-muted-foreground',
  EARLY_ALERT: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  BREAKOUT_CANDIDATE: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  PERSISTENT_LEADER: 'border-primary/40 bg-primary/15 text-primary',
}

function money(value: number): string {
  if (!Number.isFinite(value)) return '$0'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toPrecision(3)}`
}

function movePct(record: LegendRecord): number {
  return record.firstSeenPriceUsd > 0
    ? ((record.token.priceUsd - record.firstSeenPriceUsd) / record.firstSeenPriceUsd) * 100
    : 0
}

export default function LegendObservatoryPanel({ pollIntervalMs }: { pollIntervalMs: number }) {
  const [records, setRecords] = useState<LegendRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/legend', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Legend observatory failed (${response.status})`)
      const data = await response.json() as Partial<LegendResponse>
      if (!Array.isArray(data.legends)) throw new Error('Legend observatory response was malformed')
      setRecords(data.legends)
      setUpdatedAt(new Date().toISOString())
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Legend observatory failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), Math.max(30_000, pollIntervalMs))
    return () => clearInterval(timer)
  }, [pollIntervalMs, refresh])

  const visible = records.slice(0, 6)
  const leaders = records.filter((record) => record.stage === 'PERSISTENT_LEADER').length
  const breakouts = records.filter((record) => record.stage === 'BREAKOUT_CANDIDATE').length

  return (
    <section className="glass-card rounded-2xl overflow-hidden border border-orange-400/15">
      <div className="p-5 border-b border-border/50 bg-gradient-to-r from-orange-500/10 via-transparent to-primary/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-orange-400/10 border border-orange-400/20 flex items-center justify-center">
                <Flame size={18} className="text-orange-300" />
              </div>
              <div>
                <h2 className="font-bold tracking-tight">Legend Observatory</h2>
                <p className="text-xs text-muted-foreground">Organic breakout persistence · Multichain shadow mode</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">{leaders} leaders</span>
            <span className="rounded-full border border-orange-400/20 bg-orange-400/10 px-2.5 py-1 text-orange-300">{breakouts} breakouts</span>
            <button onClick={() => void refresh()} className="rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors">
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck size={13} className="text-emerald-400" />
          Research ranking only — never opens trades or weakens safety gates.
          {updatedAt && <span className="ml-auto hidden sm:inline">Updated {new Date(updatedAt).toLocaleTimeString()}</span>}
        </div>
      </div>

      {error ? (
        <div className="p-5 text-sm text-tier-c flex items-center gap-2"><TriangleAlert size={16} />{error}</div>
      ) : loading ? (
        <div className="p-8 text-sm text-muted-foreground text-center">Loading observatory…</div>
      ) : visible.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <Radar size={24} className="mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No verified multichain contenders yet.</p>
          <p className="text-xs text-muted-foreground/70">Autoscan will retain promising tokens for up to 72 hours.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-px bg-border/40">
          {visible.map((record) => {
            const move = movePct(record)
            return (
              <article key={record.key} className="bg-background/70 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate">{record.token.symbol}</span>
                      <span className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${stageClass[record.stage]}`}>
                        {stageLabel[record.stage]}
                      </span>
                      {record.entryQuality !== 'EARLY' && (
                        <span className="text-[10px] rounded-full border border-tier-c/30 bg-tier-c/10 px-2 py-0.5 text-tier-c">
                          {record.entryQuality}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{record.token.name}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black text-orange-300">{record.legendScore}</div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">legend</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-[11px]">
                  <Metric label="Price" value={money(record.token.priceUsd)} />
                  <Metric label="Since seen" value={`${move >= 0 ? '+' : ''}${move.toFixed(1)}%`} positive={move >= 0} />
                  <Metric label="Liquidity" value={money(record.token.liquidity)} />
                  <Metric label="Observations" value={String(record.snapshots.length)} />
                </div>

                <div className="space-y-1.5 text-[11px]">
                  {record.drivers.slice(0, 2).map((driver) => (
                    <div key={driver} className="flex items-center gap-2 text-emerald-300/90"><TrendingUp size={12} />{driver}</div>
                  ))}
                  {record.risks.slice(0, 2).map((risk) => (
                    <div key={risk} className="flex items-center gap-2 text-muted-foreground"><TriangleAlert size={12} />{risk}</div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[10px]">
                  <span className="text-muted-foreground">Data {record.dataCompleteness}% · first seen {new Date(record.firstSeenAt).toLocaleString()}</span>
                  <div className="flex gap-2">
                    <a href={`https://dexscreener.com/solana/${record.token.address}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">Chart</a>
                    <a href={`https://solscan.io/token/${record.token.address}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">Token</a>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/30 p-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-semibold truncate ${positive === true ? 'text-emerald-300' : positive === false ? 'text-tier-c' : 'text-foreground'}`}>{value}</div>
    </div>
  )
}
