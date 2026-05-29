/**
 * Domain types for the swap flow.
 *
 * `SwapTokenOption` was previously defined under
 * `components/features/swap/types.ts`. That kept the type co-located
 * with its UI consumers, but `lib/swap-helpers.ts` (a layer below
 * components) needs the same shape, and `lib` importing from
 * `components` is a layering smell — `lib` is meant to be UI-free.
 *
 * Moving the type here keeps both UI and lib consumers depending on
 * a neutral `types/` module, and matches how the rest of the repo
 * handles cross-cutting domain types (see `types/offpay-api.ts`,
 * `types/wallet.ts`).
 */

export interface SwapTokenOption {
  symbol: string;
  name: string;
  mint: string | null;
  decimals: number | null;
  logo: string | null;
  balanceValue: string;
  balanceDisplay: string;
  verified: boolean;
}
