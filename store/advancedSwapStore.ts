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

interface AdvancedSwapState {
  receipts: AdvancedSwapReceipt[];
  addReceipt: (receipt: AdvancedSwapReceipt) => void;
  clearReceipts: () => void;
}

const MAX_RECEIPTS = 10;

export const useAdvancedSwapStore = create<AdvancedSwapState>()(
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
      name: 'offpay-swap-receipts',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
