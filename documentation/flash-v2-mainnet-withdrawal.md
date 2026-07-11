# Flash V2 mainnet withdrawal status

Last verified: 2026-07-11

## Decision

OffPay must keep Flash V2 withdrawal disabled until a real, authorized second-signer design exists. New Flash deposits/funding are also disabled so OffPay cannot create a lifecycle entry that may trap user funds. Existing-position read, risk-management, close, trigger-order, and recovery actions may remain available after their transactions pass the economic-intent verifier.

No fallback fee payer, server key, mock signer, or user-fund custody is permitted.

## Live API contract

The currently deployed API differs from the older V2 examples.

### Step 1: request settlement

`POST https://flashapi.trade/transaction-builder/request-withdrawal`

```json
{
  "owner": "<owner public key>",
  "feePayer": "<distinct signer public key>",
  "tokenMint": "<token mint>",
  "amount": "<positive UI amount>"
}
```

Observed safeguards and transaction shape:

- The API returns HTTP 400 when `owner === feePayer`: `feePayer must differ from owner (the delegation program rejects owner == feePayer)`.
- The returned V0 transaction requires two signatures: owner and the distinct `feePayer` account.
- The API does not pre-sign known Flash validator or delegation-program public keys.
- The value-moving instruction is Flash `withdrawal_with_action`, discriminator `00faf33a443304a6`.
- Instruction account 0 is owner, account 1 is the distinct co-signer, account 3 is the token mint, and the `u64` raw amount starts at data offset 8.

### Step 2: settle to the owner wallet

The current live route is:

`POST https://flashapi.trade/transaction-builder/withdrawal-settle`

```json
{
  "owner": "<owner public key>",
  "tokenMint": "<token mint>"
}
```

The older `/transaction-builder/execute-withdrawal` route currently returns HTTP 404.

The returned V0 settlement transaction requires only the owner signature. Its Flash instruction is `withdrawal_settle`, discriminator `e74a4368e0789d99`.

The settlement receipt is asynchronous. Official V2 examples describe a roughly 30-90 second crossing window and recommend polling unsigned simulations before presenting the second wallet approval. That complete live sequence was not executed because OffPay lacks the mandatory first-step co-signer.

## Why OffPay cannot enable this today

OffPay has no authorized withdrawal co-signer service and no product flow for explicit signing by a second user-owned wallet. Creating a secret key or silently choosing another account would expand custody and authorization beyond the user's request.

The first transaction cannot be safely broadcast with only the active wallet signature. The second step must not be offered before a confirmed first step and a ready settlement receipt.

## Requirements before enabling

One of these designs must be reviewed and implemented:

1. An audited, non-custodial policy co-signer service whose only authority is signing a fully verified Flash withdrawal request.
2. An explicit two-wallet user flow where the user selects and confirms a distinct locally controlled account.

Either design must enforce all of the following:

- exact owner, distinct co-signer, token mint, owner token account, amount, Flash program, instruction discriminator, and account-order verification;
- no unexpected programs or instructions;
- amount bounded by a fresh, coherent Flash ledger/basket balance;
- preservation and cryptographic verification of every existing signature;
- fresh mainnet blockhash without replacement after any partial signature;
- simulation and `skipPreflight: false` submission;
- confirmed/finalized status before advancing to settlement;
- idempotency, replay protection, request expiry, rate limits, and an auditable authorization record;
- unsigned settlement simulation polling, followed by a separate owner confirmation;
- a recovery action that can rebuild and execute only the settlement step.

Until those requirements are met:

- `perps.withdrawal` and `perps.funding` remain unavailable;
- no withdrawal or `flash_fund_account` write tool is registered or exposed to the AI model;
- stale funding actions are rendered disabled and the confirmation path fails before wallet signing;
- the direct Flash deposit client remains an unexposed protocol adapter, not an app or AI entry point.

Opening a position or adding collateral remains available only against an already-funded delegated Flash basket/ledger. The proven ER position instructions do not contain a base-chain token deposit. `add_collateral_er` reallocates existing Flash ledger collateral; it is not a replacement funding route.
