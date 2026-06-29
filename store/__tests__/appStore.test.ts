import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import { hydrateAppStore, useAppStore } from '@/store/app';

const APP_STORE_KEY = 'app-store';

type PersistedAppState = {
  hasOnboarded: boolean;
  inviteAccessVerified: boolean;
  inviteEmail: string | null;
  walletFlowInviteVerifiedAt: number | null;
  walletFlowInviteSource: 'accounts' | 'onboarding' | null;
  colorScheme: 'light' | 'dark' | null;
  username: string | null;
  profileImageUri: string | null;
};

const DEFAULT_APP_STATE: PersistedAppState = {
  hasOnboarded: false,
  inviteAccessVerified: false,
  inviteEmail: null,
  walletFlowInviteVerifiedAt: null,
  walletFlowInviteSource: null,
  colorScheme: null,
  username: null,
  profileImageUri: null,
};

function resetAppStoreMemory(): void {
  useAppStore.setState(DEFAULT_APP_STATE);
}

function writePersistedAppState(state: Partial<PersistedAppState>): void {
  mmkvStorage.setItem(
    APP_STORE_KEY,
    JSON.stringify({
      state: {
        ...DEFAULT_APP_STATE,
        ...state,
      },
      version: 0,
    }),
  );
}

describe('appStore hydration', () => {
  beforeEach(() => {
    useAppStore.persist.clearStorage();
    resetAppStoreMemory();
    useAppStore.persist.clearStorage();
  });

  afterEach(() => {
    useAppStore.persist.clearStorage();
    resetAppStoreMemory();
    useAppStore.persist.clearStorage();
  });

  it('leaves app-state hydration under root-layout control', () => {
    expect(useAppStore.persist.getOptions().skipHydration).toBe(true);
  });

  it('restores persisted onboarding route flags when explicitly hydrated', async () => {
    writePersistedAppState({
      inviteAccessVerified: true,
      inviteEmail: 'tester@offpay.app',
      walletFlowInviteSource: 'onboarding',
    });

    expect(useAppStore.getState()).toMatchObject({
      inviteAccessVerified: false,
      inviteEmail: null,
      walletFlowInviteSource: null,
    });

    await hydrateAppStore();

    expect(useAppStore.getState()).toMatchObject({
      inviteAccessVerified: true,
      inviteEmail: 'tester@offpay.app',
      walletFlowInviteSource: 'onboarding',
    });
  });
});
