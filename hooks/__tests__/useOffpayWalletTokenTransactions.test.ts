import { buildWarmTokenTransactionsPage } from '@/hooks/useOffpayWalletTokenTransactions';

import type { WalletTransactionsResponse } from '@/types/offpay-api';

const walletAddress = '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ';
const nativeSolMint = 'So11111111111111111111111111111111111111112';
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function transaction(
  signature: string,
  timestamp: number,
  tokenMint: string,
  tokenSymbol: string,
): WalletTransactionsResponse['transactions'][number] {
  return {
    signature,
    timestamp,
    type: 'TRANSFER',
    description: 'Native token transfer',
    amount: '1',
    rawAmount: '1000000000',
    tokenMint,
    tokenSymbol,
    tokenName: tokenSymbol,
    tokenLogo: null,
    tokenDecimals: tokenSymbol === 'SOL' ? 9 : 6,
    fee: 5000,
    status: 'success',
    direction: 'receive',
    sender: null,
    recipient: walletAddress,
    counterparties: [],
  };
}

function walletHistoryPage(
  transactions: WalletTransactionsResponse['transactions'],
  cursor: string | null,
): WalletTransactionsResponse {
  return {
    address: walletAddress,
    network: 'devnet',
    transactions,
    displayTransactions: [],
    historyGroups: [],
    cursor,
    fetchedAt: 1,
  };
}

describe('buildWarmTokenTransactionsPage', () => {
  it('keeps the source cursor when a partial warm SOL page has older wallet history', () => {
    const page = buildWarmTokenTransactionsPage({
      walletAddress,
      network: 'devnet',
      mint: nativeSolMint,
      limit: 3,
      pages: [
        walletHistoryPage(
          [
            transaction('sig-new-sol', 30, nativeSolMint, 'SOL'),
            transaction('sig-usdc', 20, usdcMint, 'USDC'),
            transaction('sig-old-sol', 10, nativeSolMint, 'SOL'),
          ],
          'wallet-history-cursor',
        ),
      ],
    });

    expect(page?.transactions.map((item) => item.signature)).toEqual([
      'sig-new-sol',
      'sig-old-sol',
    ]);
    expect(page?.cursor).toBe('wallet-history-cursor');
  });

  it('uses the last included signature when warm matches exceed the page limit', () => {
    const page = buildWarmTokenTransactionsPage({
      walletAddress,
      network: 'devnet',
      mint: nativeSolMint,
      limit: 2,
      pages: [
        walletHistoryPage(
          [
            transaction('sig-3', 30, nativeSolMint, 'SOL'),
            transaction('sig-2', 20, nativeSolMint, 'SOL'),
            transaction('sig-1', 10, nativeSolMint, 'SOL'),
          ],
          null,
        ),
      ],
    });

    expect(page?.transactions.map((item) => item.signature)).toEqual(['sig-3', 'sig-2']);
    expect(page?.cursor).toBe('sig-2');
  });

  it('does not invent a cursor when the source wallet history is exhausted', () => {
    const page = buildWarmTokenTransactionsPage({
      walletAddress,
      network: 'devnet',
      mint: nativeSolMint,
      limit: 3,
      pages: [
        walletHistoryPage(
          [
            transaction('sig-new-sol', 30, nativeSolMint, 'SOL'),
            transaction('sig-old-sol', 10, nativeSolMint, 'SOL'),
          ],
          null,
        ),
      ],
    });

    expect(page?.cursor).toBeNull();
  });
});
