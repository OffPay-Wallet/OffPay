# OffPay API Worker

Cloudflare Worker for only the backend pieces needed by swap and the offline pending-backup flow.

Migrated feature surfaces:

- `GET|POST|DELETE /api/pending/backup`
- `/api/swap/*`

Auth support kept for the existing protected-request architecture:

- `GET|POST /api/bootstrap/provision`

Wallet/RPC reads, Umbra, private payments, offline slots, streams, risk, and client capabilities stay in the app through `services/` and are intentionally not duplicated here. Offline payment construction, durable nonce slot handling, QR/BLE exchange, and settlement orchestration remain client-side.

## Storage

- Upstash-compatible REST KV still backs rate limits, bootstrap nonces, quote state, trigger state, recurring state, and privacy-swap session state.
- Cloudflare R2 backs encrypted pending backup objects through the `PENDING_BACKUP_BUCKET` binding.

## Cloudflare Setup

Create the encrypted pending-backup bucket once:

```sh
npx wrangler r2 bucket create offpay-pending-backups
```

Use `workers/api/wrangler.toml` for non-secret Worker vars:

```toml
MIN_APP_VERSION = "1.0.0"
BOOTSTRAP_SECRET_VERSION = "1"
OFFPAY_ANDROID_PACKAGE_NAME = "com.offpay.app"
OFFPAY_ANDROID_ATTESTATION_MODE = "play_integrity"
OFFPAY_IOS_BUNDLE_ID = "com.offpay.app"
OFFPAY_IOS_TEAM_ID = "YOUR_APPLE_TEAM_ID"
MAGICBLOCK_DEVNET_VALIDATORS = "VALIDATOR_PUBKEY_1,VALIDATOR_PUBKEY_2"
MAGICBLOCK_MAINNET_VALIDATORS = "VALIDATOR_PUBKEY_1,VALIDATOR_PUBKEY_2"
```

Set credentials with Cloudflare Worker secrets:

```sh
npx wrangler secret put JUPITER_API_KEY
npx wrangler secret put KV_REST_API_URL
npx wrangler secret put KV_REST_API_TOKEN
npx wrangler secret put OFFPAY_BOOTSTRAP_SECRET
npx wrangler secret put OFFPAY_BACKUP_HMAC_SECRET
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put HELIUS_DEVNET_RPC_URL
npx wrangler secret put HELIUS_MAINNET_RPC_URL
npx wrangler secret put QUICKNODE_DEVNET_RPC_URL
npx wrangler secret put QUICKNODE_MAINNET_RPC_URL
npx wrangler secret put MAGICBLOCK_DEVNET_API_KEY
npx wrangler secret put MAGICBLOCK_MAINNET_API_KEY
```

Generate the two OffPay HMAC secrets independently:

```sh
openssl rand -hex 32
```

Do not reuse the same value for `OFFPAY_BOOTSTRAP_SECRET` and `OFFPAY_BACKUP_HMAC_SECRET`.
If `OFFPAY_BOOTSTRAP_SECRET` is rotated, increment `BOOTSTRAP_SECRET_VERSION` so clients reprovision.

`workers/api/.dev.vars` is ignored by git. Use `workers/api/.dev.vars.example` as the local template.

## Health

`GET /api/health` returns:

- `ok` when protected auth, platform attestation, pending backup, and core swap are configured.
- `degraded` when core routes are configured but private-swap envelope support is incomplete.
- `misconfigured` with HTTP 503 when required core bindings are missing.

The public health response exposes only feature readiness booleans. Missing binding names are written to sanitized Worker logs.

## Deploy

```sh
npm run typecheck:api-worker
npm run deploy:api-worker
```

Point the app at the deployed Worker, or a custom domain routed to it, with:

```sh
EXPO_PUBLIC_OFFPAY_API_ORIGIN=https://offpay-api.<account>.workers.dev
```

For production, prefer routing `api.offpay.app` to this Worker so the app can keep its existing API origin. After the custom domain is live, set `workers_dev = false` in `workers/api/wrangler.toml` to avoid an extra public production endpoint.
