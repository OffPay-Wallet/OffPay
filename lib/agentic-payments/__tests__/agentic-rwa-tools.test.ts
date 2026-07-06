import {
  createRwaQuote,
  getRwaAssets,
  getWalletTransactions,
} from '@/lib/api/offpay-api-client';
import { runAgenticTools, type AgenticToolRunnerContext } from '@/lib/agentic-payments/agent-tools';

import type {
  CapabilitiesResponse,
  RwaAsset,
  RwaQuoteResponse,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

jest.mock('@/lib/api/offpay-api-client', () => ({
  OffpayApiError: class OffpayApiError extends Error {
    status = 500;
    code = 'MOCK';
  },
  createRwaQuote: jest.fn(),
  getRwaAssets: jest.fn(),
  getWalletTransactions: jest.fn(),
}));

const mockGetRwaAssets = jest.mocked(getRwaAssets);
const mockCreateRwaQuote = jest.mocked(createRwaQuote);
const mockGetWalletTransactions = jest.mocked(getWalletTransactions);

const walletAddress = 'wallet111111111111111111111111111111111';
const settlementMint = 'settlement111111111111111111111111111111';
const spyMint = 'spy1111111111111111111111111111111111111';
const available = { available: true, reason: 'available', message: 'Available' } as const;

const capabilities: CapabilitiesResponse['capabilities'] = {
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
  rwa: {
    assets: available,
    price: available,
    quote: available,
    execute: available,
    magicBlockIntent: available,
    magicBlockTransfer: { available: false, reason: 'not_implemented', message: 'Disabled' },
  },
  payment: {
    privateInitMint: available,
    privateBalance: available,
    privateSend: available,
    umbraPrivateP2p: available,
    settle: available,
    rpcBroadcast: available,
  },
  umbra: { execution: available },
};

const spyAsset: RwaAsset = {
  id: 'offpay-devnet-spy',
  symbol: 'SPYd',
  name: 'SP500',
  mint: spyMint,
  decimals: 6,
  network: 'devnet',
  category: 'etf',
  provider: 'offpay_devnet_sandbox',
  providerLabel: 'OffPay devnet',
  providerEnvironment: 'devnet_sandbox',
  tokenProgramId: null,
  settlementMint,
  settlementSymbol: 'USDC',
  priceUsd: 749.12,
  change24hPct: 0.2,
  verified: true,
  tradable: true,
  devnetSandbox: true,
  magicBlockEligible: true,
  riskLevel: 'sandbox',
  logo: null,
  underlyingSymbol: 'SPY',
  complianceLabel: 'Devnet sandbox',
  execution: {
    buy: 'devnet_sandbox',
    sell: 'devnet_sandbox',
    transfer: 'disabled',
    magicBlock: 'devnet_sandbox',
  },
};

const balance: WalletBalanceResponse = {
  address: walletAddress,
  network: 'devnet',
  solBalance: 1_000_000_000,
  fetchedAt: 1,
  tokens: [
    {
      mint: settlementMint,
      name: 'Devnet RWA Settlement USDC',
      symbol: 'RWAUSDC',
      logo: null,
      balance: '100',
      decimals: 6,
      verified: true,
      spam: false,
    },
    {
      mint: spyMint,
      name: 'SP500',
      symbol: 'SPYd',
      logo: null,
      balance: '0.02',
      decimals: 6,
      verified: true,
      spam: false,
    },
  ],
};

const context: AgenticToolRunnerContext = {
  scope: { walletAddress, network: 'devnet' },
  walletMode: 'online',
  canUseNetwork: true,
  balance,
  capabilities,
  knownWallets: [],
  redactions: [],
  userText: 'buy 2 RWAUSDC of SPY',
  walletId: 'wallet-1',
  walletImportMethod: 'generated',
};

describe('agentic RWA tools', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetRwaAssets.mockResolvedValue({
      network: 'devnet',
      mode: 'devnet_sandbox',
      provider: 'offpay_devnet_sandbox',
      providerEnvironment: 'devnet_sandbox',
      assets: [spyAsset],
      fetchedAt: 1,
    });
  });

  it('drafts a devnet RWA buy without returning mints or unsigned transactions to the model', async () => {
    const quote: RwaQuoteResponse = {
      quoteId: 'quote-1',
      assetMint: spyMint,
      assetSymbol: 'SPYd',
      settlementMint,
      settlementSymbol: 'USDC',
      side: 'buy',
      priceUsd: 749.12,
      quantity: '0.00267',
      cashAmount: '2',
      priceImpactPct: 0,
      routeSummary: 'OffPay devnet RWA settlement',
      fee: '0',
      slippageBps: null,
      expiresAt: Date.now() + 60_000,
      provider: 'offpay_devnet_sandbox',
      providerEnvironment: 'devnet_sandbox',
      unsignedTransaction: 'unsigned-base64',
      transactionFormat: 'solana_legacy_transaction_base64',
      unsignedTransactions: [
        {
          id: 'delegate',
          label: 'Delegate',
          target: 'solana_devnet',
          unsignedTransaction: 'delegate-base64',
          transactionFormat: 'solana_legacy_transaction_base64',
        },
      ],
      sandboxIntent: {
        programId: 'program',
        intent: 'intent',
        market: 'market',
        nonce: 'nonce',
        quoteHash: 'hash',
        magicBlock: {
          enabled: true,
          erRpcUrl: 'https://er.devnet.magicblock.app',
          delegatedAccount: 'delegated',
        },
      },
    };
    mockCreateRwaQuote.mockResolvedValue(quote);

    const run = await runAgenticTools(
      [{ id: 'call-rwa-buy', name: 'prepare_rwa_trade', args: { asset: 'SPY', side: 'buy', amount: '2' } }],
      context,
    );

    expect(run.drafts).toHaveLength(1);
    expect(run.drafts[0]).toMatchObject({
      kind: 'rwa_trade',
      draft: {
        inputAmount: '2',
        paySymbol: 'RWAUSDC',
        receiveSymbol: 'SPYd',
        quoteId: 'quote-1',
      },
    });
    expect(run.results[0].result).toMatchObject({
      status: 'drafted',
      assetSymbol: 'SPYd',
      payAmount: '2',
      receiveAmount: '0.00267',
      magicBlockIntent: true,
    });
    expect(JSON.stringify(run.results[0].result)).not.toContain(spyMint);
    expect(JSON.stringify(run.results[0].result)).not.toContain(settlementMint);
    expect(JSON.stringify(run.results[0].result)).not.toContain('unsigned-base64');
  });

  it('summarizes RWA holdings and history without signatures or mints', async () => {
    const history: WalletTransactionsResponse = {
      address: walletAddress,
      network: 'devnet',
      transactions: [
        {
          signature: 'signature-secret',
          timestamp: 1,
          type: 'swap',
          description: null,
          amount: '0.01',
          tokenMint: spyMint,
          tokenSymbol: 'SPYd',
          tokenName: 'SP500',
          tokenLogo: null,
          tokenDecimals: 6,
          fee: 5000,
          status: 'success',
          direction: 'receive',
          sender: null,
          recipient: null,
          counterparties: [],
        },
      ],
      cursor: null,
      fetchedAt: 1,
    };
    mockGetWalletTransactions.mockResolvedValue(history);

    const run = await runAgenticTools(
      [
        { id: 'call-holdings', name: 'get_rwa_holdings', args: {} },
        { id: 'call-history', name: 'get_rwa_history', args: { limit: 5 } },
      ],
      context,
    );

    expect(run.results[0].result).toMatchObject({
      status: 'ok',
      settlement: [{ symbol: 'RWAUSDC', balance: '100' }],
      holdings: [expect.objectContaining({ symbol: 'SPYd', balance: '0.02' })],
    });
    expect(run.results[1].result).toMatchObject({
      status: 'ok',
      transactions: [expect.objectContaining({ tokenSymbol: 'SPYd', amount: '0.01' })],
    });
    const serialized = JSON.stringify(run.results);
    expect(serialized).not.toContain(spyMint);
    expect(serialized).not.toContain(settlementMint);
    expect(serialized).not.toContain('signature-secret');
  });
});
