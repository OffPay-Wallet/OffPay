import type { AdvancedSwapReceipt } from '@/store/advancedSwapStore';
import type { RwaAsset, RwaExecuteResponse } from '@/types/offpay-api';

interface BuildRwaHistoryReceiptParams {
  asset: RwaAsset;
  side: 'buy' | 'sell';
  payAmount: string;
  paySymbol: string;
  receiveAmount: string;
  receiveSymbol: string;
  walletAddress: string;
  execution: RwaExecuteResponse;
  createdAt?: number;
}

export function buildRwaHistoryReceipt({
  asset,
  side,
  payAmount,
  paySymbol,
  receiveAmount,
  receiveSymbol,
  walletAddress,
  execution,
  createdAt = Date.now(),
}: BuildRwaHistoryReceiptParams): AdvancedSwapReceipt {
  const buying = side === 'buy';
  const allSignatures = execution.signatures?.map((step) => step.signature) ?? [];

  return {
    id: `rwa-${side}-${execution.network}-${execution.quoteId}`,
    mode: 'normal',
    activity: buying ? 'rwa_buy' : 'rwa_sell',
    title: buying ? `Bought ${asset.symbol}` : `Sold ${asset.symbol}`,
    subtitle: asset.name,
    signature: execution.signature,
    hiddenSignatures: allSignatures.filter((signature) => signature !== execution.signature),
    network: execution.network,
    walletAddress,
    createdAt,
    input: {
      mint: buying ? asset.settlementMint : asset.mint,
      symbol: paySymbol,
      name: buying ? paySymbol : asset.name,
      logo: buying ? null : asset.logo,
      amountLabel: `-${payAmount} ${paySymbol}`,
    },
    output: {
      mint: buying ? asset.mint : asset.settlementMint,
      symbol: receiveSymbol,
      name: buying ? asset.name : receiveSymbol,
      logo: buying ? asset.logo : null,
      amountLabel: `+${receiveAmount} ${receiveSymbol}`,
    },
  };
}
