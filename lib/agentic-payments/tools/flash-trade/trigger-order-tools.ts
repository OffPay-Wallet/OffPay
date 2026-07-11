import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient, type FlashTradeEconomicIntent } from '@/lib/flash-trade';
import {
  custodyPubkeyForSymbol,
  encodedAmountFromDecoded,
  encodedAmountFromUi,
  errorCodeFromUnknown,
  expectedMarketAccounts,
  isPositiveFinite,
  orderRef,
  positionRef,
  requireMainnet,
  requireDecodedInstruction,
  requireWallet,
  resolveOrderReference,
  resolvePositionReference,
  sortedOrders,
  sortedPositions,
  symbolForCustodyPubkey,
  validateLeverage,
  validateSlippageBps,
  validateTradablePrice,
  validateTriggerPrice,
} from './helpers';
import type { FlashTradeDraft } from './types';

export const flashEditTriggerOrderTool: AgenticToolDefinition = {
  name: 'flash_edit_trigger_order',
  schema: {
    name: 'flash_edit_trigger_order',
    description:
      'Build a real Flash Trade V2 mainnet transaction that edits a TP/SL order identified by an opaque order reference.',
    parameters: {
      type: 'object',
      properties: {
        orderRef: {
          type: 'string',
          description: 'Opaque order_ref_N returned by flash_get_orders',
        },
        newTriggerPrice: { type: 'number', description: 'Replacement trigger price' },
        newSizeUsd: {
          type: 'number',
          description: 'Optional replacement USD size; existing size is preserved if omitted',
        },
      },
      required: ['orderRef', 'newTriggerPrice'],
    },
  },
  run: async (call, context) => {
    const scope = validateScope(context);
    if (!scope.ok) return { error: { code: scope.code } };
    const args = call.args as { orderRef: string; newTriggerPrice: number; newSizeUsd?: number };
    if (!isPositiveFinite(args.newTriggerPrice))
      return { error: { code: 'invalid_trigger_price' } };
    if (args.newSizeUsd != null && !isPositiveFinite(args.newSizeUsd)) {
      return { error: { code: 'invalid_order_size' } };
    }
    try {
      const client = getFlashTradeClient();
      const [orders, positions, prices, tokens] = await Promise.all([
        client.getOwnerOrders(scope.walletAddress, context.signal),
        client.getOwnerPositions(scope.walletAddress, context.signal),
        client.getPrices(context.signal),
        client.getTokens(context.signal),
      ]);
      const order = resolveOrderReference(sortedOrders(orders), args.orderRef);
      if (order == null) return { error: { code: 'order_not_found' } };
      const position = positions.find((candidate) => candidate.marketPubkey === order.marketPubkey);
      if (position == null) return { error: { code: 'position_not_found' } };
      const price = prices.find(
        (candidate) => candidate.symbol.toUpperCase() === order.marketSymbol.toUpperCase(),
      );
      if (price == null) return { error: { code: 'price_unavailable' } };
      const priceCheck = validateTradablePrice(price);
      if (!priceCheck.ok) return { error: { code: priceCheck.code } };
      const triggerCheck = validateTriggerPrice({
        orderType: order.isStopLoss ? 'stop_loss' : 'take_profit',
        side: order.side,
        triggerPrice: args.newTriggerPrice,
        currentPrice: price.price,
      });
      if (!triggerCheck.ok) return { error: { code: triggerCheck.code } };
      if (args.newSizeUsd != null && args.newSizeUsd > position.sizeUsd) {
        return { error: { code: 'order_size_exceeds_position' } };
      }
      const sizeAmountUi =
        args.newSizeUsd == null
          ? order.sizeAmountUi
          : position.sizeAmountUi * (args.newSizeUsd / position.sizeUsd);
      const marketToken = tokens.find(
        (token) => token.symbol.toUpperCase() === order.marketSymbol.toUpperCase(),
      );
      if (marketToken == null) return { error: { code: 'market_token_unavailable' } };
      const encodedSize = encodedAmountFromUi({
        amountUi: String(sizeAmountUi),
        decimals: marketToken.decimals,
        symbol: marketToken.symbol,
      });
      if (encodedSize == null) return { error: { code: 'invalid_order_size' } };
      if (order.receiveTokenSymbol == null) {
        return { error: { code: 'trigger_receive_token_unavailable' } };
      }
      const marketAccounts = await client.getMarketExecutionAccounts(
        order.marketPubkey,
        context.signal,
      );
      const receiveCustodyPubkey = custodyPubkeyForSymbol(marketAccounts, order.receiveTokenSymbol);
      if (receiveCustodyPubkey == null) {
        return { error: { code: 'trigger_receive_custody_unavailable' } };
      }
      const response = await client.editTriggerOrder(
        {
          marketSymbol: order.marketSymbol,
          side: order.side === 'long' ? 'LONG' : 'SHORT',
          orderId: order.orderSlot,
          isStopLoss: order.isStopLoss,
          triggerPriceUi: String(args.newTriggerPrice),
          sizeAmountUi: String(sizeAmountUi),
          owner: scope.walletAddress,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/edit-trigger-order', response);
      const decoded = requireDecodedInstruction(built.transactionBase64, 'edit_trigger_order_er');
      if (decoded.accountPubkeys?.[9] !== receiveCustodyPubkey) {
        return { error: { code: 'trigger_edit_settlement_changed' } };
      }
      if (
        decoded.sizeRawAmount !== encodedSize.rawAmount ||
        decoded.orderSlot !== order.orderSlot ||
        decoded.isStopLoss !== order.isStopLoss ||
        decoded.triggerPrice == null ||
        Math.abs(decoded.triggerPrice - args.newTriggerPrice) >
          Math.max(1e-8, Math.abs(args.newTriggerPrice) * 1e-7)
      ) {
        throw new Error('Flash Trade edit-trigger builder changed the confirmed economics.');
      }
      const sizeUsd = args.newSizeUsd ?? order.sizeUsd;
      const sizePercent =
        position.sizeUsd > 0 ? Math.min(100, (sizeUsd / position.sizeUsd) * 100) : 0;
      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'edit_trigger_order',
        actionLabel: order.isStopLoss ? 'Edit stop loss' : 'Edit take profit',
        walletAddress: scope.walletAddress,
        network: 'mainnet',
        positionKey: position.positionKey,
        orderId: order.orderId,
        marketSymbol: order.marketSymbol,
        side: order.side,
        leverage: position.leverage,
        collateralUsd: position.collateralUsd,
        inputTokenSymbol: position.collateralSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: position.liquidationPrice,
        sizeUsd,
        entryFeeUsd: 0,
        amountUsd: sizeUsd,
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'edit_trigger_order',
          side: order.side,
          market: expectedMarketAccounts(marketAccounts, order.side),
          receiveCustodyPubkey,
          receiveTokenSymbol: order.receiveTokenSymbol,
          orderSlot: order.orderSlot,
          triggerPrice: args.newTriggerPrice,
          isStopLoss: order.isStopLoss,
          size: encodedSize,
        },
        expectedMarketPubkeys: [order.marketPubkey],
        expectedOrderSlot: order.orderSlot,
        expectedIsStopLoss: order.isStopLoss,
        expectedTriggerOrders: [
          {
            triggerPrice: args.newTriggerPrice,
            isStopLoss: order.isStopLoss,
          },
        ],
        triggerOrders: [
          {
            orderType: order.isStopLoss ? 'stop_loss' : 'take_profit',
            triggerPrice: args.newTriggerPrice,
            sizePercent,
          },
        ],
      };
      return {
        result: {
          status: 'drafted',
          orderRef: orderRef(order),
          marketSymbol: order.marketSymbol,
          orderType: order.isStopLoss ? 'stop_loss' : 'take_profit',
          newTriggerPrice: args.newTriggerPrice,
          newSizeUsd: sizeUsd,
          sizeAmountUi,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashCancelTriggerOrderTool: AgenticToolDefinition = {
  name: 'flash_cancel_trigger_order',
  schema: {
    name: 'flash_cancel_trigger_order',
    description:
      'Build a real Flash Trade V2 mainnet transaction that cancels one TP/SL order by opaque order reference.',
    parameters: {
      type: 'object',
      properties: {
        orderRef: {
          type: 'string',
          description: 'Opaque order_ref_N returned by flash_get_orders',
        },
      },
      required: ['orderRef'],
    },
  },
  run: async (call, context) => {
    const scope = validateScope(context);
    if (!scope.ok) return { error: { code: scope.code } };
    const reference = call.args.orderRef as string;
    try {
      const client = getFlashTradeClient();
      const [orders, positions] = await Promise.all([
        client.getOwnerOrders(scope.walletAddress, context.signal),
        client.getOwnerPositions(scope.walletAddress, context.signal),
      ]);
      const order = resolveOrderReference(sortedOrders(orders), reference);
      if (order == null) return { error: { code: 'order_not_found' } };
      const position = positions.find((candidate) => candidate.marketPubkey === order.marketPubkey);
      if (position == null) return { error: { code: 'position_not_found' } };
      const marketAccounts = await client.getMarketExecutionAccounts(
        order.marketPubkey,
        context.signal,
      );
      const response = await client.cancelTriggerOrder(
        {
          marketSymbol: order.marketSymbol,
          side: order.side === 'long' ? 'LONG' : 'SHORT',
          orderId: order.orderSlot,
          isStopLoss: order.isStopLoss,
          owner: scope.walletAddress,
        },
        context.signal,
      );
      const built = client.requireTransaction(
        '/transaction-builder/cancel-trigger-order',
        response,
      );
      const draft = baseOrderDraft({
        operation: 'cancel_trigger_order',
        actionLabel: order.isStopLoss ? 'Cancel stop loss' : 'Cancel take profit',
        walletAddress: scope.walletAddress,
        position,
        orderId: order.orderId,
        transactionBase64: built.transactionBase64,
        expectedOrderSlot: order.orderSlot,
        expectedIsStopLoss: order.isStopLoss,
        economicIntent: {
          operation: 'cancel_trigger_order',
          side: order.side,
          market: expectedMarketAccounts(marketAccounts, order.side),
          orderSlot: order.orderSlot,
          isStopLoss: order.isStopLoss,
        },
      });
      return {
        result: {
          status: 'drafted',
          orderRef: orderRef(order),
          marketSymbol: order.marketSymbol,
          orderType: order.isStopLoss ? 'stop_loss' : 'take_profit',
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashCancelAllTriggerOrdersTool: AgenticToolDefinition = {
  name: 'flash_cancel_all_trigger_orders',
  schema: {
    name: 'flash_cancel_all_trigger_orders',
    description:
      'Build a real Flash Trade V2 mainnet transaction that cancels every TP/SL slot for one live position.',
    parameters: {
      type: 'object',
      properties: {
        positionRef: {
          type: 'string',
          description: 'Opaque position_ref_N returned by flash_get_positions',
        },
      },
      required: ['positionRef'],
    },
  },
  run: async (call, context) => {
    const scope = validateScope(context);
    if (!scope.ok) return { error: { code: scope.code } };
    try {
      const client = getFlashTradeClient();
      const positions = sortedPositions(
        await client.getOwnerPositions(scope.walletAddress, context.signal),
      );
      const position = resolvePositionReference(positions, call.args.positionRef as string);
      if (position == null) return { error: { code: 'position_not_found' } };
      if (position.triggerOrderCount === 0) return { error: { code: 'no_trigger_orders' } };
      const marketAccounts = await client.getMarketExecutionAccounts(
        position.marketPubkey,
        context.signal,
      );
      const response = await client.cancelAllTriggerOrders(
        {
          marketSymbol: position.marketSymbol,
          side: position.side === 'long' ? 'LONG' : 'SHORT',
          owner: scope.walletAddress,
        },
        context.signal,
      );
      const built = client.requireTransaction(
        '/transaction-builder/cancel-trigger-order',
        response,
      );
      const draft = baseOrderDraft({
        operation: 'cancel_all_trigger_orders',
        actionLabel: 'Cancel all trigger orders',
        walletAddress: scope.walletAddress,
        position,
        transactionBase64: built.transactionBase64,
        economicIntent: {
          operation: 'cancel_all_trigger_orders',
          side: position.side,
          market: expectedMarketAccounts(marketAccounts, position.side),
        },
      });
      return {
        result: {
          status: 'drafted',
          positionRef: positionRef(position),
          marketSymbol: position.marketSymbol,
          side: position.side,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashReversePositionTool: AgenticToolDefinition = {
  name: 'flash_reverse_position',
  schema: {
    name: 'flash_reverse_position',
    description:
      'Build a real Flash Trade V2 mainnet transaction that atomically closes a position and opens the opposite side. Flash applies a 2% proceeds haircut.',
    parameters: {
      type: 'object',
      properties: {
        positionRef: {
          type: 'string',
          description: 'Opaque position_ref_N returned by flash_get_positions',
        },
        newLeverage: {
          type: 'number',
          description: 'Leverage on the opposite side; existing leverage is used if omitted',
        },
        slippageBps: {
          type: 'number',
          description: 'Slippage in basis points, from 1 through 500; default 50',
        },
      },
      required: ['positionRef'],
    },
  },
  run: async (call, context) => {
    const scope = validateScope(context);
    if (!scope.ok) return { error: { code: scope.code } };
    const args = call.args as { positionRef: string; newLeverage?: number; slippageBps?: number };
    const slippage = validateSlippageBps(args.slippageBps);
    if (!slippage.ok) return { error: { code: slippage.code } };
    try {
      const client = getFlashTradeClient();
      const positions = sortedPositions(
        await client.getOwnerPositions(scope.walletAddress, context.signal),
      );
      const position = resolvePositionReference(positions, args.positionRef);
      if (position == null) return { error: { code: 'position_not_found' } };
      const market = await client.getMarket(position.marketPubkey, context.signal);
      const newLeverage = args.newLeverage ?? position.leverage;
      const leverageCheck = validateLeverage(
        newLeverage,
        market.maxLeverage,
        false,
        market.maxLeverageDegen,
      );
      if (!leverageCheck.ok) return { error: { code: leverageCheck.code } };
      const oppositeMarket =
        position.side === 'long' ? market.shortMarketPubkey : market.longMarketPubkey;
      if (oppositeMarket == null) return { error: { code: 'opposite_market_disabled' } };
      const [tokens, sourceMarketAccounts, destinationMarketAccounts] = await Promise.all([
        client.getTokens(context.signal),
        client.getMarketExecutionAccounts(position.marketPubkey, context.signal),
        client.getMarketExecutionAccounts(oppositeMarket, context.signal),
      ]);
      const settlementCustodyPubkey = destinationMarketAccounts.collateralCustodyPubkey;
      const settlementTokenSymbol = symbolForCustodyPubkey(
        destinationMarketAccounts,
        settlementCustodyPubkey,
      );
      if (settlementTokenSymbol == null) {
        return { error: { code: 'reverse_settlement_token_unavailable' } };
      }
      const settlementToken = tokens.find(
        (token) => token.symbol.toUpperCase() === settlementTokenSymbol,
      );
      const marketToken = tokens.find(
        (token) => token.symbol.toUpperCase() === position.marketSymbol.toUpperCase(),
      );
      if (settlementToken == null || marketToken == null) {
        return { error: { code: 'reverse_token_metadata_unavailable' } };
      }
      const response = await client.reversePosition(
        {
          marketSymbol: position.marketSymbol,
          side: position.side === 'long' ? 'LONG' : 'SHORT',
          leverage: newLeverage,
          owner: scope.walletAddress,
          slippagePercentage: slippage.slippagePercentage,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/reverse-position', response);
      if (Math.abs(Number(built.newLeverage) - newLeverage) > 0.01) {
        throw new Error('Flash Trade reverse builder changed the confirmed leverage.');
      }
      const closeInstruction = requireDecodedInstruction(
        built.transactionBase64,
        'close_position_er',
      );
      const openInstruction = requireDecodedInstruction(
        built.transactionBase64,
        'open_position_er',
      );
      if (
        closeInstruction.executionPrice == null ||
        closeInstruction.privilege !== 'none' ||
        openInstruction.executionPrice == null ||
        openInstruction.privilege !== 'none' ||
        closeInstruction.accountPubkeys?.[9] !== settlementCustodyPubkey ||
        openInstruction.accountPubkeys?.[10] !== settlementCustodyPubkey
      ) {
        throw new Error('Flash Trade reverse builder changed the settlement custody.');
      }
      const encodedCollateral = encodedAmountFromDecoded({
        rawAmount: openInstruction.collateralRawAmount,
        decimals: settlementToken.decimals,
        symbol: settlementToken.symbol,
      });
      const encodedSize = encodedAmountFromDecoded({
        rawAmount: openInstruction.sizeRawAmount,
        decimals: marketToken.decimals,
        symbol: marketToken.symbol,
      });
      const newSide = position.side === 'long' ? 'short' : 'long';
      const warnings =
        position.triggerOrderCount > 0
          ? ['Reversing removes the current position and its trigger orders.']
          : undefined;
      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'reverse_position',
        actionLabel: 'Reverse position',
        walletAddress: scope.walletAddress,
        network: 'mainnet',
        positionKey: position.positionKey,
        marketSymbol: position.marketSymbol,
        side: newSide,
        leverage: Number(built.newLeverage),
        collateralUsd: Number(built.newCollateralUsd),
        inputTokenSymbol: settlementToken.symbol,
        tradeType: 'market',
        entryPrice: Number(built.newEntryPrice),
        liquidationPrice: Number(built.newLiquidationPrice),
        sizeUsd: Number(built.newSizeUsd),
        entryFeeUsd: Number(built.openEntryFee),
        realizedPnlUsd: Number(built.closeSettledPnl),
        feesUsd: Number(built.closeFees),
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'reverse_position',
          sourceSide: position.side,
          destinationSide: newSide,
          sourceMarket: expectedMarketAccounts(sourceMarketAccounts, position.side),
          destinationMarket: expectedMarketAccounts(destinationMarketAccounts, newSide),
          settlementCustodyPubkey,
          settlementTokenSymbol: settlementToken.symbol,
          collateral: encodedCollateral,
          size: encodedSize,
          closeExecutionPriceLimit: closeInstruction.executionPrice,
          openExecutionPriceLimit: openInstruction.executionPrice,
          closePrivilege: 'none',
          openPrivilege: 'none',
          cleanupTriggerOrders: position.triggerOrderCount > 0,
        },
        expectedMarketPubkeys: [position.marketPubkey, oppositeMarket],
        warnings,
      };
      return {
        result: {
          status: 'drafted',
          positionRef: positionRef(position),
          marketSymbol: position.marketSymbol,
          previousSide: position.side,
          newSide,
          leverage: draft.leverage,
          collateralUsd: draft.collateralUsd,
          sizeUsd: draft.sizeUsd,
          settledPnlUsd: draft.realizedPnlUsd,
          feesUsd: draft.feesUsd,
          warnings,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

function validateScope(
  context: Parameters<AgenticToolDefinition['run']>[1],
): { ok: true; walletAddress: string } | { ok: false; code: string } {
  const network = requireMainnet(context.scope.network);
  if (!network.ok) return network;
  const wallet = requireWallet(context.scope.walletAddress);
  if (!wallet.ok) return wallet;
  if (!context.canUseNetwork) return { ok: false, code: 'network_unavailable' };
  return { ok: true, walletAddress: wallet.walletAddress };
}

function baseOrderDraft(params: {
  operation: 'cancel_trigger_order' | 'cancel_all_trigger_orders';
  actionLabel: string;
  walletAddress: string;
  position: Awaited<
    ReturnType<ReturnType<typeof getFlashTradeClient>['getOwnerPositions']>
  >[number];
  orderId?: string;
  transactionBase64: string;
  economicIntent: FlashTradeEconomicIntent;
  expectedOrderSlot?: number;
  expectedIsStopLoss?: boolean;
}): FlashTradeDraft {
  return {
    kind: 'flash_position',
    operation: params.operation,
    actionLabel: params.actionLabel,
    walletAddress: params.walletAddress,
    network: 'mainnet',
    positionKey: params.position.positionKey,
    orderId: params.orderId ?? null,
    marketSymbol: params.position.marketSymbol,
    side: params.position.side,
    leverage: params.position.leverage,
    collateralUsd: params.position.collateralUsd,
    inputTokenSymbol: params.position.collateralSymbol,
    tradeType: 'market',
    entryPrice: params.position.entryPrice,
    liquidationPrice: params.position.liquidationPrice,
    sizeUsd: params.position.sizeUsd,
    entryFeeUsd: 0,
    transactionBase64: params.transactionBase64,
    expiresAt: null,
    economicIntent: params.economicIntent,
    expectedMarketPubkeys: [params.position.marketPubkey],
    expectedOrderSlot: params.expectedOrderSlot,
    expectedIsStopLoss: params.expectedIsStopLoss,
  };
}
