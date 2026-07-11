import type { AgenticToolDefinition } from '../types';
import { FLASH_MAX_TRIGGER_ORDERS_PER_POSITION, getFlashTradeClient } from '@/lib/flash-trade';
import {
  custodyPubkeyForSymbol,
  encodedAmountFromUi,
  errorCodeFromUnknown,
  expectedMarketAccounts,
  isPositiveFinite,
  positionRef,
  requireMainnet,
  requireDecodedInstruction,
  requireWallet,
  resolvePositionReference,
  sortedPositions,
  validateTradablePrice,
  validateTriggerPrice,
} from './helpers';
import type { FlashTradeDraft } from './types';

export const flashPlaceTriggerOrderTool: AgenticToolDefinition = {
  name: 'flash_place_trigger_order',
  schema: {
    name: 'flash_place_trigger_order',
    description:
      'Build a real Flash Trade V2 mainnet TP or SL transaction for an opaque position reference. Trigger direction is checked against the live Pyth Lazer mark.',
    parameters: {
      type: 'object',
      properties: {
        positionRef: {
          type: 'string',
          description: 'Opaque position_ref_N returned by flash_get_positions',
        },
        orderType: {
          type: 'string',
          enum: ['take_profit', 'stop_loss'],
          description: 'Trigger type',
        },
        triggerPrice: { type: 'number', description: 'Trigger price' },
        sizeUsd: {
          type: 'number',
          description: 'USD notional to close. Omit for the full position.',
        },
        sizePercent: {
          type: 'number',
          description: 'Percent of position to close, greater than 0 through 100. Omit for 100%.',
        },
      },
      required: ['positionRef', 'orderType', 'triggerPrice'],
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) return { error: { code: networkCheck.code } };
    const walletCheck = requireWallet(context.scope.walletAddress);
    if (!walletCheck.ok) return { error: { code: walletCheck.code } };
    if (!context.canUseNetwork) return { error: { code: 'network_unavailable' } };
    const args = call.args as {
      positionRef: string;
      orderType: 'take_profit' | 'stop_loss';
      triggerPrice: number;
      sizeUsd?: number;
      sizePercent?: number;
    };
    if (args.orderType !== 'take_profit' && args.orderType !== 'stop_loss') {
      return { error: { code: 'invalid_order_type' } };
    }
    if (!isPositiveFinite(args.triggerPrice)) return { error: { code: 'invalid_trigger_price' } };
    if (args.sizeUsd != null && args.sizePercent != null) {
      return { error: { code: 'ambiguous_order_size' } };
    }
    if (args.sizeUsd != null && !isPositiveFinite(args.sizeUsd))
      return { error: { code: 'invalid_order_size' } };
    if (
      args.sizePercent != null &&
      (!isPositiveFinite(args.sizePercent) || args.sizePercent > 100)
    ) {
      return { error: { code: 'invalid_order_size_percent' } };
    }

    try {
      const client = getFlashTradeClient();
      const [positions, orders, prices, tokens] = await Promise.all([
        client.getOwnerPositions(walletCheck.walletAddress, context.signal),
        client.getOwnerOrders(walletCheck.walletAddress, context.signal),
        client.getPrices(context.signal),
        client.getTokens(context.signal),
      ]);
      const position = resolvePositionReference(sortedPositions(positions), args.positionRef);
      if (position == null) return { error: { code: 'position_not_found' } };
      if (position.collateralUsd <= 10) return { error: { code: 'collateral_too_low_for_tpsl' } };
      const isStopLoss = args.orderType === 'stop_loss';
      const sameTypeOrderCount = orders.filter(
        (order) => order.marketPubkey === position.marketPubkey && order.isStopLoss === isStopLoss,
      ).length;
      if (sameTypeOrderCount >= FLASH_MAX_TRIGGER_ORDERS_PER_POSITION) {
        return { error: { code: 'max_trigger_orders' } };
      }
      const price = prices.find(
        (candidate) => candidate.symbol.toUpperCase() === position.marketSymbol.toUpperCase(),
      );
      if (price == null) return { error: { code: 'price_unavailable' } };
      const priceCheck = validateTradablePrice(price);
      if (!priceCheck.ok) return { error: { code: priceCheck.code } };
      const triggerCheck = validateTriggerPrice({
        orderType: args.orderType,
        side: position.side,
        triggerPrice: args.triggerPrice,
        currentPrice: price.price,
      });
      if (!triggerCheck.ok) return { error: { code: triggerCheck.code } };
      if (args.sizeUsd != null && args.sizeUsd > position.sizeUsd) {
        return { error: { code: 'order_size_exceeds_position' } };
      }
      const sizePercent =
        args.sizePercent ?? (args.sizeUsd != null ? (args.sizeUsd / position.sizeUsd) * 100 : 100);
      const sizeAmountUi = position.sizeAmountUi * (sizePercent / 100);
      if (!isPositiveFinite(sizeAmountUi)) return { error: { code: 'invalid_position_size' } };
      const marketToken = tokens.find(
        (token) => token.symbol.toUpperCase() === position.marketSymbol.toUpperCase(),
      );
      if (marketToken == null) return { error: { code: 'market_token_unavailable' } };
      const encodedSize = encodedAmountFromUi({
        amountUi: String(sizeAmountUi),
        decimals: marketToken.decimals,
        symbol: marketToken.symbol,
      });
      if (encodedSize == null) return { error: { code: 'invalid_position_size' } };
      const marketAccounts = await client.getMarketExecutionAccounts(
        position.marketPubkey,
        context.signal,
      );
      const receiveCustodyPubkey = custodyPubkeyForSymbol(
        marketAccounts,
        position.collateralSymbol,
      );
      if (receiveCustodyPubkey == null) {
        return { error: { code: 'trigger_receive_custody_unavailable' } };
      }

      const response = await client.placeTriggerOrder(
        {
          marketSymbol: position.marketSymbol,
          side: position.side === 'long' ? 'LONG' : 'SHORT',
          triggerPriceUi: String(args.triggerPrice),
          sizeAmountUi: String(sizeAmountUi),
          isStopLoss,
          owner: walletCheck.walletAddress,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/place-trigger-order', response);
      const decoded = requireDecodedInstruction(built.transactionBase64, 'place_trigger_order_er');
      if (
        decoded.accountPubkeys?.[9] !== receiveCustodyPubkey ||
        decoded.sizeRawAmount !== encodedSize.rawAmount ||
        decoded.isStopLoss !== isStopLoss ||
        decoded.triggerPrice == null ||
        Math.abs(decoded.triggerPrice - args.triggerPrice) >
          Math.max(1e-8, Math.abs(args.triggerPrice) * 1e-7)
      ) {
        throw new Error('Flash Trade trigger builder changed the confirmed price or size.');
      }
      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'place_trigger_order',
        actionLabel: isStopLoss ? 'Place stop loss' : 'Place take profit',
        walletAddress: walletCheck.walletAddress,
        network: 'mainnet',
        positionKey: position.positionKey,
        orderId: null,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: position.leverage,
        collateralUsd: position.collateralUsd,
        inputTokenSymbol: position.collateralSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: position.liquidationPrice,
        sizeUsd: position.sizeUsd * (sizePercent / 100),
        entryFeeUsd: 0,
        amountUsd: position.sizeUsd * (sizePercent / 100),
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'place_trigger_order',
          side: position.side,
          market: expectedMarketAccounts(marketAccounts, position.side),
          receiveCustodyPubkey,
          receiveTokenSymbol: position.collateralSymbol,
          triggerPrice: args.triggerPrice,
          isStopLoss,
          size: encodedSize,
        },
        expectedMarketPubkeys: [position.marketPubkey],
        expectedIsStopLoss: isStopLoss,
        expectedTriggerOrders: [{ triggerPrice: args.triggerPrice, isStopLoss }],
        triggerOrders: [
          { orderType: args.orderType, triggerPrice: args.triggerPrice, sizePercent },
        ],
      };
      return {
        result: {
          status: 'drafted',
          positionRef: positionRef(position),
          marketSymbol: position.marketSymbol,
          orderType: args.orderType,
          triggerPrice: args.triggerPrice,
          sizeUsd: draft.sizeUsd,
          sizeAmountUi,
          sizePercent,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
