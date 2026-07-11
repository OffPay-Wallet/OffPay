import { createSwapQuote, getSwapTokens } from '@/lib/api/offpay-api-client';
import { runAgenticTools } from '@/lib/agentic-payments/agent-tools';

import type { AgenticToolRunnerContext } from '@/lib/agentic-payments/tools/types';
import type { CapabilitiesResponse } from '@/types/offpay-api';

jest.mock('@/lib/api/offpay-api-client', () => ({
  OffpayApiError: class OffpayApiError extends Error {
    code = 'UPSTREAM_UNAVAILABLE';
    status = 503;
  },
  createSwapQuote: jest.fn(),
  getSwapTokens: jest.fn(),
}));

const mockCreateSwapQuote = jest.mocked(createSwapQuote);
const mockGetSwapTokens = jest.mocked(getSwapTokens);

const walletAddress = '11111111111111111111111111111111';
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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

function context(): AgenticToolRunnerContext {
  return {
    scope: { walletAddress, network: 'mainnet' },
    walletMode: 'online',
    canUseNetwork: true,
    balance: {
      address: walletAddress,
      network: 'mainnet',
      solBalance: 2_000_000_000,
      fetchedAt: Date.now(),
      tokens: [
        {
          mint: inputMint,
          name: 'Wrapped SOL',
          symbol: 'SOL',
          logo: null,
          balance: '2',
          decimals: 9,
          verified: true,
          spam: false,
        },
      ],
    },
    capabilities,
    knownWallets: [],
    redactions: [],
    userText: 'swap one SOL to USDC',
    offeredToolNames: ['prepare_swap_quote'],
  };
}

describe('agentic normal swap drafting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSwapTokens.mockResolvedValue({
      tokens: [
        {
          mint: inputMint,
          name: 'Wrapped SOL',
          symbol: 'SOL',
          logo: null,
          decimals: 9,
          verified: true,
        },
        {
          mint: outputMint,
          name: 'USD Coin',
          symbol: 'USDC',
          logo: null,
          decimals: 6,
          verified: true,
        },
      ],
    });
    mockCreateSwapQuote.mockResolvedValue({
      quoteId: 'quote-1',
      inputMint,
      outputMint,
      inAmount: '1000000000',
      outAmount: '150000000',
      minimumOutputAmount: '148500000',
      slippageBps: 100,
      slippageMode: 'manual',
      priceImpactPct: 0.1,
      fee: '0',
      routeSummary: 'Metis',
      expiresAt: Date.now() + 60_000,
      unsignedTransaction: 'unsigned-swap',
    });
  });

  it('omits a same-wallet receiver and retains the exact minimum output in the local draft', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'swap-1',
          name: 'prepare_swap_quote',
          args: { inputToken: 'SOL', outputToken: 'USDC', amount: '1', slippageBps: 100 },
        },
      ],
      context(),
    );

    expect(run.results[0]?.error).toBeUndefined();
    const request = mockCreateSwapQuote.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      inputMint,
      outputMint,
      amount: '1000000000',
      network: 'mainnet',
    });
    expect(request).not.toHaveProperty('receiverAddress');
    expect(run.drafts[0]).toMatchObject({
      kind: 'swap',
      draft: { minimumOutputAmount: '148500000' },
    });
  });
});
