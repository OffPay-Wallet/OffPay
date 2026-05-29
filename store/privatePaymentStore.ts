import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';

import type { OffpayNetwork } from '@/types/offpay-api';

type PrivatePaymentReceiptStatus = 'submitted' | 'queued';
type PrivatePaymentReceiptRoute = 'magicblock' | 'umbra' | 'normal';
type PrivatePaymentReceiptSource = 'manual' | 'agentic';

export interface PrivatePaymentReceipt {
  id: string;
  status: PrivatePaymentReceiptStatus;
  route?: PrivatePaymentReceiptRoute;
  source?: PrivatePaymentReceiptSource;
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenLogo?: string | null;
  tokenDecimals?: number | null;
  network: OffpayNetwork;
  createdAt: number;
  signature: string | null;
  txId: string | null;
  initSignature: string | null;
  message: string;
}

interface PrivatePaymentState {
  receipts: PrivatePaymentReceipt[];
  addReceipt: (receipt: PrivatePaymentReceipt) => void;
  clearReceipts: () => void;
}

const MAX_RECEIPTS = 10;

export const usePrivatePaymentStore = create<PrivatePaymentState>()(
  persist(
    (set) => ({
      receipts: [],
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
      name: 'offpay-private-payments',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
