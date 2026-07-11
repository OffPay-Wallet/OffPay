# Flash V2 mainnet transaction verification

Last verified: 2026-07-11

## Scope and evidence

The verifier is based on the deployed Flash V2 API transaction builders, the official V2 Anchor IDL, and unsigned V0 transaction inspection against the live mainnet execution RPC. No transaction was signed, broadcast, or deployed during verification.

Every wallet confirmation carries an economic intent that is independent of the API-built transaction. The confirmation path resolves any address lookup tables, decodes the returned instruction bytes, validates the complete account layout, and rejects a mismatch before signing.

## Direction binding

Long and short are not inferred from collateral or target custody because those accounts may be identical. Direction is bound as follows:

1. The app fetches the exact raw market account selected by the live market catalog.
2. The raw market's official `side` field must equal the user-requested side.
3. That side and market pubkey are stored in the confirmation intent.
4. The verifier requires the exact market pubkey in the signed Flash instruction account list, or in the cancel instruction data where the protocol encodes it.

An adversarial test uses long and short fixtures with identical pool, target custody, collateral custody, and settlement custody. Replacing only the side-specific market pubkey is rejected.

## Proven live instruction layouts

| Operation           | Instruction                                                  | Exact encoded intent                                                                                                                             |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| New market position | `open_position_er`                                           | execution-price limit, collateral raw amount, size raw amount, privilege enum                                                                    |
| Increase position   | `increase_position_size_er`                                  | execution-price limit, size delta, collateral delta, privilege enum                                                                              |
| Limit order         | `place_limit_order_er`                                       | limit price, reserve raw amount, size raw amount, stop-loss price, take-profit price; exact 60-byte layout with no trailing privilege or boolean |
| Full close          | `close_position_er`                                          | execution-price limit, explicit full-close semantics, privilege enum                                                                             |
| Partial close       | `decrease_position_size_er`                                  | execution-price limit, exact size delta, privilege enum                                                                                          |
| Add collateral      | `add_collateral_er`                                          | exact token raw amount                                                                                                                           |
| Remove collateral   | `remove_collateral_er`                                       | exact six-decimal USD raw amount                                                                                                                 |
| Place trigger       | `place_trigger_order_er`                                     | trigger price, exact size, stop-loss boolean                                                                                                     |
| Edit trigger        | `edit_trigger_order_er`                                      | slot, trigger price, exact size, stop-loss boolean                                                                                               |
| Cancel trigger      | `cancel_trigger_order_er`                                    | exact market pubkey, slot, stop-loss boolean                                                                                                     |
| Cancel all triggers | `cancel_all_trigger_orders_er`, or live slot-255 cancel form | exact market pubkey and cancel-all semantics                                                                                                     |
| Reverse position    | atomic close, optional cleanup, then open                    | source and destination sides/markets, both price limits, exact reopen collateral and size, both privilege enums, exact instruction order         |

Every account-bearing instruction also binds owner, signer, direct-session placeholder, perpetuals PDA, owner basket PDA, deposit-ledger PDA where applicable, pool, market, target custody, collateral custody, selected settlement custody, realloc-vault PDA where applicable, event-authority PDA, program account, and instructions sysvar where applicable.

The privilege byte is decoded as the complete official enum: `None = 0`, `Stake = 1`, and `Referral = 2`. The current direct builder flow only supports a confirmed `None` intent. `Stake`, `Referral`, invalid enum values, or a privilege field on the exact limit-order layout fail closed.

Leverage is not a separate field in any of the proven live instruction layouts. It is economically expressed by the encoded collateral and position-size values, so both are bound exactly; the final builder-reported leverage is shown to the user but is not falsely treated as an on-chain leverage argument.

The transaction may contain exactly one live compute-budget instruction: `SetComputeUnitLimit(1_400_000)`. Priority-fee instructions, altered limits, duplicate compute instructions, extra programs, extra protocol instructions, changed account counts, stale blockhashes, missing/invalid required signatures, and a signed message different from the reviewed message are rejected.

## Deliberately unsupported operations

- New Flash deposits or account funding from either app UI or the AI agent, while withdrawal remains unavailable.
- Flash account withdrawal until an authorized distinct co-signer lifecycle exists.
- Privileged `Stake` or `Referral` open/increase/close/reverse variants because the current direct builder and confirmation UX do not request those modes.
- Session-key/delegated variants whose session-token account differs from the proven direct-wallet layout.
- Trigger-order edits when the live builder silently changes the existing order's settlement custody.
- Any new or changed Flash instruction discriminator, account layout, enum variant, trailing field, or multi-instruction sequence until it is re-proven against the current official IDL and live unsigned builder output.
- Draft-time transactions whose economic accounts are hidden behind an unresolved address lookup table.

These cases return explicit unsupported or validation errors. They are not silently downgraded, guessed, or broadcast.
