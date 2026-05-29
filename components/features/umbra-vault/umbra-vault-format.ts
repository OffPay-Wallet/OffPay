import type { UmbraVaultBalance, UmbraVaultToken } from './types';

export type UmbraVaultBalanceLoadState = 'idle' | 'loading' | 'ready' | 'error';

interface UmbraVaultBalanceLabelOptions {
  loadState?: UmbraVaultBalanceLoadState;
}

const STABLECOIN_VAULT_TOKENS: ReadonlySet<UmbraVaultToken> = new Set([
  'USDC',
  'USDT',
  'dUSDC',
  'dUSDT',
]);

export function getVaultBalanceForToken(
  balances: UmbraVaultBalance[],
  token: UmbraVaultToken,
): UmbraVaultBalance | null {
  return balances.find((balance) => balance.symbol === token) ?? null;
}

export function getVaultTokenAmountLabel(
  balances: UmbraVaultBalance[],
  token: UmbraVaultToken,
): string {
  const balance = getVaultBalanceForToken(balances, token);
  return balance?.displayBalance != null ? balance.displayBalance : '0';
}

export function canReadVaultBalance(balance: UmbraVaultBalance | null | undefined): boolean {
  return balance?.state === 'shared' && balance.rawBalance != null;
}

export function getVaultTokenRowLabel(
  balances: UmbraVaultBalance[],
  token: UmbraVaultToken,
  options?: UmbraVaultBalanceLabelOptions,
): string {
  const balance = getVaultBalanceForToken(balances, token);
  if (balance == null) {
    if (options?.loadState === 'loading') return 'Checking...';
    if (options?.loadState === 'error') return 'Refresh failed';
    if (options?.loadState === 'ready') return 'Unavailable';
    return `0 ${token}`;
  }

  if (balance?.displayBalance != null) return `${balance.displayBalance} ${token}`;
  // 'mxe' is the SDK state for an encrypted balance still being
  // decrypted by the network. Surfacing it as "Network encrypted"
  // confused users into thinking their balance was inaccessible.
  if (balance?.state === 'mxe') return 'Decrypting…';
  if (balance?.state === 'uninitialized' || balance?.state === 'non_existent') {
    return `0 ${token}`;
  }

  return 'Unavailable';
}

export function getShieldedStablecoinValueLabel(
  balances: UmbraVaultBalance[],
  tokens: UmbraVaultToken[],
  options?: UmbraVaultBalanceLabelOptions,
): string {
  if (balances.length === 0) {
    if (options?.loadState === 'loading') return 'Checking';
    if (options?.loadState === 'error') return '--';
  }

  let hasUnreadableStablecoin = false;
  const total = tokens.reduce((sum, token) => {
    if (!STABLECOIN_VAULT_TOKENS.has(token)) return sum;
    const balance = getVaultBalanceForToken(balances, token);
    if (balance == null) {
      hasUnreadableStablecoin = true;
      return sum;
    }
    if (
      balance.displayBalance == null &&
      balance.state !== 'uninitialized' &&
      balance.state !== 'non_existent'
    ) {
      hasUnreadableStablecoin = true;
      return sum;
    }
    const parsed = Number(balance.displayBalance ?? '0');
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);

  if (hasUnreadableStablecoin) return '--';
  if (total === 0) return '$0.00';
  if (total < 0.01) return '< $0.01';
  // Defensive cap. Real stablecoin holdings will never approach this
  // bound; anything larger is the SDK's pre-decryption placeholder
  // leaking through despite the upstream guard. Clamp to a `>` label
  // so the value strip never overflows its row.
  if (total >= 1_000_000_000_000) return '> $1T';

  return `$${total.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}
