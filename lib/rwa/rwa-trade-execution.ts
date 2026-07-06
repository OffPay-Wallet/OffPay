import { executeRwaQuote } from '@/lib/api/offpay-api-client';
import {
  signSerializedTransactionForWallet,
  signSerializedTransactionsForWallet,
} from '@/lib/crypto/solana-transaction-signing';
import { getRwaDevnetSandboxFundingRequirement } from '@/lib/rwa/devnet-sandbox-funding';

import type {
  OffpayNetwork,
  RwaAsset,
  RwaExecuteResponse,
  RwaQuoteResponse,
  WalletBalanceResponse,
} from '@/types/offpay-api';

export type RwaTradeSide = 'buy' | 'sell';

export interface RwaTradeExecutionReview {
  asset: RwaAsset;
  side: RwaTradeSide;
  inputAmount: string;
  quote: RwaQuoteResponse;
  network: OffpayNetwork;
  walletAddress: string;
  walletId: string | null;
}

export interface RwaTradeExecutionResult {
  review: RwaTradeExecutionReview;
  execution: RwaExecuteResponse;
}

export function formatRwaDevnetSandboxBalanceError(
  side: RwaTradeSide,
  requirement: NonNullable<ReturnType<typeof getRwaDevnetSandboxFundingRequirement>>,
): string {
  if (side === 'buy' && requirement.symbol === 'RWAUSDC') {
    return `This Devnet buy needs ${requirement.amount} RWAUSDC; wallet has ${requirement.balanceAmount}. Tap the gift faucet on Home to add RWAUSDC, then retry.`;
  }

  return `This Devnet sell needs ${requirement.amount} ${requirement.symbol}; wallet has ${requirement.balanceAmount}. Buy ${requirement.symbol} first or reduce the sell amount.`;
}

export async function assertRwaTradeFunding(params: {
  review: RwaTradeExecutionReview;
  walletBalance: WalletBalanceResponse | null | undefined;
  refreshWalletBalance?: () => Promise<WalletBalanceResponse | null | undefined>;
}): Promise<void> {
  const getRequirement = (walletBalance = params.walletBalance ?? null) =>
    getRwaDevnetSandboxFundingRequirement({
      asset: params.review.asset,
      inputAmount: params.review.inputAmount,
      network: params.review.network,
      quote: params.review.quote,
      side: params.review.side,
      walletBalance,
    });

  let requirement = getRequirement();
  if (requirement == null || requirement.hasEnough) return;

  if (params.refreshWalletBalance != null) {
    const refreshedBalance = await params.refreshWalletBalance();
    requirement = getRequirement(refreshedBalance ?? params.walletBalance ?? null);
    if (requirement == null || requirement.hasEnough) return;
  }

  throw new Error(formatRwaDevnetSandboxBalanceError(params.review.side, requirement));
}

export async function executeRwaTradeReview(params: {
  review: RwaTradeExecutionReview;
  walletBalance: WalletBalanceResponse | null | undefined;
  refreshWalletBalance?: () => Promise<WalletBalanceResponse | null | undefined>;
}): Promise<RwaTradeExecutionResult> {
  const { review } = params;
  await assertRwaTradeFunding(params);

  const unsignedTransactions = review.quote.unsignedTransactions;
  if (review.network === 'devnet' && unsignedTransactions != null && unsignedTransactions.length > 0) {
    const signedTransactions = await signSerializedTransactionsForWallet({
      unsignedTransactions: unsignedTransactions.map((step) => step.unsignedTransaction),
      walletAddress: review.walletAddress,
      walletId: review.walletId,
    });
    if (signedTransactions.length !== unsignedTransactions.length) {
      throw new Error('RWA wallet signing returned an incomplete MagicBlock transaction sequence.');
    }

    const execution = await executeRwaQuote({
      quoteId: review.quote.quoteId,
      signedTransaction: signedTransactions[0] ?? '',
      signedTransactions: unsignedTransactions.map((step, index) => {
        const signedTransaction = signedTransactions[index];
        if (signedTransaction == null) {
          throw new Error(
            'RWA wallet signing returned an incomplete MagicBlock transaction sequence.',
          );
        }
        return {
          id: step.id,
          target: step.target,
          signedTransaction,
        };
      }),
      network: review.network,
    });

    return { review, execution };
  }

  const signedTransaction = await signSerializedTransactionForWallet({
    unsignedTransaction: review.quote.unsignedTransaction,
    walletAddress: review.walletAddress,
    walletId: review.walletId,
  });
  const execution = await executeRwaQuote({
    quoteId: review.quote.quoteId,
    signedTransaction,
    network: review.network,
  });

  return { review, execution };
}
