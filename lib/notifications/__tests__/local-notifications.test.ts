import { buildWalletTransactionNotificationContent } from '@/lib/notifications/local-notifications';

describe('buildWalletTransactionNotificationContent', () => {
  it('formats received transaction notifications with unsigned amounts', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'receive',
        amountLabel: '+1 USDC',
        secondaryAmountLabel: null,
        subtitle: 'From EiV9...ARjG',
      }),
    ).toEqual({
      title: 'Received 1 USDC',
      body: null,
    });
  });

  it('formats sent transaction notifications with unsigned amounts', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'send',
        amountLabel: '-1 USDC',
        secondaryAmountLabel: null,
        subtitle: 'To EiV9...ARjG',
      }),
    ).toEqual({
      title: 'Sent 1 USDC',
      body: null,
    });
  });

  it('formats native SOL transaction notifications with unsigned amounts', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'receive',
        amountLabel: '+1 SOL',
        secondaryAmountLabel: null,
        subtitle: 'From dev2...oFBJ',
      }),
    ).toEqual({
      title: 'Received 1 SOL',
      body: null,
    });
  });

  it('formats swap transaction notifications with both token legs', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'swap',
        amountLabel: '+12 USDC',
        secondaryAmountLabel: '-0.04 SOL',
        subtitle: '0.04 SOL to 12 USDC',
      }),
    ).toEqual({
      title: 'Swapped 12 USDC',
      body: null,
    });
  });

  it('keeps receive notifications title-only for generic stream subtitles', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'receive',
        amountLabel: '+1 USDC',
        secondaryAmountLabel: null,
        subtitle: 'Unknown',
      }),
    ).toEqual({
      title: 'Received 1 USDC',
      body: null,
    });
  });

  it('keeps sent notifications title-only for generic stream subtitles', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'send',
        amountLabel: '-1 USDC',
        secondaryAmountLabel: null,
        subtitle: 'Unknown',
      }),
    ).toEqual({
      title: 'Sent 1 USDC',
      body: null,
    });
  });

  it('keeps swap notifications title-only for generic stream subtitles', () => {
    expect(
      buildWalletTransactionNotificationContent({
        type: 'swap',
        amountLabel: '+12 USDC',
        secondaryAmountLabel: null,
        subtitle: 'Unknown',
      }),
    ).toEqual({
      title: 'Swapped 12 USDC',
      body: null,
    });
  });
});
