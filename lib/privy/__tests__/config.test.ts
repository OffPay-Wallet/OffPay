type PrivyConfigModule = typeof import('@/lib/privy/config');

const ORIGINAL_ENV = process.env;
const ORIGINAL_DEV = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

function loadConfig(params: {
  nodeEnv: NodeJS.ProcessEnv['NODE_ENV'];
  devRuntime: boolean;
  appId?: string;
  clientId?: string;
}): PrivyConfigModule {
  jest.resetModules();

  const nextEnv: NodeJS.ProcessEnv = {
    ...ORIGINAL_ENV,
    NODE_ENV: params.nodeEnv,
  };
  delete nextEnv.EXPO_PUBLIC_PRIVY_APP_ID;
  delete nextEnv.EXPO_PUBLIC_PRIVY_CLIENT_ID;
  if (params.appId != null) nextEnv.EXPO_PUBLIC_PRIVY_APP_ID = params.appId;
  if (params.clientId != null) nextEnv.EXPO_PUBLIC_PRIVY_CLIENT_ID = params.clientId;
  process.env = nextEnv;

  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = params.devRuntime;

  let loaded: PrivyConfigModule | null = null;
  jest.isolateModules(() => {
    loaded = require('@/lib/privy/config') as PrivyConfigModule;
  });
  if (loaded == null) throw new Error('Privy config module did not load.');
  return loaded;
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = ORIGINAL_DEV;
  jest.resetModules();
});

describe('Privy config', () => {
  it('requires Privy environment in production-like builds', () => {
    const config = loadConfig({ nodeEnv: 'production', devRuntime: false });

    expect(config.getPrivyEnvironment()).toBeNull();
    expect(config.shouldRequirePrivyEnvironment()).toBe(true);
    expect(() => config.getRequiredPrivyEnvironment()).toThrow(
      'EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID',
    );
  });

  it('keeps missing Privy environment optional in test builds', () => {
    const config = loadConfig({ nodeEnv: 'test', devRuntime: false });

    expect(config.getPrivyEnvironment()).toBeNull();
    expect(config.shouldRequirePrivyEnvironment()).toBe(false);
  });

  it('returns configured public Privy IDs', () => {
    const config = loadConfig({
      nodeEnv: 'production',
      devRuntime: false,
      appId: 'app-id',
      clientId: 'client-id',
    });

    expect(config.getPrivyEnvironment()).toEqual({
      appId: 'app-id',
      clientId: 'client-id',
    });
  });
});
