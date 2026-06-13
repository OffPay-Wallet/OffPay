import type { AgentToolSchema } from '@/lib/agentic-payments/types';
import type {
  AgenticFlashPositionOperation,
  AgenticFlashTriggerOrderSummary,
} from '@/store/agenticChatStore';

export type FlashTradeToolName =
  | 'flash_get_markets'
  | 'flash_get_positions'
  | 'flash_get_prices'
  | 'flash_get_orders'
  | 'flash_open_position'
  | 'flash_close_position'
  | 'flash_add_collateral'
  | 'flash_remove_collateral'
  | 'flash_place_trigger_order'
  | 'flash_edit_trigger_order'
  | 'flash_cancel_trigger_order'
  | 'flash_cancel_all_trigger_orders'
  | 'flash_reverse_position'
  | 'flash_preview_limit_order'
  | 'flash_preview_tp_sl'
  | 'flash_preview_margin'
  | 'flash_preview_exit_fee';

export interface FlashTradeDraft {
  kind: 'flash_position';
  operation: AgenticFlashPositionOperation;
  actionLabel: string;
  walletAddress: string;
  network: 'mainnet';
  positionKey?: string | null;
  orderId?: string | null;
  marketSymbol: string;
  side: 'long' | 'short';
  leverage: number;
  collateralUsd: number;
  inputTokenSymbol: string;
  tradeType: 'market' | 'limit';
  limitPrice?: number;
  entryPrice: number;
  liquidationPrice: number;
  sizeUsd: number;
  entryFeeUsd: number;
  amountUsd?: number | null;
  amountTokenSymbol?: string | null;
  exitPrice?: number | null;
  feesUsd?: number | null;
  realizedPnlUsd?: number | null;
  newLeverage?: number | null;
  newLiquidationPrice?: number | null;
  transactionBase64: string;
  expiresAt: number;
  triggerOrders?: AgenticFlashTriggerOrderSummary[];
  requestedTriggerOrders?: AgenticFlashTriggerOrderSummary[];
  warnings?: string[];
}

export type { AgentToolSchema };
