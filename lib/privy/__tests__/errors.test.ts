jest.mock('@privy-io/expo', () => {
  class PrivyClientError extends Error {
    code: string;

    constructor(params: { code: string; error?: string }) {
      super(params.error ?? params.code);
      this.code = params.code;
    }
  }

  class PrivyApiError extends Error {
    code: string;
    status: number;

    constructor(params: { code: string; error?: string; status: number }) {
      super(params.error ?? params.code);
      this.code = params.code;
      this.status = params.status;
    }
  }

  return { PrivyApiError, PrivyClientError };
});

import { classifyPrivyError } from '@/lib/privy/errors';
import { PrivyApiError } from '@privy-io/expo';

describe('classifyPrivyError', () => {
  it('classifies native Credential Manager configuration failures', () => {
    expect(classifyPrivyError(new Error('NotConfigured'))).toMatchObject({
      kind: 'configuration-error',
      silent: false,
    });
  });

  it('classifies Digital Asset Links failures as configuration errors', () => {
    expect(classifyPrivyError(new Error('Digital Asset Links verification failed'))).toMatchObject({
      kind: 'configuration-error',
      silent: false,
    });
  });

  it('classifies rejected passkey registration responses as configuration errors', () => {
    expect(
      classifyPrivyError(
        new PrivyApiError({
          code: 'invalid_credentials' as never,
          error: 'Invalid request',
          status: 400,
        }),
      ),
    ).toMatchObject({
      kind: 'configuration-error',
      message: 'Passkey sign-in is misconfigured for this build. Contact support.',
      silent: false,
    });
  });
});
