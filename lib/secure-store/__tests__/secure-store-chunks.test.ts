import * as SecureStore from 'expo-secure-store';

import {
  deleteSecureStoreItem,
  getSecureStoreItem,
  setSecureStoreItem,
} from '@/lib/secure-store/secure-store-chunks';

describe('secure-store-chunks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('splits oversized SecureStore values so no single write exceeds the platform limit', async () => {
    const value = 'x'.repeat(5000);

    await setSecureStoreItem('large-secure-value', value);

    const writes = (SecureStore.setItemAsync as jest.Mock).mock.calls as Array<[string, string]>;
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every(([, written]) => written.length <= 2048)).toBe(true);
    await expect(getSecureStoreItem('large-secure-value')).resolves.toBe(value);

    await deleteSecureStoreItem('large-secure-value');
    await expect(getSecureStoreItem('large-secure-value')).resolves.toBeNull();
  });
});
