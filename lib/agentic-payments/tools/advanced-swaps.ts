import {
  getRpcAccounts,
  getSwapPrice,
  getSwapTokens,
  getWalletBalance,
  listRecurringSwaps,
  listSwapTriggerOrders,
} from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { SPL_TOKEN_PROGRAM_ID } from '@/lib/crypto/solana-token-accounts';
import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';
import type {
  AgenticAdvancedSwapAction,
  AgenticAdvancedSwapCancelAction,
} from '@/store/agenticChatStore';
import type { SwapRecurringOrderSummary, SwapTriggerOrderSummary } from '@/types/offpay-api';

import {
  buildTokenBalanceRaw,
  errorCodeFromUnknown,
  isNativeSolMint,
  isNetworkReady,
  rawAmountFitsBalance,
  readNumberArg,
  readStringArg,
  requireWalletAndNetwork,
  resolveSwapTokenReference,
} from './helpers';
import type { AgenticToolDefinition } from './types';

const MIN_SOL_RESERVE_LAMPORTS = 10_000_000n;
const TRIGGER_MINIMUM_USD = 10;
const RECURRING_MINIMUM_PER_ORDER_USD = 50;
const MAX_TRIGGER_EXPIRY_HOURS = 30 * 24;
const MAX_SLIPPAGE_BPS = 5_000;
const INTERVAL_SECONDS = {
  hourly: 60 * 60,
  daily: 24 * 60 * 60,
  weekly: 7 * 24 * 60 * 60,
  monthly: 30 * 24 * 60 * 60,
} as const;

type RecurringInterval = keyof typeof INTERVAL_SECONDS;

function parseExactAmount(
  value: string,
  decimals: number,
): { ok: true; amount: string; rawAmount: string } | { ok: false } {
  const amount = value.trim();
  const pattern =
    decimals === 0 ? /^(?:0|[1-9]\d*)$/ : new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(amount)) return { ok: false };
  const rawAmount = decimalInputToAtomicAmount(amount, decimals);
  if (rawAmount == null || BigInt(rawAmount) <= 0n || BigInt(rawAmount) > (1n << 64n) - 1n) {
    return { ok: false };
  }
  return { ok: true, amount, rawAmount };
}

function parseInteger(value: number | null, minimum: number, maximum: number): number | null {
  if (value == null || !Number.isInteger(value) || value < minimum || value > maximum) return null;
  return value;
}

function parseSlippage(value: number | null): number | null {
  return value == null ? 50 : parseInteger(value, 1, MAX_SLIPPAGE_BPS);
}

function parseRecurringInterval(value: string | null): RecurringInterval | null {
  const normalized = value?.trim().toLowerCase();
  return normalized != null && Object.hasOwn(INTERVAL_SECONDS, normalized)
    ? (normalized as RecurringInterval)
    : null;
}

function validateRecurringSchedule(interval: RecurringInterval, orderCount: number): boolean {
  return INTERVAL_SECONDS[interval] * orderCount <= 365 * 24 * 60 * 60;
}

function triggerAlreadyMet(params: {
  condition: 'above' | 'below';
  triggerPriceUsd: number;
  currentPriceUsd: number;
}): boolean {
  return params.condition === 'above'
    ? params.currentPriceUsd >= params.triggerPriceUsd
    : params.currentPriceUsd <= params.triggerPriceUsd;
}

function assertClassicTokenAccounts(records: Awaited<ReturnType<typeof getRpcAccounts>>): void {
  if (
    records.accounts.length !== 2 ||
    records.accounts.some((record) => record?.owner !== SPL_TOKEN_PROGRAM_ID)
  ) {
    throw new Error('Jupiter advanced orders do not support Token-2022 or unknown token mints.');
  }
}

