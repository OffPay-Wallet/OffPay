# Client Performance Checklist

This checklist keeps OffPay's client fast without weakening the wallet security model.

## Baseline Flows

Capture Hermes sampling profiles and `[perf]` logs for these flows before and after client-performance changes:

- Cold start to first visible route
- App unlock with passcode and biometrics
- Home tab wallet data hydration
- Tab switch into swap, history, holdings, and settings
- Token selector open, search, scroll, and select
- Normal send confirmation and submit
- Offline payment build, verify, and settle
- Umbra vault open, scan, setup, shield, and claim
- Payroll review open, edit row, token picker, and submit

## Work Classes

Use `lib/perf/work-offload-policy.ts` to classify new heavy work.

- `client:userBlocking`: visible tap feedback, current-screen render data, user-confirmed signing prompts.
- `client:afterFirstPaint`: cache hydration, non-visible tab hydration, capability probes, non-critical metadata.
- `client:idle`: token/logo warmups, stale price refresh, background display-cache reconciliation.
- `native:localCpu`: local hashes, HMACs, base58-heavy loops, local verification, parsing that cannot leave the device.
- `worker:publicOnly`: public RPC aggregation, fee/rent estimates, unsigned transaction build, simulation, token metadata, price/portfolio aggregates.

## Security Boundary

Never send these to a backend worker:

- Seed phrases
- Private keys or signing seeds
- Local signatures before user consent
- Passcode hashes or biometric challenge material
- Umbra private witnesses, spend keys, or private note contents
- Encrypted backup keys or plaintext backup payloads

Allowed worker payloads must be public, unsigned, or already wallet-scoped through the existing OffPay auth envelope.

## PR Gate

Every client-performance PR should answer:

- Which baseline flow got faster?
- Which work class changed?
- What data crosses a backend boundary?
- Why no secret-bearing data moved?
- Which route/query/cache scope is persisted, and where?
- What happens in offline mode?
- What is the rollback path if native acceleration is unavailable?
