import {
  buildOffpayAiSessionToken,
  clearOffpayAiSessionTokenCache,
  isOffpayAiSessionTokenConfigured,
  OffpayAiSessionTokenUnavailableError,
} from '@/lib/agentic-payments/session-token';

const WALLET = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';

jest.mock('@/lib/api/offpay-api-client', () => ({ createAiSession: jest.fn() }));
jest.mock('@/lib/wallet/secure-wallet-store', () => ({ getStoredWalletInfo: jest.fn() }));
jest.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: { getState: () => ({ network: 'mainnet-beta' }) },
}));

const apiMock = jest.requireMock('@/lib/api/offpay-api-client') as {
  createAiSession: jest.Mock;
};
const walletMock = jest.requireMock('@/lib/wallet/secure-wallet-store') as {
  getStoredWalletInfo: jest.Mock;
};

describe('server-issued OffPay AI sessions', () => {
  beforeEach(() => {
    clearOffpayAiSessionTokenCache();
    apiMock.createAiSession.mockReset();
    walletMock.getStoredWalletInfo.mockReset();
    walletMock.getStoredWalletInfo.mockResolvedValue({ id: 'wallet-1', publicKey: WALLET });
  });

  it('requires no client-side shared secret', () => {
    expect(isOffpayAiSessionTokenConfigured()).toBe(true);
  });

  it('requests a network-bound token from the authenticated API and caches it', async () => {
    const issuedAt = Date.now();
    apiMock.createAiSession.mockResolvedValue({
      token: 'v2.payload.signature',
      walletAddress: WALLET,
      network: 'devnet',
      issuedAt,
      expiresAt: issuedAt + 5 * 60_000,
    });

    const first = await buildOffpayAiSessionToken();
    const second = await buildOffpayAiSessionToken();

    expect(first).toEqual(second);
    expect(apiMock.createAiSession).toHaveBeenCalledTimes(1);
    expect(apiMock.createAiSession).toHaveBeenCalledWith('devnet', { walletId: 'wallet-1' });
  });

  it('coalesces concurrent refreshes to one API request', async () => {
    const issuedAt = Date.now();
    apiMock.createAiSession.mockResolvedValue({
      token: 'v2.payload.signature',
      walletAddress: WALLET,
      network: 'devnet',
      issuedAt,
      expiresAt: issuedAt + 5 * 60_000,
    });

    await Promise.all([
      buildOffpayAiSessionToken({ forceRefresh: true }),
      buildOffpayAiSessionToken({ forceRefresh: true }),
    ]);
    expect(apiMock.createAiSession).toHaveBeenCalledTimes(1);
  });

  it('rejects a response issued for another wallet or network', async () => {
    const issuedAt = Date.now();
    apiMock.createAiSession.mockResolvedValue({
      token: 'v2.payload.signature',
      walletAddress: '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY',
      network: 'mainnet',
      issuedAt,
      expiresAt: issuedAt + 5 * 60_000,
    });

    await expect(buildOffpayAiSessionToken()).rejects.toBeInstanceOf(
      OffpayAiSessionTokenUnavailableError,
    );
  });

  it('fails closed when no active wallet is available', async () => {
    walletMock.getStoredWalletInfo.mockResolvedValue(null);
    await expect(buildOffpayAiSessionToken()).rejects.toThrow(
      'A wallet is required before using Yuga.',
    );
  });
});
