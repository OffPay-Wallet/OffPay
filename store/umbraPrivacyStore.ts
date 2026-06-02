import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';

import type { OffpayNetwork } from '@/types/offpay-api';

export type UmbraPrivacyAction =
  | 'shield'
  | 'unshield'
  | 'register'
  | 'balance'
  | 'private-p2p'
  | 'claim'
  | 'repair';

export interface UmbraPrivacyReceipt {
  id: string;
  action: UmbraPrivacyAction;
  title: string;
  subtitle: string;
  signature?: string | null;
  network: OffpayNetwork;
  createdAt: number;
}

interface UmbraPrivacyState {
  receipts: UmbraPrivacyReceipt[];
  registeredVaultKeys: string[];
  registeredMixerKeys: string[];
  registeredMixerVerifiedAt: Record<string, number>;
  // Insertion indices of Umbra UTXOs we have already claimed locally,
  // bucketed by `${network}:${walletAddress}`. The Umbra indexer does not
  // surface a "claimed" flag — it returns every leaf in the Merkle tree.
  // After a successful client-side claim we record the indices here so the
  // Receive flow can stop showing them as "pending" while the on-chain
  // nullifier propagates through the indexer's downstream caches.
  claimedUtxoInsertionIndices: Record<string, number[]>;
  addReceipt: (receipt: UmbraPrivacyReceipt) => void;
  clearReceiptsForNetwork: (network: OffpayNetwork) => void;
  setVaultRegistered: (key: string, registered: boolean) => void;
  setMixerRegistered: (key: string, registered: boolean) => void;
  markUtxosClaimed: (params: {
    network: OffpayNetwork;
    walletAddress: string;
    insertionIndices: readonly (number | string | bigint)[];
  }) => void;
  clearClaimedUtxos: (params: { network: OffpayNetwork; walletAddress: string }) => void;
}

const CLAIMED_UTXO_KEY = (network: OffpayNetwork, walletAddress: string): string =>
  `${network}:${walletAddress}`;

const MAX_CLAIMED_UTXO_INDICES_PER_WALLET = 256;

function normalizeInsertionIndex(value: number | string | bigint): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export const useUmbraPrivacyStore = create<UmbraPrivacyState>()(
  persist(
    (set) => ({
      receipts: [],
      registeredVaultKeys: [],
      registeredMixerKeys: [],
      registeredMixerVerifiedAt: {},
      claimedUtxoInsertionIndices: {},
      addReceipt: (receipt) =>
        set((state) => ({
          receipts: [receipt, ...state.receipts.filter((item) => item.id !== receipt.id)].slice(
            0,
            20,
          ),
        })),
      clearReceiptsForNetwork: (network) =>
        set((state) => ({
          receipts: state.receipts.filter((receipt) => receipt.network !== network),
        })),
      setVaultRegistered: (key, registered) =>
        set((state) => ({
          registeredVaultKeys: registered
            ? [key, ...state.registeredVaultKeys.filter((item) => item !== key)].slice(0, 20)
            : state.registeredVaultKeys.filter((item) => item !== key),
        })),
      setMixerRegistered: (key, registered) =>
        set((state) => {
          const currentVerifiedAt = state.registeredMixerVerifiedAt ?? {};
          const nextKeys = registered
            ? [key, ...state.registeredMixerKeys.filter((item) => item !== key)].slice(0, 20)
            : state.registeredMixerKeys.filter((item) => item !== key);
          const nextVerifiedAt = nextKeys.reduce<Record<string, number>>((acc, item) => {
            const previousVerifiedAt = currentVerifiedAt[item];
            acc[item] =
              item === key && registered ? Date.now() : (previousVerifiedAt ?? Date.now());
            return acc;
          }, {});
          return {
            registeredMixerKeys: nextKeys,
            registeredMixerVerifiedAt: nextVerifiedAt,
          };
        }),
      markUtxosClaimed: ({ network, walletAddress, insertionIndices }) =>
        set((state) => {
          const indices = insertionIndices
            .map(normalizeInsertionIndex)
            .filter((value): value is number => value != null);
          if (indices.length === 0) return state;

          const key = CLAIMED_UTXO_KEY(network, walletAddress);
          const existing = state.claimedUtxoInsertionIndices[key] ?? [];
          const merged = Array.from(new Set([...indices, ...existing]))
            .sort((a, b) => b - a)
            .slice(0, MAX_CLAIMED_UTXO_INDICES_PER_WALLET);
          if (
            merged.length === existing.length &&
            merged.every((value, index) => existing[index] === value)
          ) {
            return state;
          }
          return {
            claimedUtxoInsertionIndices: {
              ...state.claimedUtxoInsertionIndices,
              [key]: merged,
            },
          };
        }),
      clearClaimedUtxos: ({ network, walletAddress }) =>
        set((state) => {
          const key = CLAIMED_UTXO_KEY(network, walletAddress);
          if (state.claimedUtxoInsertionIndices[key] == null) return state;
          const next = { ...state.claimedUtxoInsertionIndices };
          delete next[key];
          return { claimedUtxoInsertionIndices: next };
        }),
    }),
    {
      name: 'offpay-umbra-privacy',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

export function getClaimedUmbraUtxoIndexSet(
  state: Pick<UmbraPrivacyState, 'claimedUtxoInsertionIndices'>,
  network: OffpayNetwork,
  walletAddress: string | null | undefined,
): ReadonlySet<number> {
  if (walletAddress == null) return new Set();
  const indices = state.claimedUtxoInsertionIndices[CLAIMED_UTXO_KEY(network, walletAddress)];
  return new Set(indices ?? []);
}
