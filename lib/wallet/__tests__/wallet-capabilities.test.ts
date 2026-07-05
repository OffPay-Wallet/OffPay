type WalletCapabilitiesModule = typeof import('@/lib/wallet/wallet-capabilities');

const ORIGINAL_ENV = process.env;

function loadWalletCapabilities(params: {
  appId?: string;
  clientId?: string;
}): WalletCapabilitiesModule {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  if (params.appId == null) {
    delete process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  } else {
    process.env.EXPO_PUBLIC_PRIVY_APP_ID = params.appId;
  }

  if (params.clientId == null) {
    delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID = params.clientId;
  }

  return require('@/lib/wallet/wallet-capabilities') as WalletCapabilitiesModule;
}

describe('wallet signing capabilities', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it('treats configured Privy embedded wallets as sign-capable while signer registration warms up', () => {
    const capabilities = loadWalletCapabilities({
      appId: 'privy-app',
      clientId: 'privy-client',
    });

    expect(
      capabilities.walletCanSignWithApp({
        importMethod: 'privy-embedded',
        walletAddress: '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ',
      }),
    ).toBe(true);
    expect(
      capabilities.getWalletSigningBlocker(
        'privy-embedded',
        'RWA trade',
        '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ',
      ),
    ).toBeNull();
  });

  it('still blocks Privy wallets when the Privy environment is missing', () => {
    const capabilities = loadWalletCapabilities({});

    expect(
      capabilities.walletCanSignWithApp({
        importMethod: 'privy-embedded',
        walletAddress: '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ',
      }),
    ).toBe(false);
    expect(capabilities.getWalletSigningBlocker('privy-embedded')).toBe(
      capabilities.PRIVY_SIGNING_NOT_CONFIGURED_MESSAGE,
    );
  });

  it('keeps local wallet signing behavior unchanged', () => {
    const capabilities = loadWalletCapabilities({});

    expect(capabilities.walletCanSignWithApp({ importMethod: 'generated' })).toBe(true);
    expect(capabilities.getWalletSigningBlocker('generated')).toBeNull();
    expect(capabilities.walletCanSignWithApp({ importMethod: null })).toBe(false);
    expect(capabilities.getWalletSigningBlocker(null)).toBe(
      capabilities.LOCAL_SIGNING_REQUIRED_MESSAGE,
    );
  });
});
