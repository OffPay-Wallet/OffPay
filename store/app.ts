import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import { formatOffpayUsername } from '@/lib/api/offpay-username';

import type { WalletFlowInviteSource } from '@/lib/invite/wallet-flow-invite';

/**
 * App-level global state.
 * Persisted via expo-secure-store for instant hydration on app launch.
 *
 * Add application-wide state here (e.g., onboarding status, theme preference).
 */

interface AppState {
  /** Whether the user has completed onboarding */
  hasOnboarded: boolean;

  /** Whether this install has passed invite-code verification before onboarding */
  inviteAccessVerified: boolean;

  /** Email address submitted during invite-code verification */
  inviteEmail: string | null;

  /** Recent invite-code verification timestamp for post-onboarding wallet add/import flows */
  walletFlowInviteVerifiedAt: number | null;

  /** Source of the in-progress post-onboarding wallet add/import flow */
  walletFlowInviteSource: WalletFlowInviteSource | null;

  /** User's preferred color scheme override (null = system default) */
  colorScheme: 'light' | 'dark' | null;

  /** App-level display name used for nearby BLE wallet discovery; not scoped to the active wallet. */
  username: string | null;

  /** Device-local profile image URI copied into app storage. */
  profileImageUri: string | null;

  /** Actions */
  setHasOnboarded: (value: boolean) => void;
  setInviteAccessVerified: (value: boolean) => void;
  setInviteEmail: (email: string | null) => void;
  setWalletFlowInviteVerifiedAt: (timestamp: number | null) => void;
  setWalletFlowInviteSource: (source: WalletFlowInviteSource | null) => void;
  clearWalletFlowInviteVerification: () => void;
  setColorScheme: (scheme: 'light' | 'dark' | null) => void;
  setUsername: (username: string | null) => void;
  setProfileImageUri: (uri: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasOnboarded: false,
      inviteAccessVerified: false,
      inviteEmail: null,
      walletFlowInviteVerifiedAt: null,
      walletFlowInviteSource: null,
      colorScheme: null,
      username: null,
      profileImageUri: null,

      setHasOnboarded: (value) => set({ hasOnboarded: value }),
      setInviteAccessVerified: (value) => set({ inviteAccessVerified: value }),
      setInviteEmail: (email) => set({ inviteEmail: email ? email.trim().toLowerCase() : null }),
      setWalletFlowInviteVerifiedAt: (timestamp) => set({ walletFlowInviteVerifiedAt: timestamp }),
      setWalletFlowInviteSource: (source) => set({ walletFlowInviteSource: source }),
      clearWalletFlowInviteVerification: () =>
        set({ walletFlowInviteVerifiedAt: null, walletFlowInviteSource: null }),
      setColorScheme: (scheme) => set({ colorScheme: scheme }),
      setUsername: (username) => set({ username: formatOffpayUsername(username) }),
      setProfileImageUri: (uri) => set({ profileImageUri: uri }),
    }),
    {
      name: 'app-store',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
