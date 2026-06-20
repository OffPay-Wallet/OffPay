import {
  buildStablecoinMetadataLookup,
  buildWalletHistoryGroups,
  buildWalletRecentActivityItems,
  buildVisibleTokenHoldings,
  getUmbraWalletActivityType,
  groupLocalReceiptsByDate,
  groupWalletTransactionsByDate,
  isDisplayableWalletActivityEvent,
  isDisplayableWalletPaymentTransaction,
  isWalletActivityIncomingP2pTransfer,
  isWalletTransactionIncomingP2pTransfer,
  mapLocalReceiptForRecentActivity,
  mapWalletActivityEventForRecentActivity,
  mapWalletTransactionForHistory,
  mapWalletTransactionForRecentActivity,
  shortenWalletAddress,
  walletHistoryTransactionMatchesTokenFilter,
  walletTransactionMatchesTokenFilter,
} from '@/lib/api/offpay-wallet-data';

import type {
  WalletActivityEvent,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

const signature =
  '5r9jzD8fHa9eG4vAMcYQYV5spwG9R4VuYH9zJm7DYd6m8uDj7b4hyY3TwY2Nv4R8ydh7v7FGM5h7EJYvVx3sN4fQ';
const nativeSolMint = 'So11111111111111111111111111111111111111112';

function buildTransaction(
  overrides: Partial<WalletTransactionsResponse['transactions'][number]> = {},
): WalletTransactionsResponse['transactions'][number] {
  return {
    signature,
    timestamp: 1_713_996_000,
    type: 'TRANSFER',
    description: 'Sent 0.33517 USDC to test wallet',
    fee: 5_000,
    status: 'success',
    counterparties: [],
    ...overrides,
  };
}

function buildActivityEvent(overrides: Partial<WalletActivityEvent> = {}): WalletActivityEvent {
  return {
    signature,
    timestamp: 1_713_996_000,
    type: 'TRANSFER',
    description: 'Received 2 BONK from test wallet',
    ...overrides,
  };
}

describe('offpay-wallet-data', () => {
  it('does not match token transfers to SOL details just because SOL paid the network fee', () => {
    const transaction = buildTransaction({
      description: 'Sent 2 USDC to test wallet',
      amount: null,
      rawAmount: null,
      tokenMint: null,
      tokenSymbol: null,
      direction: 'send',
      fee: 41_800,
    });

    expect(
      walletTransactionMatchesTokenFilter(transaction, {
        mint: nativeSolMint,
        symbol: 'SOL',
      }),
    ).toBe(false);
  });

  it('does not match fee-only SOL descriptions to SOL details', () => {
    const transaction = buildTransaction({
      description: 'Fee 0.0000418 SOL',
      amount: null,
      rawAmount: null,
      tokenMint: null,
      tokenSymbol: null,
      direction: 'send',
      fee: 41_800,
    });

    expect(
      walletTransactionMatchesTokenFilter(transaction, {
        mint: nativeSolMint,
        symbol: 'SOL',
      }),
    ).toBe(false);
  });

  it('matches native SOL transfers in SOL details when the provider omits token metadata', () => {
    const transaction = buildTransaction({
      description: 'Native token transfer',
      amount: null,
      rawAmount: null,
      tokenMint: null,
      tokenSymbol: null,
      direction: 'send',
    });

    expect(
      walletTransactionMatchesTokenFilter(transaction, {
        mint: nativeSolMint,
        symbol: 'SOL',
      }),
    ).toBe(true);
  });

  it('matches explicit native SOL token metadata in SOL details', () => {
    const transaction = buildTransaction({
      description: null,
      amount: null,
      rawAmount: null,
      tokenMint: nativeSolMint,
      tokenSymbol: 'SOL',
    });

    expect(
      walletTransactionMatchesTokenFilter(transaction, {
        mint: 'native-sol',
        symbol: 'SOL',
      }),
    ).toBe(true);
  });

  it('uses configured token metadata when the provider only returns the mint', () => {
    const balance: WalletBalanceResponse = {
      address: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
      network: 'devnet',
      solBalance: 0,
      tokens: [
        {
          mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          name: '4zMM...ncDU',
          symbol: '4zMM...ncDU',
          logo: null,
          balance: '12.999',
          decimals: 6,
          usdPrice: 1,
          verified: false,
          spam: false,
        },
      ],
      fetchedAt: 1,
    };

    const metadata = buildStablecoinMetadataLookup([
      {
        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        enabled: true,
      },
    ]);
    const holdings = buildVisibleTokenHoldings(balance, undefined, metadata);
    expect(holdings[1]).toMatchObject({
      name: 'USD Coin',
      symbol: 'USDC',
      priceSymbol: 'USDC',
      usdPrice: 1,
      verified: true,
      spam: false,
    });
    expect(holdings[1]?.balance).toBe('12.999');
  });

  it('uses Umbra devnet token metadata and logos for holdings', () => {
    const balance: WalletBalanceResponse = {
      address: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
      network: 'devnet',
      solBalance: 0,
      tokens: [
        {
          mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          name: '4oG4...NDx7',
          symbol: '4oG4...NDx7',
          logo: null,
          balance: '2000',
          decimals: 6,
          verified: false,
          spam: false,
        },
      ],
      fetchedAt: 1,
    };

    const holdings = buildVisibleTokenHoldings(balance);

    expect(holdings[1]).toMatchObject({
      name: 'Devnet USDC (Umbra test)',
      symbol: 'dUSDC',
      priceSymbol: 'USDC',
      logo: expect.stringContaining('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      verified: true,
      spam: false,
    });
    expect(holdings[1]?.balance).toBe('2,000');
  });

  it('uses provider native SOL price when DAS returns one', () => {
    const balance: WalletBalanceResponse = {
      address: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
      network: 'devnet',
      solBalance: 5_000_000_000,
      nativeSolUsdPrice: 85.12,
      tokens: [],
      fetchedAt: 1,
    };

    const holdings = buildVisibleTokenHoldings(balance);

    expect(holdings[0]).toMatchObject({
      name: 'Solana',
      symbol: 'SOL',
      priceSymbol: 'SOL',
      usdPrice: 85.12,
      verified: true,
      spam: false,
    });
    expect(holdings[0]?.balance).toBe('5');
  });

  it('maps recent activity into compact labels instead of full hashes', () => {
    const view = mapWalletTransactionForRecentActivity(buildTransaction());

    expect(view.title).toBe('Sent');
    expect(view.amountLabel).toBe('-0.33517 USDC');
    expect(view.subtitle).toBe(`Tx ${signature.slice(0, 4)}...${signature.slice(-4)}`);
  });

  it('keeps swap rows from rendering as p2p sends when the indexer includes a direction', () => {
    const swapLeg = buildTransaction({
      type: 'SWAP',
      description: null,
      amount: '0.007454',
      rawAmount: '7454',
      tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenLogo: 'https://example.com/usdc.png',
      tokenDecimals: 6,
      direction: 'send',
      recipient: 'ebh8nG4FGcbk1mFr7KiRsew6nRF7zQ6ESrYYsnf1VUj',
      counterparties: [
        {
          address: 'ebh8nG4FGcbk1mFr7KiRsew6nRF7zQ6ESrYYsnf1VUj',
          role: 'recipient',
        },
      ],
    });
    const recentView = mapWalletTransactionForRecentActivity(swapLeg);
    const historyView = mapWalletTransactionForHistory(swapLeg);

    expect(recentView).toMatchObject({
      type: 'swap',
      title: 'Swapped',
      amountLabel: '-0.007454 USDC',
      amountTone: 'negative',
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
    });
    expect(recentView.subtitle).not.toMatch(/^To /);
    expect(historyView).toMatchObject({
      type: 'swap',
      title: 'Swapped',
      amountLabel: '-0.007454 USDC',
    });
  });

  it('does not classify swap activity as incoming p2p notifications', () => {
    const transaction = buildTransaction({
      type: 'JUPITER_SWAP',
      description: null,
      amount: '1',
      tokenSymbol: 'USDC',
      direction: 'receive',
    });
    const event = buildActivityEvent({
      type: 'JUPITER_SWAP',
      description: null,
      amount: '1',
      tokenSymbol: 'USDC',
      direction: 'receive',
    });

    expect(mapWalletTransactionForRecentActivity(transaction)).toMatchObject({
      type: 'swap',
      title: 'Swapped',
    });
    expect(mapWalletActivityEventForRecentActivity(event)).toMatchObject({
      type: 'swap',
      title: 'Swapped',
    });
    expect(isWalletTransactionIncomingP2pTransfer(transaction)).toBe(false);
    expect(isWalletActivityIncomingP2pTransfer(event)).toBe(false);
  });

  it('uses the recipient counterparty for sent p2p transfer subtitles', () => {
    const view = mapWalletTransactionForRecentActivity(
      buildTransaction({
        counterparties: [
          {
            address: 'FWz4zbrhzEfBoPdWquP8ypWJVdNmswrLemGEJ2yJ3j6i',
            role: 'sender',
          },
          {
            address: 'GDxgRFZPcrrUBekJx4SgDFSLkyGTPM8xdjQ8bbjypszD',
            role: 'recipient',
          },
        ],
      }),
    );

    expect(view.subtitle).toBe('To GDxg...pszD');
  });

  it('uses the sender counterparty for received p2p transfer subtitles', () => {
    const view = mapWalletTransactionForRecentActivity(
      buildTransaction({
        description: 'Received 0.33517 USDC from test wallet',
        counterparties: [
          {
            address: 'GDxgRFZPcrrUBekJx4SgDFSLkyGTPM8xdjQ8bbjypszD',
            role: 'recipient',
          },
          {
            address: 'FWz4zbrhzEfBoPdWquP8ypWJVdNmswrLemGEJ2yJ3j6i',
            role: 'sender',
          },
        ],
      }),
    );

    expect(view.subtitle).toBe('From FWz4...3j6i');
  });

  it('carries explicit token metadata into history rows for non-stablecoin transfers', () => {
    const groups = groupWalletTransactionsByDate([
      buildTransaction({
        description: 'Sent 0.1 SOL to test wallet',
        tokenMint: 'native-sol',
        tokenSymbol: 'SOL',
        tokenName: 'Solana',
        tokenLogo: 'https://example.com/sol.png',
      }),
    ]);

    expect(groups[0]?.data[0]).toMatchObject({
      amountLabel: '-0.1 SOL',
      tokenMint: nativeSolMint,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
      tokenLogo: 'https://example.com/sol.png',
    });
  });

  it('maps native SOL history rows from raw lamports when the provider omits symbols', () => {
    const view = mapWalletTransactionForHistory(
      buildTransaction({
        type: 'TRANSFER',
        description: null,
        amount: null,
        rawAmount: '1000000000',
        direction: 'receive',
        sender: 'FWz4zbrhzEfBoPdWquP8ypWJVdNmswrLemGEJ2yJ3j6i',
        recipient: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
        tokenMint: nativeSolMint,
        tokenSymbol: null,
        tokenName: null,
        tokenLogo: null,
        tokenDecimals: 9,
      }),
    );

    expect(view).toMatchObject({
      title: 'Received',
      amountLabel: '+1 SOL',
      amountTone: 'positive',
      tokenMint: nativeSolMint,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
    });
  });

  it('filters SOL token details from mapped history rows with accurate detail fields', () => {
    const recipient = 'FWz4zbrhzEfBoPdWquP8ypWJVdNmswrLemGEJ2yJ3j6i';
    const usdcSignature = `${signature}usdc`;
    const solSignature = `${signature}sol`;
    const rows = buildWalletHistoryGroups({
      network: 'devnet',
      transactions: [
        buildTransaction({
          signature: usdcSignature,
          type: 'TOKEN_TRANSFER',
          description: 'Sent 2 USDC to test wallet',
          amount: '2',
          rawAmount: null,
          direction: 'send',
          recipient,
          tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          tokenDecimals: 6,
        }),
        buildTransaction({
          signature: solSignature,
          type: 'TRANSFER',
          description: null,
          amount: null,
          rawAmount: '200000000',
          direction: 'send',
          sender: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
          recipient,
          tokenMint: nativeSolMint,
          tokenSymbol: null,
          tokenName: null,
          tokenDecimals: 9,
        }),
      ],
    }).flatMap((group) => group.data);

    const solRows = rows.filter((row) =>
      walletHistoryTransactionMatchesTokenFilter(row, {
        mint: 'native-sol',
        symbol: 'SOL',
      }),
    );

    expect(solRows).toHaveLength(1);
    expect(solRows[0]).toMatchObject({
      id: solSignature,
      title: 'Sent',
      amountLabel: '-0.2 SOL',
      detailAccountLabel: 'To',
      detailAccountAddress: recipient,
      detailNetwork: 'devnet',
      detailSignature: solSignature,
      tokenMint: nativeSolMint,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
    });
  });

  it('infers incoming non-stablecoin history from sender counterparties', () => {
    const view = mapWalletTransactionForHistory(
      buildTransaction({
        description: '0.01 SOL sent to this wallet',
        tokenMint: 'native-sol',
        tokenSymbol: 'SOL',
        tokenName: 'Solana',
        counterparties: [
          {
            address: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
            role: 'sender',
          },
        ],
      }),
    );

    expect(view).toMatchObject({
      title: 'Received',
      amountLabel: '+0.01 SOL',
      amountTone: 'positive',
      tokenSymbol: 'SOL',
    });
  });

  it('maps incoming non-stablecoin stream events with token metadata', () => {
    const event = buildActivityEvent({
      description: null,
      amount: '0.01',
      tokenMint: 'native-sol',
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
      direction: 'receive',
    });
    const view = mapWalletActivityEventForRecentActivity(event);

    expect(isWalletActivityIncomingP2pTransfer(event)).toBe(true);
    expect(view).toMatchObject({
      title: 'Received',
      amountLabel: '+0.01 SOL',
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
    });
  });

  it('maps native SOL stream events from raw lamports when the provider omits symbols', () => {
    const event = buildActivityEvent({
      description: null,
      amount: null,
      rawAmount: '250000000',
      tokenMint: nativeSolMint,
      tokenSymbol: null,
      tokenName: null,
      tokenLogo: null,
      tokenDecimals: 9,
      direction: 'send',
    });
    const view = mapWalletActivityEventForRecentActivity(event);

    expect(isDisplayableWalletActivityEvent(event)).toBe(true);
    expect(view).toMatchObject({
      title: 'Sent',
      amountLabel: '-0.25 SOL',
      amountTone: 'negative',
      tokenMint: nativeSolMint,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
    });
  });

  it('filters unenriched unknown stream events instead of notifying placeholders', () => {
    const event = buildActivityEvent({
      type: 'unknown',
      description: 'Unknown',
      amount: null,
      rawAmount: null,
      direction: null,
      sender: null,
      recipient: null,
      tokenMint: null,
      tokenSymbol: null,
      tokenName: null,
      tokenLogo: null,
      tokenDecimals: null,
      counterparties: [],
    });

    expect(isDisplayableWalletActivityEvent(event)).toBe(false);
    expect(isWalletActivityIncomingP2pTransfer(event)).toBe(false);
  });

  it('filters direction-only backend rows until amount metadata or a local receipt is available', () => {
    const transaction = buildTransaction({
      type: 'unknown',
      description: null,
      amount: null,
      rawAmount: null,
      direction: 'send',
      sender: null,
      recipient: null,
      tokenMint: null,
      tokenSymbol: null,
      tokenName: null,
      tokenLogo: null,
      tokenDecimals: null,
      counterparties: [],
    });

    expect(isDisplayableWalletPaymentTransaction(transaction)).toBe(false);
    expect(buildWalletRecentActivityItems({ transactions: [transaction] })).toEqual([]);
  });

  it('enriches backend history rows with matching local offline receipt data', () => {
    const view = mapWalletTransactionForHistory(
      buildTransaction({
        description: null,
        tokenMint: null,
        tokenSymbol: null,
        tokenName: null,
        tokenLogo: null,
        counterparties: [
          {
            address: 'FWz4zbrhzEfBoPdWquP8ypWJVdNmswrLemGEJ2yJ3j6i',
            role: 'recipient',
          },
        ],
      }),
      {
        id: 'offline-send-mainnet-offline-tx-1',
        direction: 'send',
        status: 'settled',
        title: 'Payment settled',
        subtitle: 'To FWz4...3j6i',
        amountLabel: '-0.2 USDC',
        tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        tokenSymbol: 'USDC',
        tokenName: 'USD Coin',
        tokenLogo: 'https://example.com/usdc.png',
        createdAt: 1_713_996_000_000,
        signature,
      },
    );

    expect(view).toMatchObject({
      amountLabel: '-0.2 USDC',
      amountTone: 'negative',
      tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
    });
  });

  it('renders received on-chain rows from explicit indexer fields without local receipts', () => {
    const stealthSender = 'Hq3cgpbHV1Hsq3cZKaWDyHhXzHq7veKf5D5eGX2Ujqq3';
    const rows = buildWalletHistoryGroups({
      transactions: [
        buildTransaction({
          type: 'UNKNOWN',
          description: null,
          amount: '1',
          rawAmount: '1000000',
          direction: 'receive',
          sender: stealthSender,
          recipient: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
          tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          tokenLogo: 'https://example.com/usdc.png',
          tokenDecimals: 6,
          counterparties: [],
        }),
      ],
    }).flatMap((group) => group.data);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: signature,
      title: 'Received',
      subtitle: `From ${shortenWalletAddress(stealthSender)}`,
      amountLabel: '+1 USDC',
      amountTone: 'positive',
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
    });
  });

  it('renders lowercase unknown rows when they contain on-chain payment fields', () => {
    const stealthSender = 'Hq3cgpbHV1Hsq3cZKaWDyHhXzHq7veKf5D5eGX2Ujqq3';
    const rows = buildWalletHistoryGroups({
      transactions: [
        buildTransaction({
          type: 'unknown',
          description: null,
          amount: '5',
          rawAmount: '5000000',
          direction: 'receive',
          sender: stealthSender,
          recipient: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
          tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          tokenLogo: 'https://example.com/usdc.png',
          tokenDecimals: 6,
          counterparties: [],
        }),
      ],
    }).flatMap((group) => group.data);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: signature,
      title: 'Received',
      subtitle: `From ${shortenWalletAddress(stealthSender)}`,
      amountLabel: '+5 USDC',
      amountTone: 'positive',
      tokenSymbol: 'USDC',
    });
  });

  it('filters unenriched unknown rows instead of rendering syncing placeholders', () => {
    const transferSignature = `${signature}transfer`;
    const transactions = [
      buildTransaction({
        signature: `${signature}unknown`,
        type: 'unknown',
        description: null,
        amount: null,
        rawAmount: null,
        direction: null,
        sender: null,
        recipient: null,
        tokenMint: null,
        tokenSymbol: null,
        tokenName: null,
        tokenLogo: null,
        tokenDecimals: null,
        counterparties: [],
      }),
      buildTransaction({
        signature: transferSignature,
        type: 'TOKEN_TRANSFER',
        description: 'Sent 1 USDC',
      }),
    ];

    const historyRows = buildWalletHistoryGroups({ transactions }).flatMap((group) => group.data);
    const recentRows = buildWalletRecentActivityItems({ transactions });

    expect(historyRows.map((row) => row.id)).toEqual([transferSignature]);
    expect(recentRows.map((row) => row.id)).toEqual([transferSignature]);
    expect(historyRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Activity',
          subtitle: 'Syncing details...',
        }),
      ]),
    );
  });

  it('filters Umbra setup rows from payment history and live notifications', () => {
    const setupTransaction = buildTransaction({
      type: 'umbra_setup',
      description: 'Umbra private account setup',
      amount: null,
      rawAmount: '5000',
      direction: 'send',
      tokenMint: nativeSolMint,
      tokenSymbol: null,
      tokenName: null,
      tokenDecimals: 9,
    });
    const setupEvent = buildActivityEvent({
      type: 'umbra_setup',
      description: 'Umbra private account setup',
      amount: null,
      rawAmount: '5000',
      direction: 'send',
      tokenMint: nativeSolMint,
      tokenSymbol: null,
      tokenName: null,
      tokenDecimals: 9,
    });

    expect(isDisplayableWalletPaymentTransaction(setupTransaction)).toBe(false);
    expect(isDisplayableWalletActivityEvent(setupEvent)).toBe(false);
    expect(buildWalletHistoryGroups({ transactions: [setupTransaction] })).toEqual([]);
    expect(buildWalletRecentActivityItems({ transactions: [setupTransaction] })).toEqual([]);
  });

  it('classifies Umbra stream events before the generic sent fallback', () => {
    expect(
      getUmbraWalletActivityType(
        buildActivityEvent({
          type: 'UMBRA_CLAIM',
          description: 'Claimed private payment into encrypted balance',
          amount: null,
          rawAmount: null,
        }),
      ),
    ).toBe('claim');

    expect(
      getUmbraWalletActivityType(
        buildActivityEvent({
          type: 'PUBLIC_BALANCE_TO_ENCRYPTED_BALANCE',
          description: 'Umbra shield 4 dUSDC',
          amount: '4',
          tokenSymbol: 'dUSDC',
        }),
      ),
    ).toBe('shield');

    expect(
      getUmbraWalletActivityType(
        buildActivityEvent({
          type: 'ENCRYPTED_BALANCE_TO_PUBLIC_BALANCE',
          description: 'Umbra withdraw 4 dUSDC',
          amount: '4',
          tokenSymbol: 'dUSDC',
        }),
      ),
    ).toBe('withdraw');
  });

  it('does not classify regular transfers as Umbra activity', () => {
    expect(
      getUmbraWalletActivityType(
        buildActivityEvent({
          type: 'TOKEN_TRANSFER',
          description: 'Sent 4 USDC to recipient',
          amount: '4',
          tokenSymbol: 'USDC',
          direction: 'send',
        }),
      ),
    ).toBeNull();
  });

  it('keeps offline p2p receipt enrichment but ignores online local receipts', () => {
    const stealthSender = 'Hq3cgpbHV1Hsq3cZKaWDyHhXzHq7veKf5D5eGX2Ujqq3';
    const transactions = [
      buildTransaction({
        description: null,
        tokenMint: null,
        tokenSymbol: null,
        tokenName: null,
        tokenLogo: null,
        counterparties: [
          {
            address: stealthSender,
            role: 'sender',
          },
        ],
      }),
    ];
    const localReceipts = [
      {
        id: `online-send-devnet-${signature}`,
        direction: 'send' as const,
        status: 'settled' as const,
        title: 'Payment sent',
        subtitle: 'To CBbA...okMk',
        amountLabel: '-1 USDC',
        tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        tokenSymbol: 'USDC',
        tokenName: 'USD Coin',
        tokenLogo: 'https://example.com/usdc.png',
        createdAt: 1_713_996_000_000,
        signature,
        recipient: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
        privacyLabel: 'Private route',
      },
      {
        id: `offline-receive-devnet-${signature}`,
        direction: 'receive' as const,
        status: 'settled' as const,
        title: 'Payment received',
        subtitle: 'From offline wallet',
        amountLabel: '+1 USDC',
        tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        tokenSymbol: 'USDC',
        tokenName: 'USD Coin',
        tokenLogo: 'https://example.com/usdc.png',
        createdAt: 1_713_996_000_000,
        signature,
        sender: stealthSender,
        recipient: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
      },
    ];

    const recentRows = buildWalletRecentActivityItems({
      transactions,
      localReceipts,
    });
    const historyRows = buildWalletHistoryGroups({
      transactions,
      localReceipts,
    }).flatMap((group) => group.data);

    expect(recentRows).toHaveLength(1);
    expect(historyRows).toHaveLength(1);
    expect(recentRows[0]).toMatchObject({
      id: signature,
      title: 'Received',
      subtitle: `From ${shortenWalletAddress(stealthSender)}`,
      amountLabel: '+1 USDC',
      amountTone: 'positive',
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
      sourceLabel: 'Offline P2P',
    });
    expect(historyRows[0]).toMatchObject({
      id: signature,
      title: 'Received',
      subtitle: `From ${shortenWalletAddress(stealthSender)}`,
      amountLabel: '+1 USDC',
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
      sourceLabel: 'Offline P2P',
    });
  });

  it('suppresses unmatched local receipt rows without losing receipt enrichment', () => {
    const unmatchedReceiptId = 'offline-receive-devnet-local-only';
    const transactions = [
      buildTransaction({
        description: null,
        tokenMint: null,
        tokenSymbol: null,
        counterparties: [
          { address: 'Hq3cgpbHV1Hsq3cZKaWDyHhXzHq7veKf5D5eGX2Ujqq3', role: 'sender' },
        ],
      }),
    ];
    const localReceipts = [
      {
        id: `offline-receive-devnet-${signature}`,
        direction: 'receive' as const,
        status: 'settled' as const,
        title: 'Payment received',
        subtitle: 'From this wallet',
        amountLabel: '+1 USDC',
        tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        tokenSymbol: 'USDC',
        tokenLogo: 'https://example.com/usdc.png',
        createdAt: 1_713_996_000_000,
        signature,
        privacyLabel: 'Private route',
      },
      {
        id: unmatchedReceiptId,
        direction: 'receive' as const,
        status: 'received' as const,
        title: 'Payment received',
        subtitle: 'From local only',
        amountLabel: '+2 USDC',
        tokenSymbol: 'USDC',
        createdAt: 1_713_995_000_000,
        signature: null,
      },
    ];

    const recentRows = buildWalletRecentActivityItems({
      transactions,
      localReceipts,
      includeUnmatchedLocalReceipts: false,
    });
    const historyRows = buildWalletHistoryGroups({
      transactions,
      localReceipts,
      includeUnmatchedLocalReceipts: false,
    }).flatMap((group) => group.data);

    expect(recentRows.map((row) => row.id)).toEqual([signature]);
    expect(historyRows.map((row) => row.id)).toEqual([signature]);
    expect(recentRows[0]).toMatchObject({
      amountLabel: '+1 USDC',
      tokenLogo: 'https://example.com/usdc.png',
      sourceLabel: 'Offline P2P',
    });
  });

  it('groups history rows by formatted day title', () => {
    const groups = groupWalletTransactionsByDate([
      buildTransaction({ timestamp: 1_713_996_000 }),
      buildTransaction({ signature: `${signature}1`, timestamp: 1_713_996_000 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.data).toHaveLength(2);
  });

  it('orders wallet history with the newest on-chain transaction first', () => {
    const olderSignature = `${signature}older`;
    const newerSignature = `${signature}newer`;
    const groups = groupWalletTransactionsByDate([
      buildTransaction({ signature: olderSignature, timestamp: 1_713_996_000 }),
      buildTransaction({ signature: newerSignature, timestamp: 1_713_996_120 }),
    ]);

    expect(groups[0]?.data.map((item) => item.id)).toEqual([newerSignature, olderSignature]);
  });

  it('filters internal commit-state records from wallet history', () => {
    const transferSignature = `${signature}transfer`;
    const groups = buildWalletHistoryGroups({
      transactions: [
        buildTransaction({
          signature: `${signature}commit`,
          type: 'commit_state',
          description: 'Commit private payment state',
          tokenMint: null,
          tokenSymbol: null,
          counterparties: [
            {
              address: 'FWz4zbrhzEfBoPdWquP8ypWJVdNmswrLemGEJ2yJ3j6i',
              role: 'recipient',
            },
          ],
        }),
        buildTransaction({
          signature: transferSignature,
          type: 'TOKEN_TRANSFER',
          description: 'Sent 1 USDC',
        }),
      ],
    });

    expect(
      isDisplayableWalletPaymentTransaction(
        buildTransaction({ type: 'commit_state', description: 'Commit private payment state' }),
      ),
    ).toBe(false);
    expect(groups.flatMap((group) => group.data).map((item) => item.id)).toEqual([
      transferSignature,
    ]);
  });

  it('keeps settled offline receipts when the indexed record is internal-only', () => {
    const settledSignature = `${signature}settled`;
    const groups = buildWalletHistoryGroups({
      transactions: [
        buildTransaction({
          signature: settledSignature,
          type: 'commit_state',
          description: 'Commit private payment state',
        }),
      ],
      localReceipts: [
        {
          id: 'offline-receive-devnet-tx-1',
          direction: 'receive',
          status: 'settled',
          title: 'Payment received',
          subtitle: 'From CBbA...okMk',
          amountLabel: '+1 USDC',
          tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          tokenLogo: 'https://example.com/usdc.png',
          createdAt: 1_713_996_000_000,
          signature: settledSignature,
        },
      ],
    });
    const rows = groups.flatMap((group) => group.data);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'offline-receive-devnet-tx-1',
      title: 'Received',
      amountLabel: '+1 USDC',
      tokenLogo: 'https://example.com/usdc.png',
    });
  });

  it('shows Yuga private send receipts with a Yuga source label', () => {
    const groups = buildWalletHistoryGroups({
      transactions: [],
      localReceipts: [
        {
          id: 'agentic-private-send-devnet-local-1',
          direction: 'send',
          status: 'queued',
          title: 'Yuga transfer',
          subtitle: 'To CBbA...okMk',
          amountLabel: '-1 USDC',
          tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          createdAt: 1_713_996_000_000,
          signature: null,
          recipient: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
          routeLabel: 'Yuga Transfer',
          privacyLabel: 'Private route',
          programLabel: 'MagicBlock',
        },
      ],
    });
    const rows = groups.flatMap((group) => group.data);

    expect(groups[0]?.title).toBe('Queued');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Sent',
      sourceLabel: 'Yuga Transfer',
      amountLabel: '-1 USDC',
      status: 'pending',
    });
  });

  it('uses the same payment-only filter for recent activity', () => {
    const items = buildWalletRecentActivityItems({
      transactions: [
        buildTransaction({
          signature: `${signature}commit`,
          type: 'commit_state',
          description: 'Commit private payment state',
        }),
      ],
    });

    expect(items).toEqual([]);
  });

  it('shows queued offline sends as pending debit activity', () => {
    const view = mapLocalReceiptForRecentActivity({
      id: 'offline-send-1',
      direction: 'send',
      status: 'queued',
      title: 'Payment queued',
      subtitle: 'To CBbA...okMk',
      amountLabel: '-1 USDC',
      tokenSymbol: 'USDC',
      createdAt: 1_713_996_000_000,
    });

    expect(view.type).toBe('send');
    expect(view.title).toBe('Sent');
    expect(view.status).toBe('pending');
    expect(view.amountTone).toBe('negative');
    expect(view.secondaryAmountLabel).toBe('Queued offline');
  });

  it('keeps queued local receipts in a dedicated history section', () => {
    const groups = groupLocalReceiptsByDate([
      {
        id: 'offline-send-1',
        direction: 'send',
        status: 'queued',
        title: 'Payment queued',
        subtitle: 'To CBbA...okMk',
        amountLabel: '-1 USDC',
        tokenSymbol: 'USDC',
        createdAt: 1_713_996_000_000,
      },
    ]);

    expect(groups[0]?.title).toBe('Queued');
    expect(groups[0]?.data[0]?.amountLabel).toBe('-1 USDC');
  });

  it('classifies incoming p2p transfers without treating swaps as incoming payments', () => {
    expect(
      isWalletTransactionIncomingP2pTransfer(
        buildTransaction({ description: 'Received 2 BONK from test wallet' }),
      ),
    ).toBe(true);
    expect(
      isWalletTransactionIncomingP2pTransfer(
        buildTransaction({ description: 'Swapped 1 USDC to 0.01 SOL on Jupiter' }),
      ),
    ).toBe(false);
    expect(
      isWalletActivityIncomingP2pTransfer(
        buildActivityEvent({ description: 'Received 5 USDT from test wallet' }),
      ),
    ).toBe(true);
    expect(
      isWalletActivityIncomingP2pTransfer(
        buildActivityEvent({ description: 'Swapped 5 USDT to 5 USDC' }),
      ),
    ).toBe(false);
  });

  it('renders swap transactions as swaps instead of received transfers', () => {
    const view = mapWalletTransactionForRecentActivity(
      buildTransaction({
        type: 'SWAP',
        description: 'Swapped 0.002688 SOL to 0.238527 USDC via JupiterZ',
        tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        tokenSymbol: 'USDC',
        tokenName: 'USD Coin',
        counterparties: [{ address: 'Bukt7Ug5', role: 'sender' }],
      }),
    );

    expect(view).toMatchObject({
      type: 'swap',
      title: 'Swapped',
      subtitle: '0.002688 SOL to 0.238527 USDC',
      amountLabel: '+0.238527 USDC',
      secondaryAmountLabel: '-0.002688 SOL',
      amountTone: 'positive',
    });
  });
});
