import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  createRecurringOrder,
  executeRecurringOrder,
  listRecurringOrders,
  prepareRecurringOrderCancellation,
} from '../jupiter';
import {
  resetJupiterTransactionVerifierImplementationForTests,
  setJupiterTransactionVerifierImplementationForTests,
} from '../jupiter-transaction-verifier';
import { readBoundTransactionMessage } from '../solana-transaction-binding';

import type { Bindings } from '../types';

const owner = Keypair.fromSeed(new Uint8Array(32).fill(51));
const otherOwner = Keypair.fromSeed(new Uint8Array(32).fill(53));
const orderId = Keypair.fromSeed(new Uint8Array(32).fill(52)).publicKey.toBase58();
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const JUPITER_BASE_URL = 'https://api.jup.ag';
const RPC_URL = 'https://rpc.offpay.test';
const bindings = {
  JUPITER_API_KEY: 'test-jupiter-key',
  JUPITER_API_BASE_URL: JUPITER_BASE_URL,
  HELIUS_MAINNET_RPC_URL: RPC_URL,
  UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
} as Bindings;

function wireTransaction(lamports: number, signed: boolean): string {
  const transaction = new Transaction({
    feePayer: owner.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
  }).add(
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: owner.publicKey,
      lamports,
    }),
  );
  if (signed) transaction.sign(owner);
  return transaction
    .serialize({ requireAllSignatures: signed, verifySignatures: signed })
    .toString('base64');
}

