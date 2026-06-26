import {
  getWalletFlowInvitePathname,
  isWalletFlowInviteFresh,
  normalizeWalletFlowInviteNext,
  normalizeWalletFlowInviteSource,
  WALLET_FLOW_INVITE_TTL_MS,
} from '@/lib/invite/wallet-flow-invite';

describe('wallet flow invite gate helpers', () => {
  it('accepts only recent wallet-flow invite verifications', () => {
    const now = 1_000_000;

    expect(isWalletFlowInviteFresh(now, now)).toBe(true);
    expect(isWalletFlowInviteFresh(now - WALLET_FLOW_INVITE_TTL_MS, now)).toBe(true);
    expect(isWalletFlowInviteFresh(now - WALLET_FLOW_INVITE_TTL_MS - 1, now)).toBe(false);
    expect(isWalletFlowInviteFresh(now + 1, now)).toBe(false);
    expect(isWalletFlowInviteFresh(null, now)).toBe(false);
  });

  it('normalizes wallet-flow invite route params', () => {
    expect(normalizeWalletFlowInviteNext('restore-wallet')).toBe('restore-wallet');
    expect(normalizeWalletFlowInviteNext('privy-wallet')).toBe('privy-wallet');
    expect(normalizeWalletFlowInviteNext('unknown')).toBe('create-wallet');
    expect(normalizeWalletFlowInviteSource('onboarding')).toBe('onboarding');
    expect(normalizeWalletFlowInviteSource('accounts')).toBe('accounts');
    expect(normalizeWalletFlowInviteSource(undefined)).toBe('accounts');
    expect(getWalletFlowInvitePathname('restore-wallet')).toBe('/restore-wallet');
  });
});
