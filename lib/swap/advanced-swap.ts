import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  broadcastRawTransaction,
  confirmSwapTriggerCancellation,
  createRecurringSwap,
  createSwapTriggerOrder,
  executeRecurringSwap,
  finalizePrivacySwapEnvelope,
  OffpayApiError,
  listRecurringSwaps,
  listSwapTriggerOrders,
  preparePrivacySwapEnvelope,
  prepareSwapTriggerOrder,
  prepareRecurringSwapCancellation,
  prepareSwapTriggerCancellation,
  refreshPrivacySwapQuote,
  requestSwapTriggerChallenge,
  simulateRawTransaction,
  verifySwapTriggerAuth,
} from '@/lib/api/offpay-api-client';
import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
import { runCryptoTask } from '@/lib/crypto/crypto-scheduler';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { SPL_TOKEN_PROGRAM_ID } from '@/lib/crypto/solana-token-accounts';
import {
  getRequiredSignersForSerializedTransaction,
  signMessageForWallet,
  signSerializedTransactionForWallet,
  signSerializedTransactionWithSeed,
} from '@/lib/crypto/solana-transaction-signing';

import type {
  OffpayNetwork,
  PreparedTransaction,
  PrivacySwapFinalizeResponse,
  RpcAccountsResponse,
  SwapTriggerCondition,
  SwapTriggerCreateResponse,
  SwapRecurringListResponse,
  SwapTriggerListResponse,
  SwapTriggerOrderType,
} from '@/types/offpay-api';

interface ActiveWalletSigner {
  walletAddress: string;
  walletId?: string | null;
}

interface EphemeralExecutorSigner {
  walletAddress: string;
  signingSeed: Uint8Array;
}

export interface CreateTriggerOrderParams {
  walletAddress: string;
  walletId?: string | null;
  inputMint: string;
  outputMint: string;
  amount: string;
  orderType: SwapTriggerOrderType;
  triggerMint?: string;
  triggerCondition?: SwapTriggerCondition;
  triggerPriceUsd?: number;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  slippageBps?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
  expiresAt: number;
  network: OffpayNetwork;
}

export interface CreateRecurringSwapParams {
  walletAddress: string;
  walletId?: string | null;
  inputMint: string;
  outputMint: string;
  amount: string;
  frequency: string;
  idempotencyKey: string;
  network: OffpayNetwork;
}

export interface ExecutePrivacyEnvelopeSwapParams {
  walletAddress: string;
  walletId?: string | null;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  fundingMemo?: string;
  settlementMemo?: string;
  network: OffpayNetwork;
}

export interface TriggerOrderResult extends SwapTriggerCreateResponse {
  authExpiresAt: number;
  depositRequestId: string;
  receiverAddress: string | null;
}

export interface RecurringSwapResult {
  recurringId: string;
  status: 'Success' | 'Failed';
  signature: string;
  orderId: string;
}

export interface CancelTriggerOrderParams {
  walletAddress: string;
  walletId?: string | null;
  orderId: string;
  network: OffpayNetwork;
}

export interface CancelRecurringSwapParams {
  walletAddress: string;
  walletId?: string | null;
  orderId: string;
  inputMint: string;
  outputMint: string;
  network: OffpayNetwork;
}

export interface RecurringOperationIdentity {
  fingerprint: string;
  idempotencyKey: string;
}

export function buildRecurringOperationFingerprint(params: {
  walletAddress: string;
  network: OffpayNetwork;
  inputMint: string;
  outputMint: string;
  amount: string;
  frequency: string;
}): string {
  return JSON.stringify([
    params.walletAddress.trim(),
    params.network,
    params.inputMint.trim(),
    params.outputMint.trim(),
    params.amount.trim(),
    params.frequency.trim(),
  ]);
}

export function resolveRecurringOperationIdentity(params: {
  existing: RecurringOperationIdentity | null;
  fingerprint: string;
  createKey: () => string;
}): RecurringOperationIdentity {
  return params.existing?.fingerprint === params.fingerprint
    ? params.existing
    : { fingerprint: params.fingerprint, idempotencyKey: params.createKey() };
}

export function areClassicSplMintAccounts(response: RpcAccountsResponse): boolean {
  return (
    response.accounts.length === 2 &&
    response.accounts.every((account) => account?.owner === SPL_TOKEN_PROGRAM_ID)
  );
}

export interface TriggerCancellationResult {
  orderId: string;
  status: 'cancelled';
  signature: string;
}

