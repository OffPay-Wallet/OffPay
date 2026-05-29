import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';

import type { ParsedOfflineQrPayload } from '@/lib/offline/offline-payments';
import type { OffpayNetwork } from '@/types/offpay-api';

export interface OfflinePaymentReceipt {
  id: string;
  direction?: 'send' | 'receive';
  status?: 'queued' | 'received' | 'settling' | 'settled' | 'failed';
  title: string;
  subtitle: string;
  amountLabel?: string | null;
  rawAmount?: string | null;
  tokenMint?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenLogo?: string | null;
  tokenDecimals?: number | null;
  network: OffpayNetwork;
  createdAt: number;
  updatedAt?: number;
  txId?: string | null;
  signature?: string | null;
  sender?: string | null;
  recipient?: string | null;
  routeLabel?: string | null;
  privacyLabel?: string | null;
  programLabel?: string | null;
  errorMessage?: string | null;
}

interface OfflinePaymentState {
  lastParsedPayload: ParsedOfflineQrPayload | null;
  receipts: OfflinePaymentReceipt[];
  recipientHistoryClearedAtByWallet: Record<string, number>;
  setLastParsedPayload: (payload: ParsedOfflineQrPayload | null) => void;
  addReceipt: (receipt: OfflinePaymentReceipt) => void;
  clearRecipientHistory: (walletAddress: string) => void;
  updateReceipt: (
    idOrTxId: string,
    patch: Partial<Omit<OfflinePaymentReceipt, 'id' | 'createdAt' | 'network'>>,
  ) => void;
  updateReceipts: (
    idOrTxId: string,
    updater: (
      receipt: OfflinePaymentReceipt,
    ) => Partial<Omit<OfflinePaymentReceipt, 'id' | 'createdAt' | 'network'>>,
  ) => void;
}

function normalizeReceipt(receipt: OfflinePaymentReceipt): OfflinePaymentReceipt {
  return {
    ...receipt,
    direction: receipt.direction ?? 'receive',
    status: receipt.status ?? 'received',
    updatedAt: receipt.updatedAt ?? receipt.createdAt,
    txId: receipt.txId ?? null,
    signature: receipt.signature ?? null,
    rawAmount: receipt.rawAmount ?? null,
    tokenMint: receipt.tokenMint ?? null,
    tokenName: receipt.tokenName ?? receipt.tokenSymbol ?? null,
    tokenLogo: receipt.tokenLogo ?? null,
    tokenDecimals:
      typeof receipt.tokenDecimals === 'number' && Number.isFinite(receipt.tokenDecimals)
        ? receipt.tokenDecimals
        : null,
    sender: receipt.sender ?? null,
    recipient: receipt.recipient ?? null,
    routeLabel: receipt.routeLabel ?? null,
    privacyLabel: receipt.privacyLabel ?? null,
    programLabel: receipt.programLabel ?? null,
    errorMessage: receipt.errorMessage ?? null,
  };
}

export const useOfflinePaymentStore = create<OfflinePaymentState>()(
  persist(
    (set) => ({
      lastParsedPayload: null,
      receipts: [],
      recipientHistoryClearedAtByWallet: {},
      setLastParsedPayload: (payload) => set({ lastParsedPayload: payload }),
      addReceipt: (receipt) =>
        set((state) => ({
          receipts: [
            normalizeReceipt(receipt),
            ...state.receipts.filter((item) => item.id !== receipt.id),
          ].slice(0, 40),
        })),
      clearRecipientHistory: (walletAddress) =>
        set((state) => ({
          recipientHistoryClearedAtByWallet: {
            ...state.recipientHistoryClearedAtByWallet,
            [walletAddress]: Date.now(),
          },
        })),
      updateReceipt: (idOrTxId, patch) =>
        set((state) => ({
          receipts: state.receipts.map((receipt) => {
            if (receipt.id !== idOrTxId && receipt.txId !== idOrTxId) return receipt;

            return normalizeReceipt({
              ...receipt,
              ...patch,
              updatedAt: patch.updatedAt ?? Date.now(),
            });
          }),
        })),
      updateReceipts: (idOrTxId, updater) =>
        set((state) => ({
          receipts: state.receipts.map((receipt) => {
            if (receipt.id !== idOrTxId && receipt.txId !== idOrTxId) return receipt;

            return normalizeReceipt({
              ...receipt,
              ...updater(receipt),
              updatedAt: Date.now(),
            });
          }),
        })),
    }),
    {
      name: 'offpay-offline-payments',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        receipts: state.receipts,
        recipientHistoryClearedAtByWallet: state.recipientHistoryClearedAtByWallet,
      }),
      version: 2,
      migrate: (persisted) => {
        if (typeof persisted !== 'object' || persisted == null) return persisted;
        const state = persisted as Partial<OfflinePaymentState>;
        return {
          ...state,
          recipientHistoryClearedAtByWallet:
            typeof state.recipientHistoryClearedAtByWallet === 'object' &&
            state.recipientHistoryClearedAtByWallet != null
              ? state.recipientHistoryClearedAtByWallet
              : {},
          receipts: Array.isArray(state.receipts)
            ? state.receipts.map((receipt) => normalizeReceipt(receipt))
            : [],
        };
      },
    },
  ),
);
