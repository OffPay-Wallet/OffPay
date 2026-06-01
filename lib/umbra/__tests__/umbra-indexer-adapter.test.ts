const mockSubmitUmbraClaim = jest.fn();
const mockGetUmbraClaimStatus = jest.fn();
const mockGetUmbraRelayerInfo = jest.fn();

jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  submitUmbraClaim: mockSubmitUmbraClaim,
  getUmbraClaimStatus: mockGetUmbraClaimStatus,
  getUmbraRelayerInfo: mockGetUmbraRelayerInfo,
}));

const { createOffpayUmbraClaimRelayer } =
  require('@/lib/umbra/umbra-indexer-adapter') as typeof import('@/lib/umbra/umbra-indexer-adapter');

describe('createOffpayUmbraClaimRelayer', () => {
  beforeEach(() => {
    mockSubmitUmbraClaim.mockReset();
    mockGetUmbraClaimStatus.mockReset();
    mockGetUmbraRelayerInfo.mockReset();
  });

  it('exposes both the current SDK (submitBurn/pollBurnStatus) and legacy (submitClaim/pollClaimStatus) relayer methods', () => {
    // SDK v5 calls `deps.relayer.submitBurn` / `pollBurnStatus`; the legacy v3
    // SDK calls `submitClaim` / `pollClaimStatus`. The OffPay relayer must
    // satisfy both protocol paths. Regression guard for the
    // "submitBurn is not a function" claim failure.
    const relayer = createOffpayUmbraClaimRelayer('devnet');

    expect(typeof relayer.submitBurn).toBe('function');
    expect(typeof relayer.pollBurnStatus).toBe('function');
    expect(typeof relayer.submitClaim).toBe('function');
    expect(typeof relayer.pollClaimStatus).toBe('function');
    expect(typeof relayer.getRelayerAddress).toBe('function');
  });

  it('routes submitBurn through the same offpay relayer endpoint as submitClaim', async () => {
    mockSubmitUmbraClaim.mockResolvedValue({ claimId: 'req-123', result: {} });
    const relayer = createOffpayUmbraClaimRelayer('devnet');

    const burnResult = await relayer.submitBurn({ variant: 'encrypted_balance' });
    expect(burnResult).toEqual({ requestId: 'req-123', status: 'received' });
    expect(mockSubmitUmbraClaim).toHaveBeenCalledWith({
      network: 'devnet',
      payload: { variant: 'encrypted_balance' },
    });

    // submitBurn and submitClaim are the same implementation.
    expect(relayer.submitBurn).toBe(relayer.submitClaim);
    expect(relayer.pollBurnStatus).toBe(relayer.pollClaimStatus);
  });

  it('throws when the relayer does not return a request id', async () => {
    mockSubmitUmbraClaim.mockResolvedValue({ result: {} });
    const relayer = createOffpayUmbraClaimRelayer('devnet');

    await expect(relayer.submitBurn({})).rejects.toThrow(
      'Umbra relayer did not return a claim request id.',
    );
  });

  it('normalizes a relayer poll response', async () => {
    mockGetUmbraClaimStatus.mockResolvedValue({
      status: 'completed',
      result: { txSignature: 'sig-abc', variant: 'encrypted_balance' },
      fetchedAt: '2026-05-31T00:00:00.000Z',
    });
    const relayer = createOffpayUmbraClaimRelayer('devnet');

    const status = await relayer.pollBurnStatus('req-123');
    expect(status).toMatchObject({
      requestId: 'req-123',
      status: 'completed',
      txSignature: 'sig-abc',
      failureReason: null,
    });
  });
});