function assertBalance(params: {
  action: Pick<
    AgenticAdvancedSwapAction,
    'walletAddress' | 'inputMint' | 'inputDecimals' | 'inputRawAmount'
  >;
  balance: Awaited<ReturnType<typeof getWalletBalance>>;
}): void {
  if (
    params.balance.address !== params.action.walletAddress ||
    params.balance.network !== 'mainnet'
  ) {
    throw new Error('Fresh wallet balance does not match this advanced swap draft.');
  }
  const balanceRaw = buildTokenBalanceRaw({
    balance: params.balance,
    mint: params.action.inputMint,
    decimals: params.action.inputDecimals,
  });
  if (!rawAmountFitsBalance(params.action.inputRawAmount, balanceRaw)) {
    throw new Error('The fresh input-token balance cannot cover this advanced swap.');
  }
  const solBalance = BigInt(String(params.balance.solBalance));
  const requiredSol = isNativeSolMint(params.action.inputMint)
    ? BigInt(params.action.inputRawAmount) + MIN_SOL_RESERVE_LAMPORTS
    : MIN_SOL_RESERVE_LAMPORTS;
  if (solBalance < requiredSol) {
    throw new Error('Keep at least 0.01 SOL available for transaction fees and account rent.');
  }
}

export async function revalidateAdvancedSwapAction(
  action: AgenticAdvancedSwapAction,
): Promise<void> {
  if (action.network !== 'mainnet') throw new Error('Advanced swaps are mainnet-only.');
  const parsed = parseExactAmount(action.inputAmount, action.inputDecimals);
  if (!parsed.ok || parsed.rawAmount !== action.inputRawAmount) {
    throw new Error('Advanced swap amount no longer matches its exact raw amount.');
  }

  const [tokens, balance, mintAccounts, inputPrice, triggerPrice] = await Promise.all([
    getSwapTokens('mainnet'),
    getWalletBalance(action.walletAddress, 'mainnet', {
      useCache: false,
      requestOwner: 'agent.advanced-swap.confirm.balance',
    }),
    getRpcAccounts({ addresses: [action.inputMint, action.outputMint], network: 'mainnet' }),
    getSwapPrice(action.inputMint, 'mainnet'),
    action.kind === 'swap_trigger'
      ? getSwapPrice(action.triggerMint, 'mainnet')
      : Promise.resolve(null),
  ]);
  const exactInput = tokens.tokens.find(
    (token) =>
      token.mint === action.inputMint &&
      token.symbol === action.inputSymbol &&
      token.decimals === action.inputDecimals &&
      token.verified,
  );
  const exactOutput = tokens.tokens.find(
    (token) =>
      token.mint === action.outputMint &&
      token.symbol === action.outputSymbol &&
      token.decimals === action.outputDecimals &&
      token.verified,
  );
  if (exactInput == null || exactOutput == null || exactInput.mint === exactOutput.mint) {
    throw new Error('The live verified token pair no longer matches this advanced swap draft.');
  }
  assertClassicTokenAccounts(mintAccounts);
  assertBalance({ action, balance });

  const inputValueUsd = Number(action.inputAmount) * inputPrice.price;
  if (!Number.isFinite(inputValueUsd) || inputValueUsd <= 0) {
    throw new Error('The live input-token value is unavailable.');
  }
  if (action.kind === 'swap_trigger') {
    if (action.expiresAt <= Date.now() + 60_000) {
      throw new Error('Trigger order expiry is too close. Prepare a fresh order.');
    }
    if (inputValueUsd < TRIGGER_MINIMUM_USD) {
      throw new Error('Jupiter Trigger requires at least $10 of input value.');
    }
    if (
      triggerPrice == null ||
      triggerAlreadyMet({
        condition: action.triggerCondition,
        triggerPriceUsd: action.triggerPriceUsd,
        currentPriceUsd: triggerPrice.price,
      })
    ) {
      throw new Error('The trigger condition is already met at the live market price.');
    }
  } else {
    if (`${action.interval}:${action.orderCount}` !== action.frequency) {
      throw new Error('Recurring schedule no longer matches the confirmed intent.');
    }
    if (!validateRecurringSchedule(action.interval, action.orderCount)) {
      throw new Error('Recurring schedule exceeds the one-year maximum.');
    }
    if (inputValueUsd / action.orderCount < RECURRING_MINIMUM_PER_ORDER_USD) {
      throw new Error('Jupiter Recurring requires at least $50 of input value per order.');
    }
  }
}

