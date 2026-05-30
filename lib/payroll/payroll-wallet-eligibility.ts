import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';
import type { WalletBalanceResponse } from '@/types/offpay-api';

/**
 * Whether the active wallet can locally sign payroll transactions. Privy
 * embedded/address-only wallets hold no signing material on-device, so they
 * are blocked before confirmation.
 */
export function walletCanSignPayroll(importMethod: WalletImportMethod | null | undefined): boolean {
  return (
    importMethod === 'generated' ||
    importMethod === 'mnemonic-import' ||
    importMethod === 'private-key-import'
  );
}

/**
 * Resolves the run token context (mint, symbol, decimals, atomic balance)
 * from the active wallet balance for a chosen stablecoin symbol. Returns null
 * when the wallet holds no matching token — payroll cannot proceed without a
 * funded, identifiable token.
 *
 * `token.balance` from the wallet balance is a UI-formatted decimal string
 * (see `dasAssetToBalanceToken`), so we convert it to atomic here.
 */
export function resolvePayrollTokenContext(
  balance: WalletBalanceResponse | null | undefined,
  symbol: string,
): PayrollTokenContext | null {
  if (balance == null) return null;
  const normalized = symbol.trim().toUpperCase();
  const match = balance.tokens.find(
    (token) => token.symbol?.toUpperCase() === normalized && !token.spam,
  );
  if (match == null || match.mint == null) return null;

  const decimals = typeof match.decimals === 'number' ? match.decimals : 6;
  return {
    mint: match.mint,
    symbol: match.symbol ?? normalized,
    decimals,
    balanceAtomic: decimalInputToAtomicAmount(match.balance ?? '0', decimals),
  };
}
