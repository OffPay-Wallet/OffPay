export const WALLET_FLOW_INVITE_PURPOSE = 'add-wallet';
export const WALLET_FLOW_INVITE_TTL_MS = 10 * 60 * 1000;

export type WalletFlowInviteNext =
  | 'create-wallet'
  | 'restore-wallet'
  | 'privy-wallet'
  | 'onboarding';
export type WalletFlowInviteSource = 'accounts' | 'onboarding';

export function firstRouteParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeWalletFlowInviteNext(
  value: string | string[] | undefined,
): WalletFlowInviteNext {
  const normalized = firstRouteParam(value);
  if (
    normalized === 'restore-wallet' ||
    normalized === 'privy-wallet' ||
    normalized === 'onboarding'
  ) {
    return normalized;
  }
  return 'create-wallet';
}

export function normalizeWalletFlowInviteSource(
  value: string | string[] | undefined,
): WalletFlowInviteSource {
  return firstRouteParam(value) === 'onboarding' ? 'onboarding' : 'accounts';
}

export function getWalletFlowInvitePathname(
  next: WalletFlowInviteNext,
): '/create-wallet' | '/restore-wallet' | '/privy-wallet' | '/onboarding' {
  switch (next) {
    case 'restore-wallet':
      return '/restore-wallet';
    case 'privy-wallet':
      return '/privy-wallet';
    case 'onboarding':
      return '/onboarding';
    default:
      return '/create-wallet';
  }
}

export function isWalletFlowInviteFresh(
  verifiedAt: number | null | undefined,
  now = Date.now(),
): boolean {
  return (
    typeof verifiedAt === 'number' &&
    now - verifiedAt >= 0 &&
    now - verifiedAt <= WALLET_FLOW_INVITE_TTL_MS
  );
}
