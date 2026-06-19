import { classifySendFailure } from '@/components/features/private-payment/send-flow/helpers';

describe('send flow helpers', () => {
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
});
