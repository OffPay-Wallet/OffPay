import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import {
  custodyPubkeyForSymbol,
  encodedAmountFromDecoded,
  errorCodeFromUnknown,
  expectedMarketAccounts,
  isPositiveFinite,
  requireDecodedInstruction,
  requireMainnet,
  requireWallet,
  resolvePositionReference,
  sortedPositions,
  positionRef,
  validateSlippageBps,
} from './helpers';
import type { FlashTradeDraft } from './types';

const FULL_CLOSE_THRESHOLD = 0.97;

export const flashClosePositionTool: AgenticToolDefinition = {
  name: 'flash_close_position',
  schema: {
    name: 'flash_close_position',
    description:
      'Build a real Flash Trade V2 mainnet full or partial close transaction for an opaque position reference returned by flash_get_positions.',
    parameters: {
      type: 'object',
      properties: {
        positionRef: {
          type: 'string',
          description: 'Opaque position_ref_N returned by flash_get_positions',
        },
        closeAmountUsd: {
          type: 'number',
          description:
            'USD notional to close. Omit for a full close; at least 97% is a full close on-chain.',
        },
        withdrawTokenSymbol: { type: 'string', description: 'Settlement token symbol' },
        slippageBps: {
          type: 'number',
          description: 'Slippage in basis points, from 1 through 500; default 50',
        },
      },
      required: ['positionRef', 'withdrawTokenSymbol'],
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
      closeAmountUsd?: number;
      withdrawTokenSymbol: string;
      slippageBps?: number;
    };
    if (typeof args.positionRef !== 'string' || args.positionRef.length === 0) {
      return { error: { code: 'position_ref_required' } };
    }
    if (args.closeAmountUsd != null && !isPositiveFinite(args.closeAmountUsd)) {
      return { error: { code: 'invalid_close_amount' } };
    }
    const slippage = validateSlippageBps(args.slippageBps);
    if (!slippage.ok) return { error: { code: slippage.code } };

    try {
      const client = getFlashTradeClient();
      const [ownerPositions, tokens] = await Promise.all([
        client.getOwnerPositions(walletCheck.walletAddress, context.signal),
        client.getTokens(context.signal),
      ]);
      const positions = sortedPositions(ownerPositions);
      const position = resolvePositionReference(positions, args.positionRef);
      if (position == null) return { error: { code: 'position_not_found' } };
      if (args.closeAmountUsd != null && args.closeAmountUsd > position.sizeUsd) {
        return { error: { code: 'close_amount_exceeds_position' } };
      }

      const isFullClose =
        args.closeAmountUsd == null ||
        args.closeAmountUsd >= position.sizeUsd * FULL_CLOSE_THRESHOLD;
      const withdrawTokenSymbol = args.withdrawTokenSymbol.trim().toUpperCase();
      const marketToken = tokens.find(
        (token) => token.symbol.toUpperCase() === position.marketSymbol.toUpperCase(),
      );
      if (marketToken == null) return { error: { code: 'market_token_unavailable' } };
      const marketAccounts = await client.getMarketExecutionAccounts(
        position.marketPubkey,
        context.signal,
      );
      const outputCustodyPubkey = custodyPubkeyForSymbol(marketAccounts, withdrawTokenSymbol);
      if (outputCustodyPubkey == null) {
        return { error: { code: 'withdraw_custody_unavailable' } };
      }
      const response = await client.closePosition(
        {
          marketSymbol: position.marketSymbol,
          side: position.side === 'long' ? 'LONG' : 'SHORT',
          inputUsdUi: isFullClose ? '0' : String(args.closeAmountUsd),
          withdrawTokenSymbol,
          owner: walletCheck.walletAddress,
          slippagePercentage: slippage.slippagePercentage,
        },
        context.signal,
      );
      const built = client.requireTransaction('/transaction-builder/close-position', response);
      if (built.receiveTokenSymbol.trim().toUpperCase() !== withdrawTokenSymbol) {
        throw new Error('Flash Trade close builder changed the confirmed settlement token.');
      }
      const decodedName = isFullClose ? 'close_position_er' : 'decrease_position_size_er';
      const decoded = requireDecodedInstruction(built.transactionBase64, decodedName);
      const outputCustodyIndex = isFullClose ? 9 : 8;
      if (
        decoded.executionPrice == null ||
        decoded.privilege !== 'none' ||
        decoded.accountPubkeys?.[outputCustodyIndex] !== outputCustodyPubkey
      ) {
        throw new Error(
          'Flash Trade close builder changed its execution price, settlement custody, or privilege.',
        );
      }
      const encodedCloseSize = isFullClose
        ? null
        : encodedAmountFromDecoded({
            rawAmount: decoded.sizeRawAmount,
            decimals: marketToken.decimals,
            symbol: marketToken.symbol,
          });
      const closeAmountUsd = isFullClose ? position.sizeUsd : args.closeAmountUsd!;
      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'close_position',
        actionLabel: isFullClose ? 'Close position' : 'Partial close',
        walletAddress: walletCheck.walletAddress,
        network: 'mainnet',
        positionKey: position.positionKey,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: position.leverage,
        collateralUsd: position.collateralUsd,
        inputTokenSymbol: withdrawTokenSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: Number(built.newLiquidationPrice),
        sizeUsd: closeAmountUsd,
        entryFeeUsd: 0,
        amountUsd: closeAmountUsd,
        amountTokenSymbol: built.receiveTokenSymbol,
        exitPrice: Number(built.markPrice),
        feesUsd: Number(built.fees),
        realizedPnlUsd: Number(built.settledPnl),
        transactionBase64: built.transactionBase64,
        expiresAt: null,
        economicIntent: {
          operation: 'close_position',
          side: position.side,
          closeMode: isFullClose ? 'full' : 'partial',
          market: expectedMarketAccounts(marketAccounts, position.side),
          outputCustodyPubkey,
          outputTokenSymbol: withdrawTokenSymbol,
          size: encodedCloseSize,
          executionPriceLimit: decoded.executionPrice,
          privilege: 'none',
          cleanupTriggerOrders: isFullClose && position.triggerOrderCount > 0,
        },
        expectedMarketPubkeys: [position.marketPubkey],
        warnings:
          isFullClose && position.triggerOrderCount > 0
            ? ['A full close removes the position and its remaining trigger orders.']
            : undefined,
      };
      return {
        result: {
          status: 'drafted',
          positionRef: positionRef(position),
          marketSymbol: position.marketSymbol,
          side: position.side,
          closeAmountUsd,
          isFullClose,
          exitPrice: draft.exitPrice,
          feesUsd: draft.feesUsd,
          realizedPnlUsd: draft.realizedPnlUsd,
          receiveTokenSymbol: built.receiveTokenSymbol,
          receiveTokenAmountUi: Number(built.receiveTokenAmountUi),
          triggerOrdersWillCancel: isFullClose && position.triggerOrderCount > 0,
        },
        draft: { kind: 'flash_position', draft },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
