import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  getRpcAccounts,
  getSwapPrice,
  getSwapTokens,
  getWalletBalance,
  listRecurringSwaps,
  listSwapTriggerOrders,
} from '@/lib/api/offpay-api-client';
import {
  getAvailableAgenticModelToolSchemas,
  runAgenticTools,
} from '@/lib/agentic-payments/agent-tools';
import { SPL_TOKEN_PROGRAM_ID } from '@/lib/crypto/solana-token-accounts';
import type { AgenticToolRunnerContext } from '@/lib/agentic-payments/tools/types';
import type { CapabilitiesResponse } from '@/types/offpay-api';

jest.mock('@/lib/api/offpay-api-client', () => ({
  OffpayApiError: class OffpayApiError extends Error {
    code = 'UPSTREAM_UNAVAILABLE';
    status = 503;
  },
  getSwapTokens: jest.fn(),
  getSwapPrice: jest.fn(),
  getRpcAccounts: jest.fn(),
  getWalletBalance: jest.fn(),
  listRecurringSwaps: jest.fn(),
  listSwapTriggerOrders: jest.fn(),
}));

const mockGetSwapTokens = jest.mocked(getSwapTokens);
const mockGetSwapPrice = jest.mocked(getSwapPrice);
const mockGetRpcAccounts = jest.mocked(getRpcAccounts);
const mockGetWalletBalance = jest.mocked(getWalletBalance);
const mockListRecurringSwaps = jest.mocked(listRecurringSwaps);
const mockListSwapTriggerOrders = jest.mocked(listSwapTriggerOrders);

