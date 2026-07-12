import {
  buildRwaProcessResult,
  formatRwaChangeLabel,
} from '@/components/features/rwa/rwa-trade-utils';

import type { RwaQuoteReviewState } from '@/components/features/rwa/rwa-trade-utils';
import type { RwaAsset, RwaQuoteResponse } from '@/types/offpay-api';

describe('RWA card formatting', () => {
  it('formats direction with a visible sign and compact precision', () => {
    expect(formatRwaChangeLabel(1.256)).toBe('+1.26%');
    expect(formatRwaChangeLabel(-0.2349)).toBe('-0.235%');
    expect(formatRwaChangeLabel(-0)).toBe('0%');
  });

  it('omits unavailable or invalid movement values', () => {
    expect(formatRwaChangeLabel(null)).toBeNull();
    expect(formatRwaChangeLabel(Number.NaN)).toBeNull();
    expect(formatRwaChangeLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it.each(['buy', 'sell'] as const)(
    'preserves the completed %s draft for the trade-again CTA',
    (side) => {
      const review = {
        asset: {
          id: 'spcxd',
          symbol: 'SPCXd',
          name: 'SpaceX Sandbox RWA',
          devnetSandbox: true,
          settlementSymbol: 'USDC',
          logo: null,
          underlyingSymbol: 'SPCX',
        } as RwaAsset,
        side,
        inputAmount: side === 'buy' ? '25' : '0.1',
        quote: {
          cashAmount: '25',
          quantity: '0.1',
          priceImpactPct: 0,
        } as RwaQuoteResponse,
        network: 'devnet',
        walletAddress: 'wallet',
        walletId: 'wallet-id',
      } satisfies RwaQuoteReviewState;

      expect(buildRwaProcessResult({ review, variant: 'success' }).repeatTradeDraft).toEqual({
        assetId: 'spcxd',
        side,
        amountInput: review.inputAmount,
      });
    },
  );
});