export interface RecurringCancellationResult {
  recurringId: string;
  orderId: string;
  status: 'Success';
  signature: string;
}

export interface PrivacyEnvelopeSwapResult {
  sessionId: string;
  validator: string;
  executorWallet: string;
  initializationSignatures: string[];
  fundingSignature: string;
  swapSignature: string;
  settlementSignature: string;
  outputMint: string;
  settledAmount: string;
}

function assertAddress(value: string, label: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new Error(`${label} must be a valid Solana address.`);
  }
}

function assertRawAmount(value: string): void {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim() || '0') <= 0n) {
    throw new Error('Swap amount must be a raw integer greater than zero.');
  }
}

function assertCommonSwapInputs(params: {
  walletAddress: string;
  inputMint: string;
  outputMint: string;
  amount: string;
}): void {
  assertAddress(params.walletAddress, 'Active wallet');
  assertAddress(params.inputMint, 'Input mint');
  assertAddress(params.outputMint, 'Output mint');
  if (params.inputMint === params.outputMint) {
    throw new Error('Input and output mints must be different.');
  }
  assertRawAmount(params.amount);
}

function assertFutureExpiry(expiresAt: number): void {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Trigger order expiry must be in the future.');
  }
}

function assertMainnet(network: OffpayNetwork): void {
  if (network !== 'mainnet') throw new Error('Advanced order lifecycle is mainnet-only.');
}

function assertOrderId(orderId: string, label: string): void {
  if (orderId.trim().length === 0 || orderId.length > 128) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertTriggerOrderFields(params: CreateTriggerOrderParams): void {
  assertFutureExpiry(params.expiresAt);

  if (params.orderType === 'single' || params.orderType === 'otoco') {
    if (params.triggerCondition == null || params.triggerPriceUsd == null) {
      throw new Error('Trigger condition and trigger price are required.');
    }
  }

  if (params.orderType === 'oco' || params.orderType === 'otoco') {
    if (params.tpPriceUsd == null || params.slPriceUsd == null) {
      throw new Error('Take-profit and stop-loss prices are required.');
    }
    if (params.tpPriceUsd <= params.slPriceUsd) {
      throw new Error('Take-profit price must be greater than stop-loss price.');
    }
  }
}

function assertRecurringFrequency(frequency: string): void {
  const normalized = frequency.trim();
  const valid =
    /^(hourly|daily|weekly|monthly):[1-9]\d*$/.test(normalized) ||
    /^interval:[1-9]\d*:[1-9]\d*$/.test(normalized);

  if (!valid) {
    throw new Error(
      'Frequency must match hourly:n, daily:n, weekly:n, monthly:n, or interval:seconds:n.',
    );
  }
}

function createEphemeralExecutorSigner(): EphemeralExecutorSigner {
  const signingSeed = new Uint8Array(32);
  crypto.getRandomValues(signingSeed);
  const publicKey = ed25519.getPublicKey(signingSeed);

  try {
    return {
      walletAddress: bs58.encode(publicKey),
      signingSeed,
    };
  } finally {
    zeroOutBytes(publicKey);
  }
}

function disposeExecutorSigner(executor: EphemeralExecutorSigner): void {
  zeroOutBytes(executor.signingSeed);
}

async function signWithAvailableSigners(params: {
  transactionBase64: string;
  activeWallet: ActiveWalletSigner;
  executor?: EphemeralExecutorSigner;
  label: string;
}): Promise<string> {
  const requiredSigners = getRequiredSignersForSerializedTransaction(params.transactionBase64);
  let signedTransaction = params.transactionBase64;

  if (requiredSigners.includes(params.activeWallet.walletAddress)) {
    signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: signedTransaction,
      walletAddress: params.activeWallet.walletAddress,
      walletId: params.activeWallet.walletId,
    });
  }

  if (params.executor != null && requiredSigners.includes(params.executor.walletAddress)) {
    signedTransaction = await runCryptoTask(
      'advancedSwap.signWithSeed',
      () =>
        signSerializedTransactionWithSeed({
          unsignedTransaction: signedTransaction,
          walletAddress: params.executor!.walletAddress,
          signingSeed: params.executor!.signingSeed,
          transactionLabel: params.label,
        }),
      { label: params.label },
    );
  }

  const supportedSigners = new Set([
    params.activeWallet.walletAddress,
    params.executor?.walletAddress,
  ]);
  const missingSigners = requiredSigners.filter((signer) => !supportedSigners.has(signer));
  if (missingSigners.length > 0) {
    throw new Error(`${params.label} requires an unsupported signer.`);
  }

  return signedTransaction;
}

function getSwapStageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown swap transaction error.';
}

async function assertAdvancedSwapSimulation(params: {
  transactionBase64: string;
  network: OffpayNetwork;
  label: string;
}): Promise<void> {
  const simulation = await simulateRawTransaction({
    transactionBase64: params.transactionBase64,
    network: params.network,
  });
  if (!simulation.success) {
    throw new Error(
      `${params.label} preflight failed: ${simulation.error ?? 'transaction simulation failed'}`,
    );
  }
}

async function signAndBroadcastPreparedTransaction(params: {
  transaction: PreparedTransaction;
  activeWallet: ActiveWalletSigner;
  executor?: EphemeralExecutorSigner;
  network: OffpayNetwork;
  label: string;
}): Promise<string> {
  let signedTransaction: string;
  try {
    signedTransaction = await signWithAvailableSigners({
      transactionBase64: params.transaction.transactionBase64,
      activeWallet: params.activeWallet,
      executor: params.executor,
      label: params.label,
    });
  } catch (error) {
    throw new Error(`${params.label} signing failed: ${getSwapStageErrorMessage(error)}`);
  }

  let result: Awaited<ReturnType<typeof broadcastRawTransaction>>;
  try {
    result = await broadcastRawTransaction({
      rawTransaction: signedTransaction,
      network: params.network,
    });
  } catch (error) {
    throw new Error(`${params.label} broadcast failed: ${getSwapStageErrorMessage(error)}`);
  }

  return result.signature;
}

function isQuoteExpiredError(error: unknown): boolean {
  return error instanceof OffpayApiError && error.code === 'QUOTE_EXPIRED';
}

