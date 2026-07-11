import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
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
  validateSlippageBps,
  validateTradablePrice,
} from './helpers';
import type { FlashTradeDraft } from './types';

function decimalAmount(value: number, decimals: number): string {
  const fixed = value.toFixed(Math.min(Math.max(decimals, 0), 9));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

export const flashAddCollateralTool: AgenticToolDefinition = {
  name: 'flash_add_collateral',
  schema: {
    name: 'flash_add_collateral',
    description:
      'Build a real Flash Trade V2 mainnet transaction that reallocates an already-funded Flash ledger balance as margin on an existing position. This never funds Flash from the wallet. The amount is specified in USD and converted with the live collateral-token oracle price.',
    parameters: {
      type: 'object',
      properties: {
        positionRef: {
          type: 'string',
          description: 'Opaque position_ref_N returned by flash_get_positions',
        },
        depositAmountUsd: { type: 'number', description: 'USD value of collateral to add' },
        depositTokenSymbol: { type: 'string', description: 'Non-virtual Flash collateral token' },
        slippageBps: {
          type: 'number',
          description: 'Slippage in basis points, from 1 through 500; default 50',
        },
      },
      required: ['positionRef', 'depositAmountUsd', 'depositTokenSymbol'],
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
      depositAmountUsd: number;
      depositTokenSymbol: string;
      slippageBps?: number;
    };
    if (!isPositiveFinite(args.depositAmountUsd)) return { error: { code: 'invalid_amount' } };
    const slippage = validateSlippageBps(args.slippageBps);
    if (!slippage.ok) return { error: { code: slippage.code } };

    try {
      const client = getFlashTradeClient();
      const [positions, tokens, prices] = await Promise.all([
        client.getOwnerPositions(walletCheck.walletAddress, context.signal),
        client.getTokens(context.signal),
        client.getPrices(context.signal),
      ]);
      const sorted = sortedPositions(positions);
      const position = resolvePositionReference(sorted, args.positionRef);
      if (position == null) return { error: { code: 'position_not_found' } };
      const token = tokens.find(
        (candidate) =>
          candidate.symbol.toUpperCase() === args.depositTokenSymbol.trim().toUpperCase(),
      );
      if (token == null || token.isVirtual) return { error: { code: 'invalid_collateral_token' } };
      const price = prices.find(
        (candidate) => candidate.symbol.toUpperCase() === token.symbol.toUpperCase(),
      );
      if (price == null) return { error: { code: 'collateral_price_unavailable' } };
      const priceCheck = validateTradablePrice(price);
      if (!priceCheck.ok) return { error: { code: priceCheck.code } };
      const depositAmountUi = decimalAmount(args.depositAmountUsd / price.price, token.decimals);
      const encodedDeposit = encodedAmountFromUi({
        amountUi: depositAmountUi,
        decimals: token.decimals,
        symbol: token.symbol,
      });
      if (encodedDeposit == null) return { error: { code: 'invalid_collateral_amount' } };
      const marketAccounts = await client.getMarketExecutionAccounts(
        position.marketPubkey,
        context.signal,
      );
      const inputCustodyPubkey = custodyPubkeyForSymbol(marketAccounts, token.symbol);
      if (inputCustodyPubkey == null) {
        return { error: { code: 'collateral_custody_unavailable' } };
      }

      const response = await client.addCollateral(
        {
          marketSymbol: position.marketSymbol,
          side: position.side === 'long' ? 'LONG' : 'SHORT',
          depositAmountUi,
          depositTokenSymbol: token.symbol,
          owner: walletCheck.walletAddress,
          slippagePercentage: slippage.slippagePercentage,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/add-collateral', response);
      const decoded = requireDecodedInstruction(built.transactionBase64, 'add_collateral_er');
      if (
        decoded.accountPubkeys?.[9] !== inputCustodyPubkey ||
        decoded.collateralRawAmount !== encodedDeposit.rawAmount
      ) {
        throw new Error('Flash Trade add-collateral builder changed the confirmed amount.');
      }
      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'add_collateral',
        actionLabel: 'Add collateral',
        walletAddress: walletCheck.walletAddress,
        network: 'mainnet',
        positionKey: position.positionKey,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: Number(built.newLeverage),
        collateralUsd: Number(built.newCollateralUsd),
        inputTokenSymbol: token.symbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: Number(built.newLiquidationPrice),
        sizeUsd: position.sizeUsd,
        entryFeeUsd: 0,
        amountUsd: Number(built.depositUsdValue),
        amountTokenSymbol: token.symbol,
        newLeverage: Number(built.newLeverage),
        newLiquidationPrice: Number(built.newLiquidationPrice),
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'add_collateral',
          side: position.side,
          market: expectedMarketAccounts(marketAccounts, position.side),
          inputCustodyPubkey,
          amount: encodedDeposit,
        },
        expectedMarketPubkeys: [position.marketPubkey],
      };
      return {
        result: {
          status: 'drafted',
          positionRef: positionRef(position),
          marketSymbol: position.marketSymbol,
          depositAmountUsd: Number(built.depositUsdValue),
          depositAmountUi,
          depositTokenSymbol: token.symbol,
          previousLeverage: Number(built.existingLeverage),
          previousLiquidationPrice: Number(built.existingLiquidationPrice),
          newLeverage: Number(built.newLeverage),
          newLiquidationPrice: Number(built.newLiquidationPrice),
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashRemoveCollateralTool: AgenticToolDefinition = {
  name: 'flash_remove_collateral',
  schema: {
    name: 'flash_remove_collateral',
    description:
      'Build a real Flash Trade V2 mainnet transaction that removes margin from a position. Removal raises liquidation risk and is bounded by the protocol preview.',
    parameters: {
      type: 'object',
      properties: {
        positionRef: {
          type: 'string',
          description: 'Opaque position_ref_N returned by flash_get_positions',
        },
        withdrawAmountUsd: { type: 'number', description: 'USD margin amount to remove' },
        withdrawTokenSymbol: { type: 'string', description: 'Settlement token symbol' },
        slippageBps: {
          type: 'number',
          description: 'Slippage in basis points, from 1 through 500; default 50',
        },
      },
      required: ['positionRef', 'withdrawAmountUsd', 'withdrawTokenSymbol'],
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
      withdrawAmountUsd: number;
      withdrawTokenSymbol: string;
      slippageBps?: number;
    };
    if (!isPositiveFinite(args.withdrawAmountUsd)) return { error: { code: 'invalid_amount' } };
    const slippage = validateSlippageBps(args.slippageBps);
    if (!slippage.ok) return { error: { code: slippage.code } };

    try {
      const client = getFlashTradeClient();
      const sorted = sortedPositions(
        await client.getOwnerPositions(walletCheck.walletAddress, context.signal),
      );
      const position = resolvePositionReference(sorted, args.positionRef);
      if (position == null) return { error: { code: 'position_not_found' } };
      if (args.withdrawAmountUsd >= position.collateralUsd) {
        return { error: { code: 'cannot_remove_all_collateral' } };
      }
      const withdrawTokenSymbol = args.withdrawTokenSymbol.trim().toUpperCase();
      const expectedUsdAmount = encodedAmountFromUi({
        amountUi: String(args.withdrawAmountUsd),
        decimals: 6,
        symbol: 'USD',
      });
      if (expectedUsdAmount == null) return { error: { code: 'invalid_amount' } };
      const marketAccounts = await client.getMarketExecutionAccounts(
        position.marketPubkey,
        context.signal,
      );
      const outputCustodyPubkey = custodyPubkeyForSymbol(marketAccounts, withdrawTokenSymbol);
      if (outputCustodyPubkey == null) {
        return { error: { code: 'withdraw_custody_unavailable' } };
      }

      const response = await client.removeCollateral(
        {
          marketSymbol: position.marketSymbol,
          side: position.side === 'long' ? 'LONG' : 'SHORT',
          withdrawAmountUsdUi: String(args.withdrawAmountUsd),
          withdrawTokenSymbol,
          owner: walletCheck.walletAddress,
          slippagePercentage: slippage.slippagePercentage,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/remove-collateral', response);
      const decoded = requireDecodedInstruction(built.transactionBase64, 'remove_collateral_er');
      if (
        decoded.accountPubkeys?.[8] !== outputCustodyPubkey ||
        decoded.usdAmountRaw !== expectedUsdAmount.rawAmount
      ) {
        throw new Error('Flash Trade remove-collateral builder changed the confirmed USD amount.');
      }
      if (args.withdrawAmountUsd > Number(built.maxWithdrawableUsd)) {
        return { error: { code: 'withdraw_amount_exceeds_maximum' } };
      }
      const newLiquidationPrice = Number(built.newLiquidationPrice);
      const liquidationDistancePercent =
        position.markPrice > 0
          ? Math.abs(((newLiquidationPrice - position.markPrice) / position.markPrice) * 100)
          : 0;
      const warnings =
        liquidationDistancePercent < 5
          ? ['Liquidation price is within 5% of the live mark price.']
          : liquidationDistancePercent < 10
            ? ['Liquidation price is within 10% of the live mark price.']
            : undefined;
      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'remove_collateral',
        actionLabel: 'Remove collateral',
        walletAddress: walletCheck.walletAddress,
        network: 'mainnet',
        positionKey: position.positionKey,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: Number(built.newLeverage),
        collateralUsd: Number(built.newCollateralUsd),
        inputTokenSymbol: withdrawTokenSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: newLiquidationPrice,
        sizeUsd: position.sizeUsd,
        entryFeeUsd: 0,
        amountUsd: Number(built.receiveAmountUsdUi),
        amountTokenSymbol: withdrawTokenSymbol,
        newLeverage: Number(built.newLeverage),
        newLiquidationPrice,
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'remove_collateral',
          side: position.side,
          market: expectedMarketAccounts(marketAccounts, position.side),
          outputCustodyPubkey,
          outputTokenSymbol: withdrawTokenSymbol,
          usdAmountRaw: expectedUsdAmount.rawAmount,
        },
        expectedMarketPubkeys: [position.marketPubkey],
        warnings,
      };
      return {
        result: {
          status: 'drafted',
          positionRef: positionRef(position),
          marketSymbol: position.marketSymbol,
          withdrawAmountUsd: Number(built.receiveAmountUsdUi),
          withdrawTokenSymbol: draft.amountTokenSymbol,
          previousLeverage: Number(built.existingLeverage),
          previousLiquidationPrice: Number(built.existingLiquidationPrice),
          newLeverage: Number(built.newLeverage),
          newLiquidationPrice,
          liquidationDistancePercent,
          warnings,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
