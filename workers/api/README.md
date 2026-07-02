# OffPay API Worker

Cloudflare Worker for OffPay's protected backend API surface. Provider credentials live here instead of in the Expo client bundle.

Feature surfaces:

- `GET|POST|DELETE /api/pending/backup`
- `/api/bootstrap/*`
- `/api/capabilities`
- `/api/market/*`
- `/api/wallet/*`
- `/api/rpc/*`
- `/api/swap/*`
- `/api/payment/*`
- `/api/offline/*`
- `/api/privacy/*`
- `/api/stream/*`
- `/api/risk/*`
- `/api/umbra/*`

## Storage

- Upstash-compatible REST KV still backs rate limits, bootstrap nonces, offline nonce-pool locks/idempotency, quote state, trigger state, recurring state, and privacy-swap session state.
- Cloudflare R2 backs encrypted pending backup objects through the `PENDING_BACKUP_BUCKET` binding.
- MongoDB Atlas backs invite access and hourly AI chat credits through `invite_codes`, `invite_access`, and `ai_chat_usage`.

## Cloudflare Setup

Create the encrypted pending-backup bucket once:

```sh
npx wrangler r2 bucket create offpay-pending-backups
```

Use `workers/api/wrangler.toml` for non-secret Worker vars:

```toml
MIN_APP_VERSION = "1.0.0"
BOOTSTRAP_SECRET_VERSION = "1"
OFFPAY_PROTOTYPE_MODE = "true"
OFFPAY_ANDROID_PACKAGE_NAME = "com.offpay.app"
OFFPAY_ANDROID_ATTESTATION_MODE = "prototype_bypass"
OFFPAY_IOS_BUNDLE_ID = "com.offpay.app"
OFFPAY_IOS_TEAM_ID = "YOUR_APPLE_TEAM_ID"
OFFPAY_ALLOWED_ORIGINS = "capacitor://localhost,http://localhost,https://offpay.app"
MAGICBLOCK_DEVNET_VALIDATORS = "VALIDATOR_PUBKEY_1,VALIDATOR_PUBKEY_2"
MAGICBLOCK_MAINNET_VALIDATORS = "VALIDATOR_PUBKEY_1,VALIDATOR_PUBKEY_2"
JUPITER_API_BASE_URL = "https://api.jup.ag"
JUPITER_TRIGGER_API_BASE_URL = "https://api.jup.ag/trigger/v2"
```

Set credentials with Cloudflare Worker secrets:

```sh
npx wrangler secret put HELIUS_DEVNET_API_KEY
npx wrangler secret put HELIUS_MAINNET_API_KEY
npx wrangler secret put HELIUS_DEVNET_RPC_URL
npx wrangler secret put HELIUS_MAINNET_RPC_URL
npx wrangler secret put HELIUS_DEVNET_WS_URL
npx wrangler secret put HELIUS_MAINNET_WS_URL
npx wrangler secret put ALCHEMY_DEVNET_RPC_URL
npx wrangler secret put ALCHEMY_MAINNET_RPC_URL
npx wrangler secret put ALCHEMY_DEVNET_FALLBACK_RPC_URL
npx wrangler secret put ALCHEMY_MAINNET_FALLBACK_RPC_URL
npx wrangler secret put ALCHEMY_PRICE_API_KEY
npx wrangler secret put JUPITER_API_KEY
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
npx wrangler secret put OFFPAY_BOOTSTRAP_SECRET
npx wrangler secret put OFFPAY_BACKUP_HMAC_SECRET
npx wrangler secret put OFFPAY_DEVNET_FAUCET_SECRET_KEY
npx wrangler secret put MONGODB_URI
npx wrangler secret put MONGODB_DATABASE
npx wrangler secret put OFFPAY_INVITE_CODE_PEPPER
```

