# API And Auth Contract

The client sends OffPay backend traffic through the configured API Worker custom domain from `lib/api/offpay-api-client.ts`. Chain, wallet, stream, Umbra, private payment, offline helper, swap, bootstrap, and pending-backup paths route through the Worker.

## Auth Flow

```mermaid
sequenceDiagram
  participant Client
  participant Storage as offpay-api-storage
  participant Wallet as secure-wallet-store
  participant Backend as api.offpay.app

  Client->>Backend: GET /api/bootstrap/provision?wallet=...
  Backend-->>Client: nonce, expiresAt
  Client->>Wallet: load signing material
  Client->>Backend: POST /api/bootstrap/provision with nonce signature and attestation fields
  Backend-->>Client: request secret, issuedAt, bootstrapVersion
  Client->>Storage: persist request secret, device id, bootstrap version
  Client->>Backend: protected Worker request with wallet signature and HMAC headers
```

## Protected Headers

`lib/offpay-api-auth.ts` builds these headers for protected requests:

- `X-Wallet-Address`
- `X-Timestamp`
- `X-Signature`
- `X-App-HMAC`
- `X-App-Version`
- `X-Device-Id`
- `X-Network`
- `X-Bootstrap-Version`

The signed message is `offpay:<wallet>:<timestamp>:<method>:<pathAndQuery>:<bodyHash>`. The HMAC message is `<timestamp>:<wallet>:<method>:<pathAndQuery>`.

## Recovery Behavior

`offpayApiRequest()` retries a `SIGNATURE_INVALID` request once. It also runs bootstrap recovery when local bootstrap credentials are missing, or for `SECRET_ROTATED` / `HMAC_INVALID` when an auth recovery handler is registered.

## Network Contract

- UI networks are `mainnet-beta` and `devnet`.
- OffPay API and provider-router networks are `mainnet` and `devnet`.
- `toOffpayNetwork()` maps `mainnet-beta` to `mainnet`.
- `DEFAULT_NETWORK` is `mainnet-beta`.

## Backend And Client Route Groups Used

```mermaid
flowchart TB
  ApiClient["lib/offpay-api-client.ts"]
  Worker["OffPay API Worker"]
  Providers["Worker providers: Helius / Alchemy / Jupiter / MagicBlock / Umbra"]
  Bootstrap["/api/bootstrap/provision"]
  Capabilities["/api/capabilities"]
  Wallet["/api/wallet/*"]
  Stream["/api/stream/*"]
  Pending["/api/pending/backup"]
  Swap["/api/swap/*"]
  Payment["/api/payment/*"]
  Rpc["/api/rpc/*"]
  Offline["/api/offline/*"]

  ApiClient --> Worker
  Worker --> Bootstrap
  Worker --> Capabilities
  Worker --> Wallet
  Worker --> Stream
  Worker --> Pending
  Worker --> Swap
  Worker --> Payment
  Worker --> Rpc
  Worker --> Offline
  Worker --> Providers
```

`types/offpay-api.ts` defines the TypeScript request and response contracts used by the Worker-backed API boundary.

## Network Access Guard

`lib/network-access-policy.ts` wraps global `fetch`. In manual offline mode, non-loopback HTTP(S) requests are rejected and TanStack Query is marked offline.
