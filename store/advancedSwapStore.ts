import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import type { OffpayNetwork } from '@/types/offpay-api';

export type AdvancedSwapMode = 'trigger' | 'recurring' | 'privacy';
export type SwapReceiptMode = AdvancedSwapMode | 'normal';

export interface SwapReceiptTokenLeg {
  mint?: string | null;
  symbol?: string | null;
  name?: string | null;
  logo?: string | null;
  decimals?: number | null;
  rawAmount?: string | null;
  amountLabel?: string | null;
}

export interface AdvancedSwapReceipt {
  id: string;
  mode: SwapReceiptMode;
  title: string;
  subtitle: string;
  signature: string | null;
  network: OffpayNetwork;
  createdAt: number;
  walletAddress?: string | null;
  input?: SwapReceiptTokenLeg | null;
  output?: SwapReceiptTokenLeg | null;
}

export interface PersistedRecurringOperationIdentity {
  fingerprint: string;
  idempotencyKey: string;
  expiresAt: number;
}

interface AdvancedSwapState {
  receipts: AdvancedSwapReceipt[];
  recurringOperationIdentities: Record<string, PersistedRecurringOperationIdentity>;
  addReceipt: (receipt: AdvancedSwapReceipt) => void;
  clearReceipts: () => void;
}

const MAX_RECEIPTS = 10;
const MAX_RECURRING_OPERATION_IDENTITIES = 20;
const RECURRING_OPERATION_IDENTITY_TTL_MS = 24 * 60 * 60_000;

export const useAdvancedSwapStore = create<AdvancedSwapState>()(
  persist(
    (set) => ({
      receipts: [],
      recurringOperationIdentities: {},
      addReceipt: (receipt) =>
        set((state) => ({
          receipts: [receipt, ...state.receipts.filter((item) => item.id !== receipt.id)].slice(
            0,
            MAX_RECEIPTS,
          ),
        })),
      clearReceipts: () => set({ receipts: [] }),
    }),
    {
      name: 'offpay-swap-receipts',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

function liveRecurringOperationIdentities(
  identities: Record<string, PersistedRecurringOperationIdentity>,
  now: number,
): Record<string, PersistedRecurringOperationIdentity> {
  return Object.fromEntries(
    Object.entries(identities)
      .filter(([, identity]) => identity.expiresAt > now)
      .sort(([, left], [, right]) => right.expiresAt - left.expiresAt)
      .slice(0, MAX_RECURRING_OPERATION_IDENTITIES),
  );
}

export function getOrCreatePersistedRecurringOperationIdentity(params: {
  fingerprint: string;
  createKey: () => string;
  now?: number;
}): PersistedRecurringOperationIdentity {
  const now = params.now ?? Date.now();
  const state = useAdvancedSwapStore.getState();
  const live = liveRecurringOperationIdentities(state.recurringOperationIdentities ?? {}, now);
  const existing = live[params.fingerprint];
  if (existing != null) {
    if (Object.keys(live).length !== Object.keys(state.recurringOperationIdentities ?? {}).length) {
      useAdvancedSwapStore.setState({ recurringOperationIdentities: live });
    }
    return existing;
  }

  const created: PersistedRecurringOperationIdentity = {
    fingerprint: params.fingerprint,
    idempotencyKey: params.createKey(),
    expiresAt: now + RECURRING_OPERATION_IDENTITY_TTL_MS,
  };
  const next = liveRecurringOperationIdentities({ ...live, [params.fingerprint]: created }, now);
  useAdvancedSwapStore.setState({ recurringOperationIdentities: next });
  return created;
}

export function clearPersistedRecurringOperationIdentity(params: { idempotencyKey: string }): void {
  const state = useAdvancedSwapStore.getState();
  const current = state.recurringOperationIdentities ?? {};
  const next = Object.fromEntries(
    Object.entries(current).filter(
      ([, identity]) => identity.idempotencyKey !== params.idempotencyKey,
    ),
  );
  if (Object.keys(next).length === Object.keys(current).length) return;
  useAdvancedSwapStore.setState({ recurringOperationIdentities: next });
}

export const __advancedSwapStoreInternal = {
  MAX_RECURRING_OPERATION_IDENTITIES,
  RECURRING_OPERATION_IDENTITY_TTL_MS,
};
