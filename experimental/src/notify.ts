import type { RunnerSignal } from './types.js'

export async function notify(signal: RunnerSignal): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  const text = [
    '🧪 <b>Experimental early runner</b>',
    `<b>${escapeHtml(signal.symbol)}</b>`,
    `<b>CA:</b> <code>${escapeHtml(signal.mint)}</code>`,
    `Liquidity growth: <b>${signal.liquidityGrowthPct.toFixed(1)}%</b>`,
    `Holder growth: <b>${signal.holderGrowthPct.toFixed(1)}%</b>`,
    `Proven wallets: <b>${signal.qualifiedWallets.length}</b>`,
    '',
    'Shadow signal only — no trade executed.',
  ].join('\n')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`)
  } finally {
    clearTimeout(timer)
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