function addressFromSeed(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const walletAddress = addressFromSeed(1);
const solMint = 'So11111111111111111111111111111111111111112';
const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const available = { available: true, reason: 'available', message: 'Available' } as const;

const capabilities = {
  wallet: { balance: available, transactions: available },
  stream: { walletActivity: available },
  swap: {
    tokens: available,
    price: available,
    normalSwap: available,
    privacySwap: available,
    triggerOrders: available,
    recurringSwap: available,
  },
  payment: {
    privateInitMint: available,
    privateBalance: available,
    privateSend: available,
    settle: available,
    rpcBroadcast: available,
  },
} as CapabilitiesResponse['capabilities'];

function walletBalance(usdcBalance = '1000') {
  return {
    address: walletAddress,
    network: 'mainnet' as const,
    solBalance: 1_000_000_000,
    fetchedAt: Date.now(),
    tokens: [
      {
        mint: usdcMint,
        name: 'USD Coin',
        symbol: 'USDC',
        logo: null,
        balance: usdcBalance,
        decimals: 6,
        verified: true,
        spam: false,
      },
    ],
  };
}

function rpcMintAccount(owner: string) {
  return { owner, lamports: 1, executable: false, rentEpoch: 0 };
}

function context(): AgenticToolRunnerContext {
  return {
    scope: { walletAddress, network: 'mainnet' },
    walletMode: 'online',
    canUseNetwork: true,
    balance: walletBalance(),
    capabilities,
    knownWallets: [],
    redactions: [],
    userText: 'prepare an advanced Jupiter swap',
    offeredToolNames: [
      'prepare_trigger_swap',
      'prepare_recurring_swap',
      'get_advanced_swap_orders',
      'prepare_advanced_swap_cancel',
    ],
  };
}

describe('agentic Jupiter Trigger and Recurring drafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSwapTokens.mockResolvedValue({
      tokens: [
        {
          mint: usdcMint,
          name: 'USD Coin',
          symbol: 'USDC',
          logo: null,
          decimals: 6,
          verified: true,
        },
        {
          mint: solMint,
          name: 'Wrapped SOL',
          symbol: 'SOL',
          logo: null,
          decimals: 9,
          verified: true,
        },
      ],
    });
    mockGetSwapPrice.mockImplementation(async (mint: string) => ({
      mint,
      price: mint === solMint ? 150 : 1,
      currency: 'USD',
      fetchedAt: Date.now(),
    }));
    mockGetRpcAccounts.mockResolvedValue({
      network: 'mainnet',
      accounts: [rpcMintAccount(SPL_TOKEN_PROGRAM_ID), rpcMintAccount(SPL_TOKEN_PROGRAM_ID)],
    });
    mockGetWalletBalance.mockResolvedValue(walletBalance());
    mockListSwapTriggerOrders.mockResolvedValue({
      orders: [
        {
          id: 'trigger-order-1',
          orderType: 'single',
          orderState: 'open',
          rawState: 'open',
          inputMint: usdcMint,
          outputMint: solMint,
          triggerMint: solMint,
          initialInputAmount: '20000000',
          remainingInputAmount: '20000000',
          outputAmount: null,
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      pagination: { total: 41, limit: 20, offset: 20 },
    });
    mockListRecurringSwaps.mockResolvedValue({
      walletAddress,
      status: 'active',
      page: 1,
      totalPages: 1,
      orders: [
        {
          orderId: addressFromSeed(9),
          inputMint: usdcMint,
          outputMint: solMint,
          rawInDeposited: '200000000',
          rawInWithdrawn: '0',
          rawInUsed: '0',
          rawOutReceived: '0',
          rawOutWithdrawn: '0',
          rawInAmountPerCycle: '50000000',
          cycleFrequency: '86400',
          userClosed: false,
          openSignature: 'open-signature',
          closeSignature: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
    });
  });

  it('creates a local-only single trigger intent from live token and price data', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'trigger-1',
          name: 'prepare_trigger_swap',
          args: {
            inputToken: 'USDC',
            outputToken: 'SOL',
            amount: '20',
            triggerToken: 'SOL',
            triggerCondition: 'below',
            triggerPriceUsd: 100,
            expiryHours: 24,
            slippageBps: 100,
          },
        },
      ],
      context(),
    );

    expect(run.results[0]?.error).toBeUndefined();
    expect(run.drafts[0]).toMatchObject({
      kind: 'swap_trigger',
      draft: {
        inputRawAmount: '20000000',
        triggerMint: solMint,
        triggerCondition: 'below',
        triggerPriceUsd: 100,
      },
    });
    expect(JSON.stringify(run.results)).not.toContain(usdcMint);
    expect(JSON.stringify(run.results)).not.toContain(solMint);
    expect(JSON.stringify(run.drafts[0])).not.toContain('unsignedTransaction');
  });

  it('treats recurring amount as the total deposit and enforces $50 per order', async () => {
    const accepted = await runAgenticTools(
      [
        {
          id: 'recurring-1',
          name: 'prepare_recurring_swap',
          args: {
            inputToken: 'USDC',
            outputToken: 'SOL',
            amount: '200',
            interval: 'daily',
            orderCount: 4,
          },
        },
      ],
      context(),
    );
    expect(accepted.drafts[0]).toMatchObject({
      kind: 'swap_recurring',
      draft: {
        inputRawAmount: '200000000',
        frequency: 'daily:4',
        perOrderValueUsd: 50,
      },
    });

    const rejected = await runAgenticTools(
      [
        {
          id: 'recurring-low',
          name: 'prepare_recurring_swap',
          args: {
            inputToken: 'USDC',
            outputToken: 'SOL',
            amount: '199',
            interval: 'daily',
            orderCount: 4,
          },
        },
      ],
      context(),
    );
    expect(rejected.results[0]?.error?.code).toBe('recurring_minimum_not_met');
    expect(rejected.drafts).toHaveLength(0);
  });

  it('rejects an already-met trigger and Token-2022 mints before any draft', async () => {
    const alreadyMet = await runAgenticTools(
      [
        {
          id: 'trigger-met',
          name: 'prepare_trigger_swap',
          args: {
            inputToken: 'USDC',
            outputToken: 'SOL',
            amount: '20',
            triggerToken: 'SOL',
            triggerCondition: 'above',
            triggerPriceUsd: 100,
            expiryHours: 24,
          },
        },
      ],
      context(),
    );
    expect(alreadyMet.results[0]?.error?.code).toBe('trigger_condition_already_met');

    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [
        rpcMintAccount('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
        rpcMintAccount(SPL_TOKEN_PROGRAM_ID),
      ],
    });
    const token2022 = await runAgenticTools(
      [
        {
          id: 'recurring-token-2022',
          name: 'prepare_recurring_swap',
          args: {
            inputToken: 'USDC',
            outputToken: 'SOL',
            amount: '200',
            interval: 'daily',
            orderCount: 4,
          },
        },
      ],
      context(),
    );
    expect(token2022.drafts).toHaveLength(0);
  });

  it('lists verified lifecycle order IDs without exposing provider transaction data', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'orders-1',
          name: 'get_advanced_swap_orders',
          args: { kind: 'trigger', status: 'active', page: 2 },
        },
      ],
      context(),
    );

    expect(run.results[0]?.error).toBeUndefined();
    expect(run.results[0]?.result).toMatchObject({
      kind: 'trigger',
      page: 2,
      totalPages: 3,
      orders: [{ orderId: 'trigger-order-1', status: 'open', inputSymbol: 'USDC' }],
    });
    expect(mockListSwapTriggerOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 }),
      expect.objectContaining({ signal: undefined }),
    );
    expect(JSON.stringify(run.results[0])).not.toContain(usdcMint);
    expect(JSON.stringify(run.results[0])).not.toContain(solMint);
  });

  it('drafts cancellation only for the exact live order and keeps transactions local', async () => {
    const orderId = addressFromSeed(9);
    const run = await runAgenticTools(
      [
        {
          id: 'cancel-1',
          name: 'prepare_advanced_swap_cancel',
          args: { kind: 'recurring', orderId, page: 1 },
        },
      ],
      context(),
    );

    expect(run.results[0]?.error).toBeUndefined();
    expect(run.drafts[0]).toMatchObject({
      kind: 'swap_recurring_cancel',
      draft: { orderId, walletAddress, providerStatus: 'active' },
    });
    expect(JSON.stringify(run.drafts[0])).not.toContain('unsignedTransaction');
    expect(mockListRecurringSwaps).toHaveBeenCalledTimes(1);
    expect(mockListRecurringSwaps).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, status: 'active' }),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('exposes both tools only when their real mainnet capabilities are available', () => {
    const names = getAvailableAgenticModelToolSchemas({
      network: 'mainnet',
      walletAddress,
      walletId: 'wallet-1',
      walletMode: 'online',
      canUseNetwork: true,
      capabilities,
    }).map((schema) => schema.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'prepare_trigger_swap',
        'prepare_recurring_swap',
        'get_advanced_swap_orders',
        'prepare_advanced_swap_cancel',
      ]),
    );
  });
});