async function buildCommonDraft(
  call: Parameters<AgenticToolDefinition['run']>[0],
  context: Parameters<AgenticToolDefinition['run']>[1],
): Promise<
  | {
      ok: true;
      walletAddress: string;
      input: Awaited<ReturnType<typeof getSwapTokens>>['tokens'][number];
      output: Awaited<ReturnType<typeof getSwapTokens>>['tokens'][number];
      amount: { amount: string; rawAmount: string };
      inputValueUsd: number;
    }
  | { ok: false; code: string }
> {
  const scope = requireWalletAndNetwork({
    walletAddress: context.scope.walletAddress,
    network: context.scope.network,
  });
  if (!scope.ok) return { ok: false, code: scope.code };
  if (scope.network !== 'mainnet') return { ok: false, code: 'advanced_swap_mainnet_only' };
  if (!isNetworkReady(context)) return { ok: false, code: 'network_unavailable' };
  if (context.balance == null) return { ok: false, code: 'balance_loading' };
  if (context.balance.address !== scope.walletAddress || context.balance.network !== 'mainnet') {
    return { ok: false, code: 'wallet_balance_scope_mismatch' };
  }

  const inputReference = readStringArg(call, 'inputToken') ?? '';
  const outputReference = readStringArg(call, 'outputToken') ?? '';
  const amountText = readStringArg(call, 'amount') ?? '';
  if (inputReference.length === 0 || outputReference.length === 0) {
    return { ok: false, code: 'token_missing' };
  }

  const tokens = await getSwapTokens('mainnet', { signal: context.signal });
  const input = resolveSwapTokenReference({ tokens: tokens.tokens, value: inputReference });
  if (!input.ok) return { ok: false, code: input.code };
  const output = resolveSwapTokenReference({ tokens: tokens.tokens, value: outputReference });
  if (!output.ok) return { ok: false, code: output.code };
  if (input.token.mint === output.token.mint) return { ok: false, code: 'swap_same_token' };

  const amount = parseExactAmount(amountText, input.token.decimals);
  if (!amount.ok) return { ok: false, code: 'amount_invalid' };
  const [mintAccounts, inputPrice] = await Promise.all([
    getRpcAccounts({ addresses: [input.token.mint, output.token.mint], network: 'mainnet' }),
    getSwapPrice(input.token.mint, 'mainnet', { signal: context.signal }),
  ]);
  assertClassicTokenAccounts(mintAccounts);
  assertBalance({
    action: {
      walletAddress: scope.walletAddress,
      inputMint: input.token.mint,
      inputDecimals: input.token.decimals,
      inputRawAmount: amount.rawAmount,
    },
    balance: context.balance,
  });
  const inputValueUsd = Number(amount.amount) * inputPrice.price;
  if (!Number.isFinite(inputValueUsd) || inputValueUsd <= 0) {
    return { ok: false, code: 'input_price_unavailable' };
  }
  return {
    ok: true,
    walletAddress: scope.walletAddress,
    input: input.token,
    output: output.token,
    amount,
    inputValueUsd,
  };
}

function resolveOrderSymbol(
  tokens: Awaited<ReturnType<typeof getSwapTokens>>['tokens'],
  mint: string,
): string {
  return tokens.find((token) => token.mint === mint)?.symbol ?? 'Token';
}

async function findTriggerOrderForCancellation(
  orderId: string,
  page: number,
  signal?: AbortSignal,
): Promise<SwapTriggerOrderSummary | null> {
  for (const state of ['active', 'past'] as const) {
    const response = await listSwapTriggerOrders(
      {
        action: 'list',
        state,
        limit: 20,
        offset: (page - 1) * 20,
        network: 'mainnet',
      },
      { signal },
    );
    const match = response.orders.find((order) => order.id === orderId);
    if (match) return match;
  }
  return null;
}

