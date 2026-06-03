import { createSwapQuote, getSwapTokens } from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';

import {
  buildTokenBalanceRaw,
  errorCodeFromUnknown,
  formatRawAmount,
  hydrateStringArg,
  isNetworkReady,
  parsePositiveAtomicAmount,
  rawAmountFitsBalance,
  readNumberArg,
  readStringArg,
  requireWalletAndNetwork,
  resolveSwapTokenReference,
} from './helpers';
import type { AgenticToolDefinition } from './types';

function readTokenArg(call: Parameters<AgenticToolDefinition['run']>[0], keys: string[]): string {
  for (const key of keys) {
    const value = readStringArg(call, key);
    if (value != null && value.length > 0) return value;
  }
  return '';
}

function readSwapRoute(
  call: Parameters<AgenticToolDefinition['run']>[0],
): 'normal' | 'unsupported' {
  const raw = readStringArg(call, 'route')?.toLowerCase();
  if (raw == null || raw === '' || raw === 'normal' || raw === 'auto') return 'normal';
  return 'unsupported';
}

function readSlippageBps(
  call: Parameters<AgenticToolDefinition['run']>[0],
): { ok: true; slippageBps: number | undefined; manual: boolean } | { ok: false; code: string } {
  const value = readNumberArg(call, 'slippageBps');
  if (value == null) return { ok: true, slippageBps: undefined, manual: false };
  const slippageBps = Math.trunc(value);
  if (slippageBps < 1 || slippageBps > 5000) return { ok: false, code: 'slippage_invalid' };
  return { ok: true, slippageBps, manual: true };
}

export const prepareSwapQuoteTool: AgenticToolDefinition = {
  name: 'prepare_swap_quote',
  schema: {
    name: 'prepare_swap_quote',
    description:
      'Prepares a normal swap quote for explicit user confirmation. Stores unsigned transaction locally and returns only a sanitized quote summary. Route can be normal/auto; unsupported private routes return route_unavailable.',
    parameters: {
      type: 'object',
      properties: {
        inputToken: {
          type: 'string',
          description: 'Token to pay, by symbol/name or mint placeholder.',
        },
        outputToken: {
          type: 'string',
          description: 'Token to receive, by symbol/name or mint placeholder.',
        },
        amount: { type: 'string', description: 'Human token amount to swap from input token.' },
        route: {
          type: 'string',
          enum: ['normal', 'auto', 'privacy', 'magicblock', 'umbra'],
          description:
            'Swap route. normal/auto are supported in chat; private routes are reported unavailable.',
        },
        slippageBps: { type: 'number', description: 'Optional manual slippage in basis points.' },
      },
      required: ['inputToken', 'outputToken', 'amount'],
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (
      !isOffpayFeatureAvailable(context.capabilities, 'swap.tokens') ||
      !isOffpayFeatureAvailable(context.capabilities, 'swap.normalSwap')
    ) {
      return { error: { code: 'feature_unavailable' } };
    }
    if (readSwapRoute(call) !== 'normal') return { error: { code: 'route_unavailable' } };

    const inputTokenText = hydrateStringArg(
      {
        ...call,
        args: { token: readTokenArg(call, ['inputToken', 'fromToken', 'payToken', 'token']) },
      },
      'token',
      context.redactions,
    );
    const outputTokenText = hydrateStringArg(
      { ...call, args: { token: readTokenArg(call, ['outputToken', 'toToken', 'receiveToken']) } },
      'token',
      context.redactions,
    );
    const amountText = hydrateStringArg(call, 'amount', context.redactions);
    if (inputTokenText.length === 0 || outputTokenText.length === 0) {
      return { error: { code: 'token_missing' } };
    }

    const slippage = readSlippageBps(call);
    if (!slippage.ok) return { error: { code: slippage.code } };

    try {
      const tokens = await getSwapTokens(scope.network, { signal: context.signal });
      const input = resolveSwapTokenReference({ tokens: tokens.tokens, value: inputTokenText });
      if (!input.ok) return { error: { code: input.code } };
      const output = resolveSwapTokenReference({ tokens: tokens.tokens, value: outputTokenText });
      if (!output.ok) return { error: { code: output.code } };
      if (input.token.mint === output.token.mint) return { error: { code: 'swap_same_token' } };

      const amount = parsePositiveAtomicAmount({
        amount: amountText,
        decimals: input.token.decimals,
      });
      if (!amount.ok) return { error: { code: amount.code } };

      if (context.balance == null) return { result: { status: 'loading' } };
      const balanceRaw = buildTokenBalanceRaw({
        balance: context.balance,
        mint: input.token.mint,
        decimals: input.token.decimals,
      });
      if (balanceRaw == null) return { error: { code: 'token_not_in_wallet' } };
      if (!rawAmountFitsBalance(amount.rawAmount, balanceRaw)) {
        return { error: { code: 'amount_exceeds_balance' } };
      }

      const quote = await createSwapQuote(
        {
          inputMint: input.token.mint,
          outputMint: output.token.mint,
          amount: amount.rawAmount,
          network: scope.network,
          receiverAddress: scope.walletAddress,
          ...(slippage.slippageBps == null
            ? {}
            : { slippageBps: slippage.slippageBps, useManualSlippage: slippage.manual }),
        },
        { signal: context.signal },
      );
      if (quote.unsignedTransaction.trim().length === 0) {
        return { error: { code: 'quote_invalid' } };
      }

      const outputAmount = formatRawAmount(quote.outAmount, output.token.decimals);
      return {
        result: {
          status: 'drafted',
          route: 'normal',
          inputAmount: amount.amount,
          inputSymbol: input.token.symbol,
          outputAmount,
          outputSymbol: output.token.symbol,
          priceImpactPct: quote.priceImpactPct,
          fee: quote.fee,
          slippageBps: quote.slippageBps ?? null,
          slippageMode: quote.slippageMode ?? null,
          expiresAt: quote.expiresAt,
        },
        draft: {
          kind: 'swap',
          route: 'normal',
          draft: {
            walletAddress: scope.walletAddress,
            network: scope.network,
            inputMint: input.token.mint,
            inputSymbol: input.token.symbol,
            inputName: input.token.name,
            inputDecimals: input.token.decimals,
            inputAmount: amount.amount,
            inputRawAmount: amount.rawAmount,
            outputMint: output.token.mint,
            outputSymbol: output.token.symbol,
            outputName: output.token.name,
            outputDecimals: output.token.decimals,
            outputAmount,
            outputRawAmount: quote.outAmount,
            slippageBps: quote.slippageBps ?? null,
            slippageMode: quote.slippageMode ?? null,
            priceImpactPct: quote.priceImpactPct,
            fee: quote.fee,
            routeSummary: quote.routeSummary,
            quoteId: quote.quoteId,
            unsignedTransaction: quote.unsignedTransaction,
            expiresAt: quote.expiresAt,
            signature: null,
            errorMessage: null,
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'swap_quote_failed') } };
    }
  },
};
