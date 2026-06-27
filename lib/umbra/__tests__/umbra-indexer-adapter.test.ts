const mockSubmitUmbraClaim = jest.fn();
const mockGetUmbraClaimStatus = jest.fn();
const mockGetUmbraRelayerInfo = jest.fn();
const mockGetUmbraUtxos = jest.fn();
const mockGetUmbraTreeSummaries = jest.fn();

jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  submitUmbraClaim: mockSubmitUmbraClaim,
  getUmbraClaimStatus: mockGetUmbraClaimStatus,
  getUmbraRelayerInfo: mockGetUmbraRelayerInfo,
  getUmbraUtxos: mockGetUmbraUtxos,
  getUmbraTreeSummaries: mockGetUmbraTreeSummaries,
}));

const {
  createOffpayUmbraClaimRelayer,
  createOffpayUmbraTreeSummaryFetcher,
  createOffpayUmbraUtxoDataFetcher,
} =
  require('@/lib/umbra/umbra-indexer-adapter') as typeof import('@/lib/umbra/umbra-indexer-adapter');

describe('createOffpayUmbraClaimRelayer', () => {
  beforeEach(() => {
    mockSubmitUmbraClaim.mockReset();
    mockGetUmbraClaimStatus.mockReset();
    mockGetUmbraRelayerInfo.mockReset();
    mockGetUmbraUtxos.mockReset();
    mockGetUmbraTreeSummaries.mockReset();
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

  it('passes abort signals through Umbra UTXO and tree-summary fetchers', async () => {
    const controller = new AbortController();
    mockGetUmbraUtxos.mockResolvedValue({
      network: 'devnet',
      utxos: [],
      cursor: null,
      hasMore: false,
      totalCount: '0',
      startIndex: '10',
      endIndex: '20',
      highestIndexedInsertionIndex: null,
      fetchedAt: '2026-06-27T00:00:00.000Z',
    });
    mockGetUmbraTreeSummaries.mockResolvedValue({
      network: 'devnet',
      trees: [{ treeIndex: '0', numLeaves: '21' }],
      fetchedAt: '2026-06-27T00:00:00.000Z',
    });

    const fetchUtxos = createOffpayUmbraUtxoDataFetcher('devnet', {
      signal: controller.signal,
    });
    await fetchUtxos(10n, 20n, 32n);
    await createOffpayUmbraTreeSummaryFetcher('devnet', {
      signal: controller.signal,
    })();

    expect(mockGetUmbraUtxos).toHaveBeenCalledWith(
      expect.objectContaining({
        network: 'devnet',
        start: '10',
        end: '20',
        limit: '32',
        signal: controller.signal,
      }),
    );
    expect(mockGetUmbraTreeSummaries).toHaveBeenCalledWith('devnet', controller.signal);
  });

  it('does not start Umbra indexer fetches after the scan is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createOffpayUmbraUtxoDataFetcher('devnet', {
        signal: controller.signal,
      })(0n),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      createOffpayUmbraTreeSummaryFetcher('devnet', {
        signal: controller.signal,
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(mockGetUmbraUtxos).not.toHaveBeenCalled();
    expect(mockGetUmbraTreeSummaries).not.toHaveBeenCalled();
  });
});
