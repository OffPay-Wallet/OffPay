export type InviteAccessGateMode = 'required' | 'disabled';

export function getInviteAccessGateMode(): InviteAccessGateMode {
  const mode = process.env.EXPO_PUBLIC_OFFPAY_INVITE_GATE_MODE?.trim().toLowerCase();
  if (mode === 'disabled' || mode === 'off') return 'disabled';
  return 'required';
}

export function isInviteAccessGateEnabled(): boolean {
  return getInviteAccessGateMode() === 'required';
}