function isFinalizeInProgressError(error: unknown): boolean {
  return (
    error instanceof OffpayApiError &&
    error.code === 'INVALID_REQUEST' &&
    /in[- ]progress|already processing|try again/i.test(error.message)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function authenticateTriggerOrderSession(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
}): Promise<number> {
  assertAddress(params.walletAddress, 'Active wallet');
  assertMainnet(params.network);
  const challenge = await requestSwapTriggerChallenge({
    action: 'auth_challenge',
    challengeType: 'message',
    network: params.network,
  });
  if (challenge.challengeType !== 'message' || challenge.challenge == null) {
    throw new Error('Trigger authentication did not return the requested message challenge.');
  }
  const signature = await signMessageForWallet({
    message: challenge.challenge,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  const verified = await verifySwapTriggerAuth({
    action: 'auth_verify',
    challengeType: 'message',
    signature,
    network: params.network,
  });
  return verified.expiresAt;
}

export async function createTriggerOrder(
  params: CreateTriggerOrderParams,
): Promise<TriggerOrderResult> {
  assertCommonSwapInputs(params);
  assertTriggerOrderFields(params);
  const authExpiresAt = await authenticateTriggerOrderSession({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
    network: params.network,
  });

  const prepared = await prepareSwapTriggerOrder({
    action: 'prepare',
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    orderSubType: params.orderType,
    network: params.network,
  });
  await assertAdvancedSwapSimulation({
    transactionBase64: prepared.unsignedTransaction,
    network: params.network,
    label: 'Trigger deposit',
  });
  const depositSignedTransaction = await signSerializedTransactionForWallet({
    unsignedTransaction: prepared.unsignedTransaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  const created = await createSwapTriggerOrder({
    action: 'create',
    orderType: params.orderType,
    depositRequestId: prepared.depositRequestId,
    depositSignedTransaction,
    inputMint: params.inputMint,
    inputAmount: params.amount,
    outputMint: params.outputMint,
    triggerMint: params.triggerMint ?? params.outputMint,
    expiresAt: params.expiresAt,
    triggerCondition: params.triggerCondition,
    triggerPriceUsd: params.triggerPriceUsd,
    slippageBps: params.slippageBps,
    tpPriceUsd: params.tpPriceUsd,
    slPriceUsd: params.slPriceUsd,
    tpSlippageBps: params.tpSlippageBps,
    slSlippageBps: params.slSlippageBps,
    network: params.network,
  });

  return {
    ...created,
    authExpiresAt,
    depositRequestId: prepared.depositRequestId,
    receiverAddress: prepared.receiverAddress,
  };
}

export async function createAndExecuteRecurringSwap(
  params: CreateRecurringSwapParams,
): Promise<RecurringSwapResult> {
  assertCommonSwapInputs(params);
  assertRecurringFrequency(params.frequency);

  const created = await createRecurringSwap({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    frequency: params.frequency.trim(),
    idempotencyKey: params.idempotencyKey,
    network: params.network,
  });
  await assertAdvancedSwapSimulation({
    transactionBase64: created.unsignedTransaction,
    network: params.network,
    label: 'Recurring order',
  });
  const signedTransaction = await signSerializedTransactionForWallet({
    unsignedTransaction: created.unsignedTransaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });

  const executed = await executeRecurringSwap({
    recurringId: created.recurringId,
    signedTransaction,
    network: params.network,
  });
  if (
    executed.status !== 'Success' ||
    executed.operation !== 'create' ||
    executed.orderId == null
  ) {
    throw new Error('Recurring order creation could not be verified after execution.');
  }
  return {
    recurringId: executed.recurringId,
    status: executed.status,
    signature: executed.signature,
    orderId: executed.orderId,
  };
}

export function listTriggerOrders(params: {
  network: OffpayNetwork;
  state?: 'active' | 'past';
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<SwapTriggerListResponse> {
  assertMainnet(params.network);
  return listSwapTriggerOrders(
    {
      action: 'list',
      network: params.network,
      ...(params.state ? { state: params.state } : {}),
      ...(params.limit == null ? {} : { limit: params.limit }),
      ...(params.offset == null ? {} : { offset: params.offset }),
    },
    { signal: params.signal },
  );
}

export function listRecurringOrders(params: {
  network: OffpayNetwork;
  status: 'active' | 'history';
  page?: number;
  signal?: AbortSignal;
}): Promise<SwapRecurringListResponse> {
  assertMainnet(params.network);
  return listRecurringSwaps(
    {
      network: params.network,
      status: params.status,
      ...(params.page == null ? {} : { page: params.page }),
      includeFailedTransactions: false,
    },
    { signal: params.signal },
  );
}

export async function cancelTriggerOrder(
  params: CancelTriggerOrderParams,
): Promise<TriggerCancellationResult> {
  assertAddress(params.walletAddress, 'Active wallet');
  assertMainnet(params.network);
  assertOrderId(params.orderId, 'Trigger order ID');
  await authenticateTriggerOrderSession(params);
  const prepared = await prepareSwapTriggerCancellation({
    action: 'cancel_prepare',
    orderId: params.orderId,
    network: params.network,
  });
  if (prepared.orderId !== params.orderId) {
    throw new Error('Trigger cancellation was prepared for a different order.');
  }
  await assertAdvancedSwapSimulation({
    transactionBase64: prepared.unsignedTransaction,
    network: params.network,
    label: 'Trigger cancellation',
  });
  const signedTransaction = await signSerializedTransactionForWallet({
    unsignedTransaction: prepared.unsignedTransaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  return confirmSwapTriggerCancellation({
    action: 'cancel_confirm',
    orderId: params.orderId,
    cancelRequestId: prepared.cancelRequestId,
    signedTransaction,
    network: params.network,
  });
}

export async function cancelRecurringOrder(
  params: CancelRecurringSwapParams,
): Promise<RecurringCancellationResult> {
  assertAddress(params.walletAddress, 'Active wallet');
  assertMainnet(params.network);
  assertAddress(params.orderId, 'Recurring order ID');
  assertAddress(params.inputMint, 'Recurring input mint');
  assertAddress(params.outputMint, 'Recurring output mint');
  if (params.inputMint === params.outputMint) {
    throw new Error('Recurring cancellation mints must be different.');
  }
  const prepared = await prepareRecurringSwapCancellation({
    orderId: params.orderId,
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    network: params.network,
  });
  if (prepared.orderId !== params.orderId) {
    throw new Error('Recurring cancellation was prepared for a different order.');
  }
  await assertAdvancedSwapSimulation({
    transactionBase64: prepared.unsignedTransaction,
    network: params.network,
    label: 'Recurring cancellation',
  });
  const signedTransaction = await signSerializedTransactionForWallet({
    unsignedTransaction: prepared.unsignedTransaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  const executed = await executeRecurringSwap({
    recurringId: prepared.recurringId,
    signedTransaction,
    network: params.network,
  });
  if (
    executed.status !== 'Success' ||
    executed.operation !== 'cancel' ||
    executed.orderId !== params.orderId
  ) {
    throw new Error('Recurring cancellation could not be verified after execution.');
  }
  return {
    recurringId: executed.recurringId,
    orderId: params.orderId,
    status: 'Success',
    signature: executed.signature,
  };
}

async function finalizePrivacySwapWithRetry(params: {
  sessionId: string;
  swapQuoteTransaction: string;
  executor: EphemeralExecutorSigner;
  settlementMemo?: string;
  network: OffpayNetwork;
}): Promise<PrivacySwapFinalizeResponse> {
  const signQuote = async (transaction: string): Promise<string> => {
    try {
      return await runCryptoTask('advancedSwap.signQuote', () =>
        signSerializedTransactionWithSeed({
          unsignedTransaction: transaction,
          walletAddress: params.executor.walletAddress,
          signingSeed: params.executor.signingSeed,
          transactionLabel: 'privacy swap quote',
        }),
      );
    } catch (error) {
      throw new Error(`privacy swap quote signing failed: ${getSwapStageErrorMessage(error)}`);
    }
  };

  try {
    return await finalizePrivacySwapEnvelope({
      sessionId: params.sessionId,
      signedTransaction: await signQuote(params.swapQuoteTransaction),
      settlementMemo: params.settlementMemo,
      network: params.network,
    });
  } catch (error) {
    if (isQuoteExpiredError(error)) {
      const refreshed = await refreshPrivacySwapQuote({
        sessionId: params.sessionId,
        network: params.network,
      });
      return finalizePrivacySwapEnvelope({
        sessionId: params.sessionId,
        signedTransaction: await signQuote(refreshed.swapQuote.unsignedTransaction),
        settlementMemo: params.settlementMemo,
        network: params.network,
      });
    }

    if (isFinalizeInProgressError(error)) {
      await delay(1000);
      return finalizePrivacySwapEnvelope({
        sessionId: params.sessionId,
        signedTransaction: await signQuote(params.swapQuoteTransaction),
        settlementMemo: params.settlementMemo,
        network: params.network,
      });
    }

    throw error;
  }
}

export async function executePrivacyEnvelopeSwap(
  params: ExecutePrivacyEnvelopeSwapParams,
): Promise<PrivacyEnvelopeSwapResult> {
  assertCommonSwapInputs(params);
  if (!Number.isInteger(params.slippageBps) || params.slippageBps <= 0) {
    throw new Error('Slippage must be a positive integer in basis points.');
  }

  const activeWallet: ActiveWalletSigner = {
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  };
  const executor = createEphemeralExecutorSigner();

  try {
    if (executor.walletAddress === params.walletAddress) {
      throw new Error('Privacy executor wallet must differ from the active wallet.');
    }

    const prepared = await preparePrivacySwapEnvelope({
      executorWallet: executor.walletAddress,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      fundingMemo: params.fundingMemo,
      network: params.network,
    });
    const initializationSignatures: string[] = [];
    for (const [index, item] of prepared.initializationTransactions.entries()) {
      const signature = await signAndBroadcastPreparedTransaction({
        transaction: item.transaction,
        activeWallet,
        executor,
        network: params.network,
        label: `privacy ${item.role} initialization ${index + 1}`,
      });
      initializationSignatures.push(signature);
    }

    const fundingSignature = await signAndBroadcastPreparedTransaction({
      transaction: prepared.fundingTransaction,
      activeWallet,
      executor,
      network: params.network,
      label: 'privacy funding transaction',
    });
    const quote =
      prepared.swapQuote ??
      (
        await refreshPrivacySwapQuote({
          sessionId: prepared.sessionId,
          network: params.network,
        })
      ).swapQuote;
    const finalized = await finalizePrivacySwapWithRetry({
      sessionId: prepared.sessionId,
      swapQuoteTransaction: quote.unsignedTransaction,
      executor,
      settlementMemo: params.settlementMemo,
      network: params.network,
    });
    const settlementSignature = await signAndBroadcastPreparedTransaction({
      transaction: finalized.settlementTransaction,
      activeWallet,
      executor,
      network: params.network,
      label: 'privacy settlement transaction',
    });

    return {
      sessionId: finalized.sessionId,
      validator: finalized.validator,
      executorWallet: executor.walletAddress,
      initializationSignatures,
      fundingSignature,
      swapSignature: finalized.swapSignature,
      settlementSignature,
      outputMint: finalized.outputMint,
      settledAmount: finalized.settledAmount,
    };
  } finally {
    disposeExecutorSigner(executor);
  }
}