async function findRecurringOrderForCancellation(
  orderId: string,
  page: number,
  signal?: AbortSignal,
): Promise<SwapRecurringOrderSummary | null> {
  const response = await listRecurringSwaps(
    {
      status: 'active',
      page,
      includeFailedTransactions: false,
      network: 'mainnet',
    },
    { signal },
  );
  return response.orders.find((order) => order.orderId === orderId) ?? null;
}

function readOrderPage(call: Parameters<AgenticToolDefinition['run']>[0]): number | null {
  const page = readNumberArg(call, 'page') ?? 1;
  return Number.isInteger(page) && page >= 1 && page <= 1000 ? page : null;
}

export const getAdvancedSwapOrdersTool: AgenticToolDefinition = {
  name: 'get_advanced_swap_orders',
  schema: {
    name: 'get_advanced_swap_orders',
    description:
      'List verified Jupiter Trigger or time-based Recurring orders for the active mainnet wallet, including exact order IDs and current status. Trigger listing requires an existing Jupiter authentication session.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['trigger', 'recurring'] },
        status: { type: 'string', enum: ['active', 'history'] },
        page: { type: 'number', description: 'One-based result page. Defaults to 1.' },
      },
      required: ['kind', 'status'],
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork(context.scope);
    if (!scope.ok || scope.network !== 'mainnet' || !isNetworkReady(context)) {
      return { error: { code: 'mainnet_wallet_required' } };
    }
    const kind = readStringArg(call, 'kind');
    const status = readStringArg(call, 'status');
    const page = readOrderPage(call);
    if (
      (kind !== 'trigger' && kind !== 'recurring') ||
      (status !== 'active' && status !== 'history') ||
      page == null
    ) {
      return { error: { code: 'advanced_order_filter_invalid' } };
    }
    const capability = kind === 'trigger' ? 'swap.tokens' : 'swap.recurringSwap';
    if (
      context.capabilities == null ||
      !isOffpayFeatureAvailable(context.capabilities, capability)
    ) {
      return { error: { code: 'feature_unavailable' } };
    }
    try {
      const [tokens, response] = await Promise.all([
        getSwapTokens('mainnet', { signal: context.signal }),
        kind === 'trigger'
          ? listSwapTriggerOrders(
              {
                action: 'list',
                state: status === 'active' ? 'active' : 'past',
                limit: 20,
                offset: (page - 1) * 20,
                network: 'mainnet',
              },
              { signal: context.signal },
            )
          : listRecurringSwaps(
              {
                status,
                page,
                includeFailedTransactions: false,
                network: 'mainnet',
              },
              { signal: context.signal },
            ),
      ]);
      const orders =
        kind === 'trigger'
          ? response.orders.map((order) => ({
              orderId: 'id' in order ? order.id : '',
              kind,
              status: 'orderState' in order ? order.orderState : 'unknown',
              inputSymbol: resolveOrderSymbol(tokens.tokens, order.inputMint),
              outputSymbol: resolveOrderSymbol(tokens.tokens, order.outputMint),
            }))
          : response.orders.map((order) => ({
              orderId: 'orderId' in order ? order.orderId : '',
              kind,
              status: 'userClosed' in order && order.userClosed ? 'closed' : 'active',
              inputSymbol: resolveOrderSymbol(tokens.tokens, order.inputMint),
              outputSymbol: resolveOrderSymbol(tokens.tokens, order.outputMint),
            }));
      const totalPages =
        'pagination' in response
          ? Math.max(1, Math.ceil(response.pagination.total / response.pagination.limit))
          : response.totalPages;
      return { result: { status: 'ok', kind, view: status, page, totalPages, orders } };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'advanced_order_list_failed') } };
    }
  },
};

