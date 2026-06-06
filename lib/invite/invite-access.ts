import * as SecureStore from 'expo-secure-store';

import { parseInviteCode } from '@/shared/invite-codes';

const INVITE_ACCESS_KEY = 'offpay_invite_code';
const INVITE_EMAIL_KEY = 'offpay_invite_email';

const INVITE_ACCESS_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function storeInviteCode(input: string): Promise<string> {
  const parsed = parseInviteCode(input);
  if (!parsed.valid) {
    throw new Error('Invite code is invalid.');
  }

  await SecureStore.setItemAsync(
    INVITE_ACCESS_KEY,
    parsed.normalizedCode,
    INVITE_ACCESS_OPTIONS,
  );
  return parsed.normalizedCode;
}

export async function getStoredInviteCode(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(INVITE_ACCESS_KEY, INVITE_ACCESS_OPTIONS);
  if (stored == null || stored.trim().length === 0) return null;

  const parsed = parseInviteCode(stored);
  return parsed.valid ? parsed.normalizedCode : null;
}

export async function clearStoredInviteCode(): Promise<void> {
  await SecureStore.deleteItemAsync(INVITE_ACCESS_KEY, INVITE_ACCESS_OPTIONS);
}

export async function storeInviteEmail(email: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new Error('Email is required.');
  }

  await SecureStore.setItemAsync(INVITE_EMAIL_KEY, trimmed, INVITE_ACCESS_OPTIONS);
}

export async function getStoredInviteEmail(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(INVITE_EMAIL_KEY, INVITE_ACCESS_OPTIONS);
  if (stored == null || stored.trim().length === 0) return null;

  return stored.trim().toLowerCase();
}

export async function clearStoredInviteEmail(): Promise<void> {
  await SecureStore.deleteItemAsync(INVITE_EMAIL_KEY, INVITE_ACCESS_OPTIONS);
}
