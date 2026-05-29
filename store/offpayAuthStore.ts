import { create } from 'zustand';

export type OffpayAuthStatus =
  | 'idle'
  | 'checking'
  | 'provisioning'
  | 'ready'
  | 'blocked'
  | 'error';

interface OffpayAuthState {
  status: OffpayAuthStatus;
  bootstrapVersion: number | null;
  lastProvisionedAt: number | null;
  error: string | null;
  setChecking: () => void;
  setProvisioning: () => void;
  setReady: (params: { bootstrapVersion: number; provisionedAt: number | null }) => void;
  setBlocked: (message: string) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useOffpayAuthStore = create<OffpayAuthState>()((set) => ({
  status: 'idle',
  bootstrapVersion: null,
  lastProvisionedAt: null,
  error: null,

  setChecking: () => set({ status: 'checking', error: null }),
  setProvisioning: () => set({ status: 'provisioning', error: null }),
  setReady: ({ bootstrapVersion, provisionedAt }) =>
    set({
      status: 'ready',
      bootstrapVersion,
      lastProvisionedAt: provisionedAt,
      error: null,
    }),
  setBlocked: (message) =>
    set({
      status: 'blocked',
      error: message,
    }),
  setError: (message) =>
    set({
      status: 'error',
      error: message,
    }),
  reset: () =>
    set({
      status: 'idle',
      bootstrapVersion: null,
      lastProvisionedAt: null,
      error: null,
    }),
}));