export const prepareAdvancedSwapCancelTool: AgenticToolDefinition = {
  name: 'prepare_advanced_swap_cancel',
  schema: {
    name: 'prepare_advanced_swap_cancel',
    description:
      'Draft cancellation and fund recovery for one exact Jupiter Trigger or time-based Recurring order. This tool never creates, signs, or submits a transaction.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['trigger', 'recurring'] },
        orderId: { type: 'string', description: 'Exact order ID returned by order listing' },
        page: {
          type: 'number',
          description: 'One-based page that returned this order. Defaults to 1.',
        },
      },
      required: ['kind', 'orderId'],
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork(context.scope);
    if (!scope.ok || scope.network !== 'mainnet' || !isNetworkReady(context)) {
      return { error: { code: 'mainnet_wallet_required' } };
    }
    const kind = readStringArg(call, 'kind');
    const orderId = readStringArg(call, 'orderId')?.trim();
    const page = readOrderPage(call);
    if (
      (kind !== 'trigger' && kind !== 'recurring') ||
      !orderId ||
      orderId.length > 128 ||
      page == null
    ) {
      return { error: { code: 'advanced_order_id_invalid' } };
    }
    const capability = kind === 'trigger' ? 'swap.triggerOrders' : 'swap.recurringSwap';
    if (
      context.capabilities == null ||
      !isOffpayFeatureAvailable(context.capabilities, capability)
    ) {
      return { error: { code: 'feature_unavailable' } };
    }
    try {
      const [tokens, order] = await Promise.all([
        getSwapTokens('mainnet', { signal: context.signal }),
        kind === 'trigger'
          ? findTriggerOrderForCancellation(orderId, page, context.signal)
          : findRecurringOrderForCancellation(orderId, page, context.signal),
      ]);
      if (order == null) return { error: { code: 'advanced_order_not_found' } };
      const cancellable =
        kind === 'trigger'
          ? 'orderState' in order &&
            (order.orderState === 'open' ||
              order.orderState === 'expired' ||
              order.orderState === 'pending_withdraw')
          : 'userClosed' in order && !order.userClosed && order.closeSignature == null;
      if (!cancellable) return { error: { code: 'advanced_order_not_cancellable' } };
      const inputSymbol = resolveOrderSymbol(tokens.tokens, order.inputMint);
      const outputSymbol = resolveOrderSymbol(tokens.tokens, order.outputMint);
      const providerStatus = 'orderState' in order ? order.orderState : 'active';
      const warnings = [
        'Confirmation will create a fresh provider cancellation transaction, verify it, simulate it, and then request a wallet signature.',
        'Cancellation returns any recoverable remaining input and output funds to the active wallet.',
      ];
      const draft: Omit<
        AgenticAdvancedSwapCancelAction,
        'id' | 'kind' | 'status' | 'createdAt' | 'updatedAt'
      > = {
        walletAddress: scope.walletAddress,
        network: 'mainnet',
        orderId,
        inputMint: order.inputMint,
        outputMint: order.outputMint,
        inputSymbol,
        outputSymbol,
        providerStatus,
        warnings,
        signature: null,
        errorMessage: null,
      };
      return {
        result: {
          status: 'drafted',
          operation: 'cancel',
          kind,
          orderId,
          providerStatus,
          inputSymbol,
          outputSymbol,
          warnings,
        },
        draft: {
          kind: kind === 'trigger' ? 'swap_trigger_cancel' : 'swap_recurring_cancel',
          draft,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'advanced_order_cancel_failed') } };
    }
  },
};

