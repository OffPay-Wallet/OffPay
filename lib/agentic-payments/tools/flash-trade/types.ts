import type { AgentToolSchema } from '@/lib/agentic-payments/types';
import type { FlashTradeEconomicIntent } from '@/lib/flash-trade/types';
import type {
  AgenticFlashDepositAction,
  AgenticFlashPositionOperation,
  AgenticFlashTriggerOrderSummary,
} from '@/store/agenticChatStore';

export type FlashTradeToolName =
  | 'flash_get_markets'
  | 'flash_get_positions'
  | 'flash_get_prices'
  | 'flash_get_orders'
  | 'flash_fund_account'
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
  | 'flash_preview_exit_fee'
  | 'flash_get_pool_stats'
  | 'flash_get_funding_rates'
  | 'flash_get_open_interest'
  | 'flash_get_liquidation_clusters'
  | 'flash_get_market_metrics'
  | 'flash_get_portfolio_risk'
  | 'flash_get_absorption_analysis'
  | 'flash_get_optimal_entry'
  | 'flash_get_position_sizing'
  | 'flash_get_hedge_suggestions'
  | 'flash_get_data_pools'
  | 'flash_validate_data_access'
  | 'flash_get_rate_limits';

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
  /** V2 builders do not publish an expiry timestamp; the ER blockhash is checked at confirmation. */
  expiresAt: number | null;
  economicIntent: FlashTradeEconomicIntent;
  expectedMarketPubkeys: string[];
  expectedTriggerOrderCount?: number;
  expectedOrderSlot?: number;
  expectedIsStopLoss?: boolean;
  expectedLimitPrice?: number;
  expectedTriggerOrders?: { triggerPrice: number; isStopLoss: boolean }[];
  triggerOrders?: AgenticFlashTriggerOrderSummary[];
  requestedTriggerOrders?: AgenticFlashTriggerOrderSummary[];
  warnings?: string[];
}

export type FlashFundingDraft = Omit<
  AgenticFlashDepositAction,
  'id' | 'kind' | 'status' | 'createdAt' | 'updatedAt'
>;

export type { AgentToolSchema };