Prototype Android bootstrap does not require Google Play Integrity or a Google service account.
For production Android builds, set `OFFPAY_PROTOTYPE_MODE=false`, set `OFFPAY_ANDROID_ATTESTATION_MODE=play_integrity`, then add:

```sh
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY
```

`UMBRA_API_KEY` is optional. Set it only if a private/gated Umbra indexer or relayer gives you one; the default public Umbra endpoints are not API-key gated.

Generate the two OffPay HMAC secrets independently:

```sh
openssl rand -hex 32
```

Do not reuse the same value for `OFFPAY_BOOTSTRAP_SECRET` and `OFFPAY_BACKUP_HMAC_SECRET`.
If `OFFPAY_BOOTSTRAP_SECRET` is rotated, increment `BOOTSTRAP_SECRET_VERSION` so clients reprovision.

`OFFPAY_DEVNET_FAUCET_SECRET_KEY` funds the in-app Devnet faucet by signing normal Devnet
transactions from a dedicated treasury wallet. Store a base58-encoded 64-byte Solana secret key, or
a 32-byte seed, and fund that wallet on Devnet. This avoids calling Solana's public
`requestAirdrop` faucet from the mobile app.

The Devnet faucet is backend-gated to one claim per authenticated wallet every 4 hours. It sends
0.25 Devnet SOL and tops token balances up to these per-wallet caps:

- `dUSDC`: 100 tokens on mint `4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7`
- `dUSDT`: 100 tokens on mint `DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6`
- `USDC`: 5 tokens on `OFFPAY_DEVNET_USDC_MINT`, defaulting to
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

Fund the treasury wallet's associated token accounts for those three mints. The treasury also pays
the 0.25 SOL transfer, transaction fees, and recipient associated-token-account rent when a wallet
does not already have those token accounts.

`workers/api/.dev.vars` is ignored by git. Use `workers/api/.dev.vars.example` as the local template.

Run the Mongo setup once against the same database used by invite access:

```sh
MONGODB_URI='mongodb+srv://...' MONGODB_DATABASE='offpay' npm run invite:setup
```

Hourly AI chat credits are tracked in `ai_chat_usage`. Each document stores the active
rate-limit window (`window_started_at`, `reset_at`, `window_ms`) plus audit timestamps such as
`last_status_checked_at`, `last_consumed_at`, `last_released_at`, `last_release_reason`,
`last_blocked_at`, `last_reset_at`, and `last_reset_reason`. Provider/proxy failures release a
newly charged turn by removing its `turnId` from `consumed_turn_ids` and decrementing `used`, so
timeouts do not waste chat credits. The API Worker cron runs every minute and resets expired
windows in Mongo, so the reset lifecycle does not depend on the client app being open. Request-time
status/consume calls also validate and refresh the same window as a backstop.

## Health

`GET /api/health` returns:

- `ok` when protected auth, platform attestation, pending backup, and core swap are configured.
- `degraded` when core routes are configured but optional/private surfaces such as market prices, private payment, private swap, offline, or Umbra are incomplete.
- `misconfigured` with HTTP 503 when required core bindings are missing.

The public health response exposes only feature readiness booleans. Missing binding names are written to sanitized Worker logs.

## Deploy

```sh
npm run typecheck:api-worker
npm run deploy:api-worker
```

Point the app at the deployed Worker, or a custom domain routed to it, with:

```sh
EXPO_PUBLIC_OFFPAY_API_ORIGIN=https://api.offpay.app
EXPO_PUBLIC_OFFPAY_API_ALLOWED_ORIGINS=https://api.offpay.app
```

Route `api.offpay.app` to this Worker and set:

```sh
EXPO_PUBLIC_OFFPAY_API_ORIGIN=https://api.offpay.app
EXPO_PUBLIC_OFFPAY_API_ALLOWED_ORIGINS=https://api.offpay.app
```

After the custom domain is live, set `workers_dev = false` in `workers/api/wrangler.toml` to avoid an extra public production endpoint.