export const prepareTriggerSwapTool: AgenticToolDefinition = {
  name: 'prepare_trigger_swap',
  schema: {
    name: 'prepare_trigger_swap',
    description:
      'Draft a real Jupiter Trigger V2 single price order for explicit local confirmation. No challenge, transaction signing, deposit, or order submission occurs in this tool.',
    parameters: {
      type: 'object',
      properties: {
        inputToken: { type: 'string', description: 'Verified token to deposit and sell' },
        outputToken: { type: 'string', description: 'Verified token to receive' },
        amount: { type: 'string', description: 'Exact total input-token amount' },
        triggerToken: {
          type: 'string',
          description: 'Which token in the pair should be monitored for its USD price',
        },
        triggerCondition: { type: 'string', enum: ['above', 'below'] },
        triggerPriceUsd: { type: 'number', description: 'Positive USD trigger price' },
        expiryHours: { type: 'number', description: 'Whole hours from now, between 1 and 720' },
        slippageBps: { type: 'number', description: 'Optional slippage, 1 through 5000 bps' },
      },
      required: [
        'inputToken',
        'outputToken',
        'amount',
        'triggerToken',
        'triggerCondition',
        'triggerPriceUsd',
        'expiryHours',
      ],
    },
  },
  run: async (call, context) => {
    if (
      context.capabilities == null ||
      !isOffpayFeatureAvailable(context.capabilities, 'swap.tokens') ||
      !isOffpayFeatureAvailable(context.capabilities, 'swap.triggerOrders')
    ) {
      return { error: { code: 'feature_unavailable' } };
    }
    try {
      const common = await buildCommonDraft(call, context);
      if (!common.ok) return { error: { code: common.code } };
      if (common.inputValueUsd < TRIGGER_MINIMUM_USD) {
        return { error: { code: 'trigger_minimum_not_met' } };
      }

      const triggerReference = readStringArg(call, 'triggerToken') ?? '';
      const trigger = [common.input, common.output].filter(
        (token) =>
          token.mint === triggerReference ||
          token.symbol.toUpperCase() === triggerReference.toUpperCase() ||
          token.name.toUpperCase() === triggerReference.toUpperCase(),
      );
      if (trigger.length !== 1) return { error: { code: 'trigger_token_must_match_pair' } };
      const condition = readStringArg(call, 'triggerCondition');
      if (condition !== 'above' && condition !== 'below') {
        return { error: { code: 'trigger_condition_invalid' } };
      }
      const triggerPriceUsd = readNumberArg(call, 'triggerPriceUsd');
      if (triggerPriceUsd == null || triggerPriceUsd <= 0) {
        return { error: { code: 'trigger_price_invalid' } };
      }
      const expiryHours = parseInteger(
        readNumberArg(call, 'expiryHours'),
        1,
        MAX_TRIGGER_EXPIRY_HOURS,
      );
      if (expiryHours == null) return { error: { code: 'trigger_expiry_invalid' } };
      const slippageBps = parseSlippage(readNumberArg(call, 'slippageBps'));
      if (slippageBps == null) return { error: { code: 'slippage_invalid' } };
      const referencePrice = await getSwapPrice(trigger[0]!.mint, 'mainnet', {
        signal: context.signal,
      });
      if (
        triggerAlreadyMet({
          condition,
          triggerPriceUsd,
          currentPriceUsd: referencePrice.price,
        })
      ) {
        return { error: { code: 'trigger_condition_already_met' } };
      }

      const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;
      const warnings = [
        'Confirming deposits real mainnet funds into a Jupiter Trigger vault.',
        'This draft is available only when the backend reports a fully verified cancel-and-withdraw lifecycle.',
      ];
      return {
        result: {
          status: 'drafted',
          mode: 'trigger',
          inputAmount: common.amount.amount,
          inputSymbol: common.input.symbol,
          outputSymbol: common.output.symbol,
          triggerSymbol: trigger[0]!.symbol,
          triggerCondition: condition,
          triggerPriceUsd,
          referencePriceUsd: referencePrice.price,
          slippageBps,
          expiresAt,
          warnings,
        },
        draft: {
          kind: 'swap_trigger',
          draft: {
            walletAddress: common.walletAddress,
            network: 'mainnet',
            inputMint: common.input.mint,
            inputSymbol: common.input.symbol,
            inputName: common.input.name,
            inputDecimals: common.input.decimals,
            inputAmount: common.amount.amount,
            inputRawAmount: common.amount.rawAmount,
            inputValueUsd: common.inputValueUsd,
            outputMint: common.output.mint,
            outputSymbol: common.output.symbol,
            outputName: common.output.name,
            outputDecimals: common.output.decimals,
            triggerMint: trigger[0]!.mint,
            triggerSymbol: trigger[0]!.symbol,
            triggerCondition: condition,
            triggerPriceUsd,
            referencePriceUsd: referencePrice.price,
            slippageBps,
            expiresAt,
            warnings,
            signature: null,
            providerOrderId: null,
            errorMessage: null,
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'trigger_draft_failed') } };
    }
  },
};

