import {
  classifySendFailure,
  getRecipientStepDisabledReason,
  resolveCachedTokenLogo,
} from '@/components/features/private-payment/send-flow/helpers';
import type { SendTokenOption } from '@/components/features/private-payment/send-flow/types';

const sendToken: SendTokenOption = {
  mint: 'So11111111111111111111111111111111111111112',
  name: 'USD Coin',
  symbol: 'USDC',
  logo: null,
  balance: '10',
  decimals: 6,
  verified: true,
  privateSupported: true,
};

describe('send flow helpers', () => {
  it('allows recipient input after wallet, network, and token are selected', () => {
    expect(
      getRecipientStepDisabledReason({
        walletAddress: '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ',
        walletId: 'wallet-1',
        network: 'devnet',
        unsupportedReason: null,
        selectedToken: sendToken,
      }),
    ).toBeNull();
  });

  it('keeps recipient input blocked until a wallet is unlocked', () => {
    expect(
      getRecipientStepDisabledReason({
        walletAddress: null,
        walletId: 'wallet-1',
        network: 'devnet',
        unsupportedReason: null,
        selectedToken: sendToken,
      }),
    ).toBe('Unlock a wallet before sending.');
  });

  it('keeps recipient input blocked on unsupported networks', () => {
    expect(
      getRecipientStepDisabledReason({
        walletAddress: '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ',
        walletId: 'wallet-1',
        network: null,
        unsupportedReason: 'Unsupported cluster.',
        selectedToken: sendToken,
      }),
    ).toBe('Unsupported cluster.');
  });

  it('classifies explicit user rejection as cancelled', () => {
    expect(classifySendFailure(new Error('User rejected the signing request.'))).toMatchObject({
      variant: 'cancelled',
      title: 'Send cancelled',
      statusLabel: 'Cancelled',
    });
  });

  it('classifies wallet-side signing interruptions as errors', () => {
    expect(classifySendFailure(new Error('MFA verification was canceled'))).toMatchObject({
      variant: 'error',
      title: 'Wallet signing interrupted',
      statusLabel: 'Signing failed',
    });
  });

  it('classifies timed out private payment errors as network failures', () => {
    expect(classifySendFailure(new Error('Private payment timed out'))).toMatchObject({
      variant: 'error',
      title: 'Network issue',
      statusLabel: 'Network failed',
    });
  });

  it('classifies native Android fetch cancellation as a network failure', () => {
    expect(
      classifySendFailure(new Error('fetch failed: Fetch request has been canceled')),
    ).toMatchObject({
      variant: 'error',
      title: 'Network issue',
      statusLabel: 'Network failed',
    });
  });

  it('keeps an already cached API logo ahead of a later token-row logo', () => {
    expect(
      resolveCachedTokenLogo({
        mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
        symbol: 'dUSDT',
        apiLogo: 'https://api.example/fresh-dusdt.svg',
        logos: {
          byMint: new Map([
            [
              'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
              'https://api.example/cached-dusdt.png',
            ],
          ]),
          bySymbol: new Map(),
        },
      }),
    ).toBe('https://api.example/cached-dusdt.png');
  });
});
