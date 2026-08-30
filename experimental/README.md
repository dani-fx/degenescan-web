# DegeneScan Experimental

Shadow-only Solana early-runner service. It requires ordered evidence:

1. new pool (discovered within 90 minutes)
2. small organic volume (unique buyers, bounded volume per buyer)
3. liquidity growth (>=20% and >=$2k from organic baseline)
4. holder acceleration (>=15 and >=20% from organic baseline)
5. entry by a proven wallet

A wallet becomes proven only after at least 3 resolved early entries, >=60% wins, >=2 wins, and >=1.4x average observed multiple. `GOOD_WALLETS` may optionally seed reviewed wallet addresses.

The service is fail-closed on RugCheck for RUNNER status and never trades.

Endpoints: `/health`, `/tracks`, `/signals`.

Environment: `DATA_DIR`, `PORT`, `POLL_INTERVAL_MS`, optional `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
