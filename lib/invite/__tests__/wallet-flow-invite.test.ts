import {
  getWalletFlowInvitePathname,
  isWalletFlowInviteFresh,
  normalizeWalletFlowInviteNext,
  normalizeWalletFlowInviteSource,
  WALLET_FLOW_INVITE_TTL_MS,
} from '@/lib/invite/wallet-flow-invite';

const ORIGINAL_INVITE_GATE_MODE = process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE;

function setInviteGateMode(value: string | undefined): void {
  if (value == null) {
    delete process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE;
    return;
  }

  process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE = value;
}

describe('wallet flow invite gate helpers', () => {
  beforeEach(() => {
    setInviteGateMode(undefined);
  });

  afterAll(() => {
    setInviteGateMode(ORIGINAL_INVITE_GATE_MODE);
  });

  it('accepts only recent wallet-flow invite verifications', () => {
    const now = 1_000_000;

    expect(isWalletFlowInviteFresh(now, now)).toBe(true);
    expect(isWalletFlowInviteFresh(now - WALLET_FLOW_INVITE_TTL_MS, now)).toBe(true);
    expect(isWalletFlowInviteFresh(now - WALLET_FLOW_INVITE_TTL_MS - 1, now)).toBe(false);
    expect(isWalletFlowInviteFresh(now + 1, now)).toBe(false);
    expect(isWalletFlowInviteFresh(null, now)).toBe(false);
  });

  it('treats wallet-flow invite checks as satisfied when the invite gate is disabled', () => {
    setInviteGateMode('disabled');

    expect(isWalletFlowInviteFresh(null, 1_000_000)).toBe(true);
  });

  it('normalizes wallet-flow invite route params', () => {
    expect(normalizeWalletFlowInviteNext('restore-wallet')).toBe('restore-wallet');
    expect(normalizeWalletFlowInviteNext('privy-wallet')).toBe('privy-wallet');
    expect(normalizeWalletFlowInviteNext('onboarding')).toBe('onboarding');
    expect(normalizeWalletFlowInviteNext('unknown')).toBe('create-wallet');
    expect(normalizeWalletFlowInviteSource('onboarding')).toBe('onboarding');
    expect(normalizeWalletFlowInviteSource('accounts')).toBe('accounts');
    expect(normalizeWalletFlowInviteSource(undefined)).toBe('accounts');
    expect(getWalletFlowInvitePathname('restore-wallet')).toBe('/restore-wallet');
    expect(getWalletFlowInvitePathname('onboarding')).toBe('/onboarding');
  });
});