function transactionSignature(transactionBase64: string): string {
  const signature = Transaction.from(Buffer.from(transactionBase64, 'base64')).signature;
  if (!signature) throw new Error('Test transaction is unsigned.');
  return bs58.encode(signature);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Jupiter recurring order transaction binding', () => {
  const unsignedTransaction = wireTransaction(1, false);
  const signedTransaction = wireTransaction(1, true);
  const tamperedTransaction = wireTransaction(2, true);
  const unsignedCancellation = wireTransaction(3, false);
  const signedCancellation = wireTransaction(3, true);
  const tamperedCancellation = wireTransaction(4, true);
  let storage: Map<string, string>;
  let executeCalls: number;
  let createCalls: number;
  let listCalls: number;
  let verifierIntents: unknown[];
  let executePayloadOverride: unknown | null;
  let executeHttpStatus: number;
  let confirmedRpcSignature: string | null;
  let failNextCompletedStore: boolean;
  let failLockRelease: boolean;
  let rpcMintOwners: Map<string, string>;
  let executeProviderRequestIds: string[];

  beforeEach(() => {
    storage = new Map();
    executeCalls = 0;
    createCalls = 0;
    listCalls = 0;
    verifierIntents = [];
    executePayloadOverride = null;
    executeHttpStatus = 200;
    confirmedRpcSignature = null;
    failNextCompletedStore = false;
    failLockRelease = false;
    rpcMintOwners = new Map([
      [inputMint, TOKEN_PROGRAM_ID],
      [outputMint, TOKEN_PROGRAM_ID],
    ]);
    executeProviderRequestIds = [];
    setJupiterTransactionVerifierImplementationForTests(async (request) => {
      verifierIntents.push(request.intent);
      return {
        transactionMessageBase64: readBoundTransactionMessage({
          transactionBase64: request.transactionBase64,
          requiredSignerAddress: request.intent.walletAddress,
          requireSignerSignature: false,
          label: 'Recurring test transaction',
        }),
        kind: request.intent.kind,
        feePayerAddress: request.intent.walletAddress,
        signerAddresses: [request.intent.walletAddress],
        programIds: [],
        providerRequestId: request.intent.providerRequestId ?? null,
        maxPriorityFeeLamports: '0',
        maxNewTokenAccounts: 0,
        recurringOrderAddress:
          request.intent.kind === 'recurringCreate'
            ? orderId
            : request.intent.kind === 'recurringCancel'
              ? request.intent.orderAddress
              : null,
      };
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === RPC_URL) {
        const rpcRequest = JSON.parse(String(init?.body ?? '{}')) as {
          id?: string;
          method?: string;
          params?: unknown[];
        };
        if (rpcRequest.method === 'getMultipleAccounts') {
          const addresses = Array.isArray(rpcRequest.params?.[0])
            ? (rpcRequest.params[0] as string[])
            : [];
          return jsonResponse({
            jsonrpc: '2.0',
            id: rpcRequest.id,
            result: {
              value: addresses.map((address) => ({
                executable: false,
                lamports: 1,
                owner: rpcMintOwners.get(address) ?? TOKEN_PROGRAM_ID,
                rentEpoch: 0,
                data: ['', 'base64'],
                space: 82,
              })),
            },
          });
        }
        if (rpcRequest.method === 'getSignatureStatuses') {
          const signatures = Array.isArray(rpcRequest.params?.[0])
            ? (rpcRequest.params[0] as string[])
            : [];
          return jsonResponse({
            jsonrpc: '2.0',
            id: rpcRequest.id,
            result: {
              value: signatures.map((signature) =>
                signature === confirmedRpcSignature
                  ? {
                      slot: 1,
                      confirmations: 1,
                      confirmationStatus: 'confirmed',
                      err: null,
                    }
                  : null,
              ),
            },
          });
        }
        throw new Error(`Unexpected RPC method: ${rpcRequest.method}`);
      }
      if (url === 'https://redis.offpay.test/pipeline') {
        const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
        if (
          failNextCompletedStore &&
          commands.some(
            (command) =>
              command[0] === 'SET' &&
              typeof command[2] === 'string' &&
              command[2].startsWith('{') &&
              (JSON.parse(command[2]) as { status?: string }).status === 'completed',
          )
        ) {
          failNextCompletedStore = false;
          return jsonResponse({ error: 'storage unavailable' }, 503);
        }
        if (failLockRelease && commands.some((command) => command[0] === 'EVAL')) {
          return jsonResponse({ error: 'release unavailable' }, 503);
        }
        return jsonResponse(
          commands.map((command) => {
            const [operation, key, value] = command;
            if (operation === 'GET') return { result: storage.get(key ?? '') ?? null };
            if (operation === 'DEL') return { result: storage.delete(key ?? '') ? 1 : 0 };
            if (operation === 'SET') {
              const lockOnly = command.includes('NX');
              if (lockOnly && storage.has(key ?? '')) return { result: null };
              storage.set(key ?? '', value ?? '');
              return { result: 'OK' };
            }
            if (operation === 'EVAL') {
              const lockKey = command[3] ?? '';
              const lockToken = command[4] ?? '';
              if (storage.get(lockKey) !== lockToken) return { result: 0 };
              storage.delete(lockKey);
              return { result: 1 };
            }
            throw new Error(`Unexpected Redis operation: ${operation}`);
          }),
        );
      }
      if (url === `${JUPITER_BASE_URL}/recurring/v1/createOrder`) {
        createCalls += 1;
        return jsonResponse({ requestId: 'recurring-1', transaction: unsignedTransaction });
      }
      if (url === `${JUPITER_BASE_URL}/recurring/v1/execute`) {
        executeCalls += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          requestId?: string;
          signedTransaction?: string;
        };
        executeProviderRequestIds.push(body.requestId ?? '');
        return jsonResponse(
          executePayloadOverride ?? {
            status: 'Success',
            signature: transactionSignature(body.signedTransaction ?? ''),
            order: orderId,
          },
          executeHttpStatus,
        );
      }
      if (url.includes(`${JUPITER_BASE_URL}/recurring/v1/getRecurringOrders?`)) {
        listCalls += 1;
        return jsonResponse({
          user: owner.publicKey.toBase58(),
          orderStatus: 'active',
          page: 1,
          totalPages: 1,
          time: [
            {
              userPubkey: owner.publicKey.toBase58(),
              orderKey: orderId,
              inputMint,
              outputMint,
              rawInDeposited: '1000000',
              rawInWithdrawn: '0',
              rawInUsed: '0',
              rawOutReceived: '0',
              rawOutWithdrawn: '0',
              rawInAmountPerCycle: '500000',
              cycleFrequency: 86400,
              userClosed: false,
              openTx: 'open-signature',
              closeTx: null,
              createdAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          ],
        });
      }
      if (url === `${JUPITER_BASE_URL}/recurring/v1/cancelOrder`) {
        return jsonResponse({
          requestId: 'recurring-cancel-1',
          transaction: unsignedCancellation,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  afterEach(() => {
    resetJupiterTransactionVerifierImplementationForTests();
    jest.restoreAllMocks();
  });

  async function createDraft(idempotencyKey = 'recurring_create_test_1') {
    return createRecurringOrder(bindings, {
      walletAddress: owner.publicKey.toBase58(),
      inputMint,
      outputMint,
      amount: '1000000',
      frequency: 'daily:2',
      idempotencyKey,
      network: 'mainnet',
    });
  }

  it('executes only the exact prepared message signed by its authenticated owner', async () => {
    const draft = await createDraft();

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).resolves.toEqual({
      recurringId: draft.recurringId,
      status: 'Success',
      signature: transactionSignature(signedTransaction),
      orderId,
      operation: 'create',
    });
    expect(executeCalls).toBe(1);
    expect(
      storage.has(
        `swap-recurring:v1:mainnet:${owner.publicKey.toBase58()}:${draft.recurringId}`,
      ),
    ).toBe(true);
    expect(executeProviderRequestIds).toEqual(['recurring-1']);
    expect(verifierIntents).toContainEqual(
      expect.objectContaining({ kind: 'recurringCreate', providerRequestId: 'recurring-1' }),
    );
  });

  it('rejects a separately signed transaction before contacting Jupiter execute', async () => {
    const draft = await createDraft();

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction: tamperedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('does not match the prepared order');
    expect(executeCalls).toBe(0);
  });

  it('lists active orders only when the provider wallet matches exactly', async () => {
    await expect(
      listRecurringOrders(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
        status: 'active',
        page: 1,
      }),
    ).resolves.toMatchObject({
      walletAddress: owner.publicKey.toBase58(),
      status: 'active',
      page: 1,
      totalPages: 1,
      orders: [{ orderId, rawInDeposited: '1000000', userClosed: false }],
    });
  });

  it('binds a recurring cancellation and executes identical retries only once', async () => {
    const draft = await prepareRecurringOrderCancellation(bindings, {
      walletAddress: owner.publicKey.toBase58(),
      network: 'mainnet',
      orderId,
      inputMint,
      outputMint,
    });
    expect(draft).toMatchObject({
      orderId,
      unsignedTransaction: unsignedCancellation,
    });
    expect(listCalls).toBe(0);
    const request = {
      recurringId: draft.recurringId,
      signedTransaction: signedCancellation,
      walletAddress: owner.publicKey.toBase58(),
      network: 'mainnet' as const,
    };
    await expect(executeRecurringOrder(bindings, request)).resolves.toMatchObject({
      recurringId: draft.recurringId,
      operation: 'cancel',
      orderId,
      signature: transactionSignature(signedCancellation),
    });
    await expect(executeRecurringOrder(bindings, request)).resolves.toMatchObject({
      recurringId: draft.recurringId,
      operation: 'cancel',
      orderId,
      signature: transactionSignature(signedCancellation),
    });
    expect(executeCalls).toBe(1);
    expect(verifierIntents).toContainEqual(
      expect.objectContaining({
        kind: 'recurringCancel',
        orderAddress: orderId,
        providerRequestId: 'recurring-cancel-1',
      }),
    );
  });

  it('rejects a substituted recurring cancellation before execute', async () => {
    const draft = await prepareRecurringOrderCancellation(bindings, {
      walletAddress: owner.publicKey.toBase58(),
      network: 'mainnet',
      orderId,
      inputMint,
      outputMint,
    });
    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction: tamperedCancellation,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('does not match the prepared order');
    expect(executeCalls).toBe(0);
  });

  it('replays the same recurring create idempotency key without creating another provider order', async () => {
    const first = await createDraft('stable_recurring_intent_1');
    const second = await createDraft('stable_recurring_intent_1');

    expect(second).toEqual(first);
    expect(createCalls).toBe(1);

    await expect(
      createRecurringOrder(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        inputMint,
        outputMint,
        amount: '2000000',
        frequency: 'daily:2',
        idempotencyKey: 'stable_recurring_intent_1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('already bound to a different intent');
    expect(createCalls).toBe(1);
  });

  it('rejects a provider success carrying a signature from another transaction', async () => {
    const draft = await createDraft();
    executePayloadOverride = {
      status: 'Success',
      signature: bs58.encode(new Uint8Array(64).fill(7)),
      order: orderId,
    };

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('could not be bound to the signed transaction');
  });

  it('rejects a provider success carrying a different recurring order account', async () => {
    const draft = await createDraft();
    executePayloadOverride = {
      status: 'Success',
      signature: transactionSignature(signedTransaction),
      order: Keypair.fromSeed(new Uint8Array(32).fill(54)).publicKey.toBase58(),
    };

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('could not be bound to the signed transaction');
  });

  it('rejects success-shaped recurring payloads returned over a failed HTTP response', async () => {
    const draft = await createDraft();
    executeHttpStatus = 500;
    executePayloadOverride = {
      status: 'Success',
      signature: transactionSignature(signedTransaction),
      order: orderId,
    };

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('currently unavailable');
  });

  it('keeps prepared state isolated when another authenticated wallet guesses its local ID', async () => {
    const draft = await createDraft();
    const ownerStateKey =
      `swap-recurring:v1:mainnet:${owner.publicKey.toBase58()}:${draft.recurringId}`;

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: otherOwner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('price has refreshed');
    expect(storage.has(ownerStateKey)).toBe(true);
    expect(executeCalls).toBe(0);
  });

  it('reconciles on-chain success after completion-state storage fails', async () => {
    const draft = await createDraft();
    const signature = transactionSignature(signedTransaction);
    failNextCompletedStore = true;

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({ signature, orderId });

    confirmedRpcSignature = signature;
    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({ signature, orderId });
    expect(executeCalls).toBe(1);
  });

  it('does not turn provider success into failure when lock cleanup is unavailable', async () => {
    const draft = await createDraft();
    failLockRelease = true;

    await expect(
      executeRecurringOrder(bindings, {
        recurringId: draft.recurringId,
        signedTransaction,
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({
      signature: transactionSignature(signedTransaction),
      orderId,
    });
  });

  it('rejects Token-2022 mints before preparing a Jupiter Recurring transaction', async () => {
    const token2022Mint = Keypair.fromSeed(new Uint8Array(32).fill(55)).publicKey.toBase58();
    rpcMintOwners.set(token2022Mint, TOKEN_2022_PROGRAM_ID);

    await expect(
      createRecurringOrder(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        inputMint,
        outputMint: token2022Mint,
        amount: '1000000',
        frequency: 'daily:2',
        idempotencyKey: 'token_2022_rejection_1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('supports only classic SPL token mints');
    expect(createCalls).toBe(0);
  });
});
