import { getInviteAccessGateMode, isInviteAccessGateEnabled } from '@/lib/invite/invite-gate';

const ORIGINAL_INVITE_GATE_MODE = process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE;

function setInviteGateMode(value: string | undefined): void {
  if (value == null) {
    delete process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE;
    return;
  }

  process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE = value;
}

describe('invite access gate config', () => {
  beforeEach(() => {
    setInviteGateMode(undefined);
  });

  afterAll(() => {
    setInviteGateMode(ORIGINAL_INVITE_GATE_MODE);
  });

  it('requires invite access by default', () => {
    expect(getInviteAccessGateMode()).toBe('required');
    expect(isInviteAccessGateEnabled()).toBe(true);
  });

  it.each(['disabled', 'off', ' DISABLED '])('disables invite access for %s', (mode) => {
    setInviteGateMode(mode);

    expect(getInviteAccessGateMode()).toBe('disabled');
    expect(isInviteAccessGateEnabled()).toBe(false);
  });

  it.each(['required', 'enabled', 'unexpected'])('keeps invite access required for %s', (mode) => {
    setInviteGateMode(mode);

    expect(getInviteAccessGateMode()).toBe('required');
    expect(isInviteAccessGateEnabled()).toBe(true);
  });
});
