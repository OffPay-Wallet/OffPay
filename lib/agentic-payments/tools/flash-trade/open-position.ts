import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { decodeFlashTradeEconomicInstructions } from '@/lib/flash-trade/execution';
import {
  custodyPubkeyForSymbol,
  encodedAmountFromDecoded,
  encodedAmountFromUi,
  errorCodeFromUnknown,
  expectedMarketAccounts,
  findMarketBySymbol,
  isPositiveFinite,
  requireMainnet,
  requireWallet,
  validateCollateral,
  validateLeverage,
  validateSide,
  validateSlippageBps,
  validateTradablePrice,
  validateTriggerPrice,
} from './helpers';
import type { FlashTradeDraft } from './types';

function decimalAmount(value: number, decimals: number): string {
  const fixed = value.toFixed(Math.min(Math.max(decimals, 0), 9));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

export const flashOpenPositionTool: AgenticToolDefinition = {
  name: 'flash_open_position',
  schema: {
    name: 'flash_open_position',
    description:
      'Build a real Flash Trade V2 mainnet position transaction using the live pool config and Pyth Lazer price. The wallet must already have an initialized, delegated, funded Flash basket.',
    parameters: {
      type: 'object',
      properties: {
        marketSymbol: { type: 'string', description: 'A symbol returned by flash_get_markets' },
        side: { type: 'string', enum: ['long', 'short'], description: 'Position direction' },
        leverage: {
          type: 'number',
          description: 'Leverage multiplier within the live market limit',
        },
        collateralUsd: { type: 'number', description: 'USD value of collateral to use' },
        inputTokenSymbol: {
          type: 'string',
          description: 'A non-virtual collateral token returned by the live Flash token catalog',
        },
        tradeType: {
          type: 'string',
          enum: ['market', 'limit'],
          description: 'Market or resting limit order',
        },
        limitPrice: {
          type: 'number',
          description:
            'Required for a limit order; long limits must be below mark and short limits above mark',
        },
        slippageBps: {
          type: 'number',
          description: 'Slippage in basis points, from 1 through 500; default 50',
        },
        takeProfitPrice: { type: 'number', description: 'Optional bundled take-profit price' },
        stopLossPrice: { type: 'number', description: 'Optional bundled stop-loss price' },
      },
      required: [
        'marketSymbol',
        'side',
        'leverage',
        'collateralUsd',
        'inputTokenSymbol',
        'tradeType',
      ],
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) return { error: { code: networkCheck.code } };
    const walletCheck = requireWallet(context.scope.walletAddress);
    if (!walletCheck.ok) return { error: { code: walletCheck.code } };
    if (!context.canUseNetwork) return { error: { code: 'network_unavailable' } };

    const args = call.args as {
      marketSymbol: string;
      side: string;
      leverage: number;
      collateralUsd: number;
      inputTokenSymbol: string;
      tradeType: 'market' | 'limit';
      limitPrice?: number;
      slippageBps?: number;
      takeProfitPrice?: number;
      stopLossPrice?: number;
    };
    const side = validateSide(args.side);
    if (!side.ok) return { error: { code: side.code } };
    if (args.tradeType !== 'market' && args.tradeType !== 'limit') {
      return { error: { code: 'invalid_trade_type' } };
    }
    const hasTriggers = args.takeProfitPrice != null || args.stopLossPrice != null;
    const collateral = validateCollateral(
      args.collateralUsd,
      hasTriggers || args.tradeType === 'limit',
    );
    if (!collateral.ok) return { error: { code: collateral.code } };
    const slippage = validateSlippageBps(args.slippageBps);
    if (!slippage.ok) return { error: { code: slippage.code } };
    if (args.tradeType === 'limit' && !isPositiveFinite(args.limitPrice)) {
      return { error: { code: 'limit_price_required' } };
    }

    try {
      const client = getFlashTradeClient();
      const [readiness, markets, tokens, prices, positions] = await Promise.all([
        client.getAccountReadiness(walletCheck.walletAddress, context.signal),
        client.getMarkets(context.signal),
        client.getTokens(context.signal),
        client.getPrices(context.signal),
        client.getOwnerPositions(walletCheck.walletAddress, context.signal),
      ]);
      if (!readiness.ready) return { error: { code: `flash_${readiness.reason}` } };

      const market = findMarketBySymbol(markets, args.marketSymbol, side.side);
      if (market == null) return { error: { code: 'invalid_market' } };
      if (market.status !== 'active') {
        return {
          error: { code: market.status === 'paused' ? 'market_session_closed' : 'market_disabled' },
        };
      }
      const leverage = validateLeverage(
        args.leverage,
        market.maxLeverage,
        false,
        market.maxLeverageDegen,
      );
      if (!leverage.ok) return { error: { code: leverage.code } };

      const marketPrice = prices.find(
        (price) => price.symbol.toUpperCase() === market.symbol.toUpperCase(),
      );
      if (marketPrice == null) return { error: { code: 'price_unavailable' } };
      const marketPriceCheck = validateTradablePrice(marketPrice);
      if (!marketPriceCheck.ok) return { error: { code: marketPriceCheck.code } };

      for (const [orderType, price] of [
        ['limit', args.limitPrice],
        ['take_profit', args.takeProfitPrice],
        ['stop_loss', args.stopLossPrice],
      ] as const) {
        if (price == null) continue;
        const validation = validateTriggerPrice({
          orderType,
          side: side.side,
          triggerPrice: price,
          currentPrice: marketPrice.price,
        });
        if (!validation.ok) return { error: { code: validation.code } };
      }

      const inputToken = tokens.find(
        (token) => token.symbol.toUpperCase() === args.inputTokenSymbol.trim().toUpperCase(),
      );
      if (inputToken == null || inputToken.isVirtual) {
        return { error: { code: 'invalid_collateral_token' } };
      }
      const inputPrice = prices.find(
        (price) => price.symbol.toUpperCase() === inputToken.symbol.toUpperCase(),
      );
      if (inputPrice == null) return { error: { code: 'collateral_price_unavailable' } };
      const inputPriceCheck = validateTradablePrice(inputPrice);
      if (!inputPriceCheck.ok) return { error: { code: inputPriceCheck.code } };
      const inputAmountUi = decimalAmount(
        args.collateralUsd / inputPrice.price,
        inputToken.decimals,
      );
      const collateralAmount = encodedAmountFromUi({
        amountUi: inputAmountUi,
        decimals: inputToken.decimals,
        symbol: inputToken.symbol,
      });
      if (collateralAmount == null) return { error: { code: 'invalid_collateral_amount' } };

      const marketPubkey =
        side.side === 'long' ? market.longMarketPubkey : market.shortMarketPubkey;
      if (marketPubkey == null) return { error: { code: 'market_side_disabled' } };
      const marketAccounts = await client.getMarketExecutionAccounts(marketPubkey, context.signal);
      const inputCustodyPubkey = custodyPubkeyForSymbol(marketAccounts, inputToken.symbol);
      if (inputCustodyPubkey == null) return { error: { code: 'collateral_custody_unavailable' } };
      const response = await client.openPosition(
        {
          inputTokenSymbol: inputToken.symbol,
          outputTokenSymbol: market.symbol,
          inputAmountUi,
          leverage: args.leverage,
          tradeType: side.apiSide,
          orderType: args.tradeType === 'limit' ? 'LIMIT' : 'MARKET',
          limitPrice: args.limitPrice != null ? String(args.limitPrice) : undefined,
          takeProfit: args.takeProfitPrice != null ? String(args.takeProfitPrice) : undefined,
          stopLoss: args.stopLossPrice != null ? String(args.stopLossPrice) : undefined,
          owner: walletCheck.walletAddress,
          slippagePercentage: slippage.slippagePercentage,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/open-position', response);
      const sizeAmount = encodedAmountFromDecoded({
        rawAmount: built.outputAmount,
        decimals: market.baseDecimals,
        symbol: market.symbol,
      });
      const decoded = decodeFlashTradeEconomicInstructions(built.transactionBase64);
      const decodedPositionChange = decoded.some(
        (instruction) => instruction.name === 'increase_position_size_er',
      )
        ? 'increase'
        : 'open';
      const positionChange = positions.some((position) => position.marketPubkey === marketPubkey)
        ? 'increase'
        : 'open';
      if (args.tradeType === 'market' && decodedPositionChange !== positionChange) {
        throw new Error('Flash Trade open builder returned an unexpected position-change mode.');
      }
      const primaryName =
        args.tradeType === 'limit'
          ? 'place_limit_order_er'
          : positionChange === 'increase'
            ? 'increase_position_size_er'
            : 'open_position_er';
      const primaryInstructions = decoded.filter((instruction) => instruction.name === primaryName);
      const primaryInstruction = primaryInstructions[0];
      const selectedCustodyIndexes =
        args.tradeType === 'limit' ? [10, 11] : positionChange === 'increase' ? [9] : [10];
      if (
        primaryInstructions.length !== 1 ||
        primaryInstruction == null ||
        selectedCustodyIndexes.some(
          (index) => primaryInstruction.accountPubkeys?.[index] !== inputCustodyPubkey,
        ) ||
        primaryInstruction.collateralRawAmount !== collateralAmount.rawAmount ||
        primaryInstruction.sizeRawAmount !== sizeAmount.rawAmount
      ) {
        throw new Error('Flash Trade open builder returned mismatched collateral or size data.');
      }
      if (
        (args.tradeType === 'market' && primaryInstruction.privilege !== 'none') ||
        (args.tradeType === 'limit' && primaryInstruction.privilege != null)
      ) {
        throw new Error('Flash Trade open builder returned an unsupported privilege mode.');
      }
      const entryFeeUsd = Number(built.entryFee);
      if ((hasTriggers || args.tradeType === 'limit') && args.collateralUsd - entryFeeUsd <= 10) {
        return { error: { code: 'collateral_too_low_after_fees' } };
      }

      const triggerOrders: NonNullable<FlashTradeDraft['triggerOrders']> = [];
      if (args.takeProfitPrice != null) {
        triggerOrders.push({
          orderType: 'take_profit',
          triggerPrice: args.takeProfitPrice,
          sizePercent: 100,
        });
      }
      if (args.stopLossPrice != null) {
        triggerOrders.push({
          orderType: 'stop_loss',
          triggerPrice: args.stopLossPrice,
          sizePercent: 100,
        });
      }
      const hourlyBorrowRatePercent = Number(built.marginFeePercentage);
      const rateWarnings =
        Number.isFinite(hourlyBorrowRatePercent) && hourlyBorrowRatePercent > 0.01
          ? ['High hourly borrow rate. Review the cost before confirming.']
          : undefined;
      const warnings = [
        ...(positionChange === 'increase'
          ? [
              'This adds to an existing same-side position; review the resulting leverage carefully.',
            ]
          : []),
        ...(rateWarnings ?? []),
      ];
      const expectedTriggers =
        args.tradeType === 'market'
          ? triggerOrders.map((order) => ({
              triggerPrice: order.triggerPrice,
              isStopLoss: order.orderType === 'stop_loss',
              size: sizeAmount,
              receiveCustodyPubkey: inputCustodyPubkey,
            }))
          : [];
      const decodedTriggers = decoded.filter(
        (instruction) => instruction.name === 'place_trigger_order_er',
      );
      if (
        decodedTriggers.length !== expectedTriggers.length ||
        decodedTriggers.some(
          (instruction) =>
            instruction.sizeRawAmount !== sizeAmount.rawAmount ||
            !expectedTriggers.some(
              (expected) =>
                expected.isStopLoss === instruction.isStopLoss &&
                instruction.triggerPrice != null &&
                Math.abs(expected.triggerPrice - instruction.triggerPrice) <=
                  Math.max(1e-8, Math.abs(expected.triggerPrice) * 1e-7),
            ),
        )
      ) {
        throw new Error('Flash Trade open builder returned mismatched TP/SL economics.');
      }

      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'open_position',
        actionLabel: positionChange === 'increase' ? 'Increase position' : 'Open position',
        walletAddress: walletCheck.walletAddress,
        network: 'mainnet',
        positionKey: null,
        marketSymbol: market.symbol,
        side: side.side,
        leverage: Number(built.newLeverage),
        collateralUsd: Number(built.youPayUsdUi),
        inputTokenSymbol: inputToken.symbol,
        tradeType: args.tradeType,
        limitPrice: args.limitPrice,
        entryPrice: Number(built.newEntryPrice),
        liquidationPrice: Number(built.newLiquidationPrice),
        sizeUsd: Number(built.youRecieveUsdUi),
        entryFeeUsd,
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'open_position',
          side: side.side,
          tradeType: args.tradeType,
          positionChange,
          market: expectedMarketAccounts(marketAccounts, side.side),
          inputCustodyPubkey,
          collateral: collateralAmount,
          size: sizeAmount,
          executionPriceLimit:
            args.tradeType === 'market' ? (primaryInstruction.executionPrice ?? null) : null,
          privilege: args.tradeType === 'market' ? 'none' : null,
          limitPrice: args.limitPrice,
          stopLossPrice: args.stopLossPrice,
          takeProfitPrice: args.takeProfitPrice,
          triggerOrders: expectedTriggers,
        },
        expectedMarketPubkeys: [marketPubkey],
        expectedTriggerOrderCount: args.tradeType === 'market' ? triggerOrders.length : 0,
        expectedLimitPrice: args.limitPrice,
        expectedTriggerOrders: triggerOrders.map((order) => ({
          triggerPrice: order.triggerPrice,
          isStopLoss: order.orderType === 'stop_loss',
        })),
        triggerOrders: triggerOrders.length > 0 ? triggerOrders : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      return {
        result: {
          status: 'drafted',
          marketSymbol: market.symbol,
          side: side.side,
          leverage: draft.leverage,
          collateralUsd: draft.collateralUsd,
          inputAmountUi,
          inputTokenSymbol: inputToken.symbol,
          sizeUsd: draft.sizeUsd,
          entryPrice: draft.entryPrice,
          liquidationPrice: draft.liquidationPrice,
          entryFeeUsd,
          hourlyBorrowRatePercent,
          triggerOrders: triggerOrders.length > 0 ? triggerOrders : undefined,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