export const prepareRecurringSwapTool: AgenticToolDefinition = {
  name: 'prepare_recurring_swap',
  schema: {
    name: 'prepare_recurring_swap',
    description:
      'Draft a real Jupiter time-based Recurring order for explicit local confirmation. Amount is the total mainnet deposit split across all orders; no transaction is created or signed in this tool.',
    parameters: {
      type: 'object',
      properties: {
        inputToken: { type: 'string', description: 'Verified classic SPL token to deposit' },
        outputToken: { type: 'string', description: 'Verified classic SPL token to receive' },
        amount: { type: 'string', description: 'Exact total input-token deposit amount' },
        interval: { type: 'string', enum: ['hourly', 'daily', 'weekly', 'monthly'] },
        orderCount: { type: 'number', description: 'Whole number of orders, at least 2' },
      },
      required: ['inputToken', 'outputToken', 'amount', 'interval', 'orderCount'],
    },
  },
  run: async (call, context) => {
    if (
      context.capabilities == null ||
      !isOffpayFeatureAvailable(context.capabilities, 'swap.tokens') ||
      !isOffpayFeatureAvailable(context.capabilities, 'swap.recurringSwap')
    ) {
      return { error: { code: 'feature_unavailable' } };
    }
    try {
      const common = await buildCommonDraft(call, context);
      if (!common.ok) return { error: { code: common.code } };
      const interval = parseRecurringInterval(readStringArg(call, 'interval'));
      if (interval == null) return { error: { code: 'recurring_interval_invalid' } };
      const maximumOrders = Math.floor((365 * 24 * 60 * 60) / INTERVAL_SECONDS[interval]);
      const orderCount = parseInteger(readNumberArg(call, 'orderCount'), 2, maximumOrders);
      if (orderCount == null || !validateRecurringSchedule(interval, orderCount)) {
        return { error: { code: 'recurring_order_count_invalid' } };
      }
      const perOrderValueUsd = common.inputValueUsd / orderCount;
      if (perOrderValueUsd < RECURRING_MINIMUM_PER_ORDER_USD) {
        return { error: { code: 'recurring_minimum_not_met' } };
      }
      const frequency = `${interval}:${orderCount}`;
      const warnings = [
        `The ${common.amount.amount} ${common.input.symbol} amount is the total deposit, split across ${orderCount} orders.`,
        'OffPay can close the active schedule and recover remaining funds through a separate signed confirmation.',
      ];
      return {
        result: {
          status: 'drafted',
          mode: 'recurring',
          inputAmount: common.amount.amount,
          inputSymbol: common.input.symbol,
          outputSymbol: common.output.symbol,
          interval,
          orderCount,
          perOrderValueUsd,
          warnings,
        },
        draft: {
          kind: 'swap_recurring',
          draft: {
            walletAddress: common.walletAddress,
            network: 'mainnet',
            inputMint: common.input.mint,
            inputSymbol: common.input.symbol,
            inputName: common.input.name,
            inputDecimals: common.input.decimals,
            inputAmount: common.amount.amount,
            inputRawAmount: common.amount.rawAmount,
            inputValueUsd: common.inputValueUsd,
            outputMint: common.output.mint,
            outputSymbol: common.output.symbol,
            outputName: common.output.name,
            outputDecimals: common.output.decimals,
            interval,
            orderCount,
            frequency,
            perOrderValueUsd,
            warnings,
            signature: null,
            providerOrderId: null,
            errorMessage: null,
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'recurring_draft_failed') } };
    }
  },
};
