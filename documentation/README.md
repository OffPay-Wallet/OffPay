# OffPay Client Documentation

This directory documents the current client app from tracked source files. Details are scoped to code in `app/`, `services/`, `components/`, `constants/`, `hooks/`, `lib/`, `providers/`, `store/`, `types/`, `app.config.ts`, `eas.json`, and `package.json`.

## Index

- [Architecture](architecture.md): app shell, providers, screens, stores, and data flow.
- [API And Auth Contract](api-and-auth.md): retained backend origin, request signing, bootstrap, and client-side provider groups used by the app.
- [Agentic Payments System Design](agentic-payments-system-design.md): client-led AI wallet agent plan using app repo backend adapters, with a thin hosted AI/voice key-proxy only.
- [Private Payments](private-payments.md): online MagicBlock/private-payment flow, verification, fallback queueing, and offline branch.
- [Umbra SDK Usage](umbra-sdk-usage.md): Umbra client setup, client RPC adapters, signer flow, supported tokens, and vault actions.
- [Wallet, Offline, And Security](wallet-offline-security.md): wallet storage, offline mode, BLE/offline payments, and app lock surfaces.
- [Build And Testing](build-and-testing.md): native config, EAS profiles, and verification scripts.

## App Map

```mermaid
flowchart TB
  Config["app.config.ts and eas.json"]
  Layout["app/_layout.tsx"]
  Providers["providers/AppProviders.tsx"]
  Screens["app/* and app/(tabs)/*"]
  Features["components/features/*"]
  Hooks["hooks/*"]
  Stores["store/*"]
  Lib["lib/*"]
  ClientBackend["services/*"]
  Backend["https://api.offpay.app"]
  ProvidersRpc["RPC: Helius / Alchemy; WSS: Helius"]
  PublicServices["Umbra / MagicBlock public APIs"]
  SecureStore["Expo SecureStore"]

  Config --> Layout --> Providers --> Screens --> Features
  Screens --> Hooks
  Features --> Hooks
  Hooks --> Stores
  Hooks --> Lib
  Lib --> ClientBackend
  Stores --> SecureStore
  Lib --> SecureStore
  ClientBackend --> ProvidersRpc
  ClientBackend --> PublicServices
  Lib --> Backend
```

## Source Of Truth

- Routing: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, and route files under `app/`.
- App providers: `providers/AppProviders.tsx`, `providers/OffpayBootstrapProvider.tsx`, `providers/OffpayLaunchProvider.tsx`.
- Backend and client-provider contract: `lib/offpay-api-client.ts`, `lib/offpay-api-auth.ts`, `services/`, `types/offpay-api.ts`.
- Wallet and secure storage: `lib/wallet.ts`, `lib/secure-wallet-store.ts`, `store/walletStore.ts`.
- Offline behavior: `lib/network-access-policy.ts`, `hooks/useWalletModeState.ts`, `lib/offline-payments.ts`, `lib/offline-payment-slots.ts`, `lib/offline-ble-*`.
