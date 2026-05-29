# Client-Side Service Adapters

This directory contains client-side provider adapters that separate external service calls from UI code. These modules ship with the mobile app — they are not a backend.

## Structure

- `rpc/` — Helius RPC/WSS plus Alchemy RPC fallback, cooldown, rate-limit handling, DAS enrichment, and transaction history.
- `private-payments/` — MagicBlock private payment preparation and client-side settlement broadcast.
- `umbra/` — Umbra indexer and relayer calls.
- `offline/` — Client-side durable nonce/offline payment helpers.
- `wallet-activity/` — Narrow WSS account subscription for wallet refresh events.
- `capabilities/` — Static local capability map.

## Configuration

Use Expo `EXPO_PUBLIC_*` variables for endpoint URLs. These values are public client config, not hidden secrets. Protect Helius and Alchemy keys with provider-side controls such as secure URLs, allowlists, method restrictions, and usage limits.

## Hosted Workers

The AI proxy worker lives in `workers/ai-proxy/` and is deployed separately to Cloudflare. Do not import it into app code.
