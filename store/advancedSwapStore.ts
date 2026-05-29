import { create } from 'zustand';

import type { OffpayNetwork } from '@/types/offpay-api';

export type AdvancedSwapMode = 'trigger' | 'recurring' | 'privacy';

export interface AdvancedSwapReceipt {
  id: string;
  mode: AdvancedSwapMode;
  title: string;
  subtitle: string;
  signature: string | null;
  network: OffpayNetwork;
  createdAt: number;
}

interface AdvancedSwapState {
  receipts: AdvancedSwapReceipt[];
  addReceipt: (receipt: AdvancedSwapReceipt) => void;
  clearReceipts: () => void;
}

const MAX_RECEIPTS = 10;

export const useAdvancedSwapStore = create<AdvancedSwapState>()((set) => ({
  receipts: [],
  addReceipt: (receipt) =>
    set((state) => ({
      receipts: [receipt, ...state.receipts.filter((item) => item.id !== receipt.id)].slice(
        0,
        MAX_RECEIPTS,
      ),
    })),
  clearReceipts: () => set({ receipts: [] }),
}));
