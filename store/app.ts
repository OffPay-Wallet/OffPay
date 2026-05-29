import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import { formatOffpayUsername } from '@/lib/api/offpay-username';

/**
 * App-level global state.
 * Persisted via expo-secure-store for instant hydration on app launch.
 *
 * Add application-wide state here (e.g., onboarding status, theme preference).
 */

interface AppState {
  /** Whether the user has completed onboarding */
  hasOnboarded: boolean;

  /** User's preferred color scheme override (null = system default) */
  colorScheme: 'light' | 'dark' | null;

  /** App-level display name used for nearby BLE wallet discovery; not scoped to the active wallet. */
  username: string | null;

  /** Actions */
  setHasOnboarded: (value: boolean) => void;
  setColorScheme: (scheme: 'light' | 'dark' | null) => void;
  setUsername: (username: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasOnboarded: false,
      colorScheme: null,
      username: null,

      setHasOnboarded: (value) => set({ hasOnboarded: value }),
      setColorScheme: (scheme) => set({ colorScheme: scheme }),
      setUsername: (username) => set({ username: formatOffpayUsername(username) }),
    }),
    {
      name: 'app-store',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
