# API And Auth Contract

The client sends only protected OffPay backend traffic to `https://api.offpay.app` from `lib/offpay-api-client.ts`. Chain, wallet, stream, Umbra, private payment, and offline helper paths route through the client-side provider adapters in `services/`.

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
  Client->>Backend: protected swap, pending backup, or bootstrap request with wallet signature and HMAC headers
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

`offpayApiRequest()` retries a `SIGNATURE_INVALID` request once. It also runs bootstrap recovery for `SECRET_ROTATED` or `HMAC_INVALID` when an auth recovery handler is registered.

## Network Contract

- UI networks are `mainnet-beta` and `devnet`.
- OffPay API and provider-router networks are `mainnet` and `devnet`.
- `toOffpayNetwork()` maps `mainnet-beta` to `mainnet`.
- `DEFAULT_NETWORK` is `mainnet-beta`.

## Backend And Client Route Groups Used

```mermaid
flowchart TB
  ApiClient["lib/offpay-api-client.ts"]
  ClientAdapters["services/ client adapters"]
  Providers["RPC: Helius / Alchemy; WSS: Helius"]
  PublicServices["Umbra / MagicBlock public APIs"]
  Bootstrap["/api/bootstrap/provision"]
  Capabilities["local capabilities"]
  Wallet["direct wallet RPC"]
  Stream["direct WSS account subscriptions"]
  Pending["/api/pending/backup"]
  Swap["/api/swap/*"]
  Payment["client private payment helpers"]
  Rpc["direct Solana RPC"]
  Offline["client offline helpers"]

  ApiClient --> Bootstrap
  ApiClient --> ClientAdapters
  ClientAdapters --> Capabilities
  ClientAdapters --> Wallet
  ClientAdapters --> Stream
  ApiClient --> Pending
  ApiClient --> Swap
  ClientAdapters --> Payment
  ClientAdapters --> Rpc
  ClientAdapters --> Offline
  ClientAdapters --> Providers
  ClientAdapters --> PublicServices
```

`types/offpay-api.ts` defines the TypeScript request and response contracts used by the retained backend routes and the client-side adapter boundary.

## Network Access Guard

`lib/network-access-policy.ts` wraps global `fetch`. In manual offline mode, non-loopback HTTP(S) requests are rejected and TanStack Query is marked offline.
