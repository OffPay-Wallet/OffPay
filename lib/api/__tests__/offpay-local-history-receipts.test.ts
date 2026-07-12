import { buildLocalHistoryReceiptInputs } from '@/lib/api/offpay-local-history-receipts';
import {
  buildWalletHistoryGroups,
  buildWalletRecentActivityItems,
} from '@/lib/api/offpay-wallet-data';

import type { WalletTransactionsResponse } from '@/types/offpay-api';

const signature =
  '5r9jzD8fHa9eG4vAMcYQYV5spwG9R4VuYH9zJm7DYd6m8uDj7b4hyY3TwY2Nv4R8ydh7v7FGM5h7EJYvVx3sN4fQ';
const sender = '8WDiys1bU7uDLqJZFEKqa7UeXTZBKU7wkrYJ6st2XMz';
const recipient = 'EiV9gkAkBtZtHJE9f7pKNYRDqvy7z6ArjG';
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function buildTransaction(
  overrides: Partial<WalletTransactionsResponse['transactions'][number]> = {},
): WalletTransactionsResponse['transactions'][number] {
  return {
    signature,
    timestamp: 1_717_610_280,
    type: 'UNKNOWN',
    description: null,
    fee: 5_000,
    status: 'success',
    counterparties: [],
    ...overrides,
  };
}

describe('offpay local history receipts', () => {
  it('enriches a sparse normal-send backend row from the local receipt store', () => {
    const localReceipts = buildLocalHistoryReceiptInputs({
      network: 'devnet',
      walletAddress: sender,
      privatePaymentReceipts: [
        {
          id: signature,
          status: 'submitted',
          route: 'normal',
          source: 'manual',
          walletAddress: sender,
          recipient,
          mint: usdcMint,
          amount: '3000000',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          tokenLogo: 'https://tokens.example/usdc.png',
          tokenDecimals: 6,
          network: 'devnet',
          createdAt: 1_717_610_280_000,
          signature,
          txId: null,
          initSignature: null,
          message: 'Normal transfer submitted',
        },
      ],
    });

    const rows = buildWalletRecentActivityItems({
      transactions: [buildTransaction({ direction: 'send' })],
      localReceipts,
      network: 'devnet',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: signature,
      title: 'Sent',
      amountLabel: '-3 USDC',
      tokenMint: usdcMint,
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenLogo: 'https://tokens.example/usdc.png',
      detailAccountLabel: 'To',
      detailAccountAddress: recipient,
    });
  });

  it('enriches a sparse swap backend row with both local token legs', () => {
    const localReceipts = buildLocalHistoryReceiptInputs({
      network: 'devnet',
      walletAddress: sender,
      swapReceipts: [
        {
          id: signature,
          mode: 'normal',
          title: 'Swap complete',
          subtitle: '0.04 SOL to 12 USDC',
          signature,
          network: 'devnet',
          walletAddress: sender,
          createdAt: 1_717_610_280_000,
          input: {
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            name: 'Solana',
            decimals: 9,
            rawAmount: '40000000',
            amountLabel: '-0.04 SOL',
          },
          output: {
            mint: usdcMint,
            symbol: 'USDC',
            name: 'USD Coin',
            logo: 'https://tokens.example/usdc.png',
            decimals: 6,
            rawAmount: '12000000',
            amountLabel: '+12 USDC',
          },
        },
      ],
    });

    const rows = buildWalletRecentActivityItems({
      transactions: [buildTransaction({ type: 'SWAP', description: 'Swap submitted' })],
      localReceipts,
      network: 'devnet',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: signature,
      title: 'Swapped',
      amountLabel: '+12 USDC',
      secondaryAmountLabel: '-0.04 SOL',
      tokenMint: usdcMint,
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenLogo: 'https://tokens.example/usdc.png',
    });
  });

  it('shows one sold RWA row and suppresses its operational SOL signature everywhere', () => {
    const setupSignature = `${signature}-rwa-setup`;
    const settleSignature = `${signature}-rwa-settle`;
    const assetMint = '5yeucZisKb3uKCywapDwkZZr3YDeaQ71tu9YoTrD5WNC';
    const localReceipts = buildLocalHistoryReceiptInputs({
      network: 'devnet',
      walletAddress: sender,
      swapReceipts: [
        {
          id: 'rwa-sell-devnet-quote-1',
          mode: 'normal',
          activity: 'rwa_sell',
          title: 'Sold SPYd',
          subtitle: 'SP500',
          signature: settleSignature,
          hiddenSignatures: [setupSignature],
          network: 'devnet',
          walletAddress: sender,
          createdAt: 1_717_610_280_000,
          input: {
            mint: assetMint,
            symbol: 'SPYd',
            amountLabel: '-0.002652 SPYd',
          },
          output: {
            mint: usdcMint,
            symbol: 'RWAUSDC',
            amountLabel: '+2 RWAUSDC',
          },
        },
      ],
    });
    const transactions = [
      buildTransaction({
        signature: setupSignature,
        type: 'TRANSFER',
        description: 'Sent 0.002039 SOL',
        amount: '0.002039',
        rawAmount: '2039000',
        tokenMint: 'So11111111111111111111111111111111111111112',
        tokenSymbol: 'SOL',
        tokenDecimals: 9,
        direction: 'send',
      }),
      buildTransaction({
        signature: settleSignature,
        type: 'SWAP',
        description: 'Swapped 0.002652 SPYd to 2 RWAUSDC',
        amount: '2',
        rawAmount: '2000000',
        tokenMint: usdcMint,
        tokenSymbol: 'RWAUSDC',
        tokenDecimals: 6,
        direction: null,
      }),
    ];

    const recent = buildWalletRecentActivityItems({ transactions, localReceipts });
    const history = buildWalletHistoryGroups({ transactions, localReceipts }).flatMap(
      (group) => group.data,
    );

    for (const rows of [recent, history]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: settleSignature,
        title: 'Sold',
        amountLabel: '+2 RWAUSDC',
        secondaryAmountLabel: '-0.002652 SPYd',
        sourceLabel: 'RWA Trade',
      });
      expect(rows.some((row) => row.tokenSymbol === 'SOL')).toBe(false);
    }
  });
});
