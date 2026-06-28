import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  buildFrequentRecipientOptions,
  getContactByAddress,
  useContactsStore,
} from '@/store/contactsStore';

function addressFromSeedByte(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const walletAddress = addressFromSeedByte(1);
const karanAddress = addressFromSeedByte(2);
const ninaAddress = addressFromSeedByte(3);
const zedAddress = addressFromSeedByte(4);
const rawAddress = addressFromSeedByte(5);

describe('contactsStore', () => {
  beforeEach(() => {
    useContactsStore.setState({
      contacts: [],
      usageByWalletAddress: {},
      recentClearedAtByWalletAddress: {},
    });
    jest.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('saves contacts locally by address and updates duplicate names', () => {
    const first = useContactsStore
      .getState()
      .upsertContact({ name: '  Karan   Singh  ', address: karanAddress });

    expect(first).toMatchObject({
      name: 'Karan Singh',
      address: karanAddress,
    });
    expect(useContactsStore.getState().contacts).toHaveLength(1);

    jest.spyOn(Date, 'now').mockReturnValue(2000);
    useContactsStore.getState().upsertContact({ name: 'Karan', address: karanAddress });

    expect(useContactsStore.getState().contacts).toEqual([
      expect.objectContaining({
        name: 'Karan',
        address: karanAddress,
        createdAt: 1000,
        updatedAt: 2000,
      }),
    ]);
  });

  it('rejects invalid contact addresses', () => {
    const saved = useContactsStore
      .getState()
      .upsertContact({ name: 'Bad wallet', address: 'not-a-wallet' });

    expect(saved).toBeNull();
    expect(useContactsStore.getState().contacts).toEqual([]);
  });

  it('tracks recipient frequency per sending wallet without counting self sends', () => {
    useContactsStore
      .getState()
      .markRecipientUsed({ walletAddress, recipientAddress: karanAddress, usedAt: 10 });
    useContactsStore
      .getState()
      .markRecipientUsed({ walletAddress, recipientAddress: karanAddress, usedAt: 20 });
    useContactsStore
      .getState()
      .markRecipientUsed({ walletAddress, recipientAddress: walletAddress, usedAt: 30 });

    expect(useContactsStore.getState().usageByWalletAddress[walletAddress]).toEqual({
      [karanAddress]: { count: 2, lastUsedAt: 20 },
    });
  });

  it('builds the top five frequent recipients with contact names', () => {
    const contacts = [
      { id: 'contact-1', name: 'Karan', address: karanAddress, createdAt: 1, updatedAt: 1 },
      { id: 'contact-2', name: 'Nina', address: ninaAddress, createdAt: 2, updatedAt: 2 },
      { id: 'contact-3', name: 'Zed', address: zedAddress, createdAt: 3, updatedAt: 3 },
    ];

    const options = buildFrequentRecipientOptions({
      contacts,
      walletAddress,
      usageByAddress: {
        [karanAddress]: { count: 4, lastUsedAt: 40 },
        [ninaAddress]: { count: 2, lastUsedAt: 60 },
        [rawAddress]: { count: 3, lastUsedAt: 50 },
        [walletAddress]: { count: 100, lastUsedAt: 100 },
      },
      limit: 3,
    });

    expect(options).toEqual([
      expect.objectContaining({ address: karanAddress, name: 'Karan', useCount: 4 }),
      expect.objectContaining({ address: rawAddress, name: undefined, useCount: 3 }),
      expect.objectContaining({ address: ninaAddress, name: 'Nina', useCount: 2 }),
    ]);
  });

  it('clears recent usage without deleting saved contacts', () => {
    useContactsStore.getState().upsertContact({ name: 'Karan', address: karanAddress });
    useContactsStore
      .getState()
      .markRecipientUsed({ walletAddress, recipientAddress: karanAddress, usedAt: 10 });

    useContactsStore.getState().clearRecentUsage(walletAddress);

    expect(getContactByAddress(useContactsStore.getState().contacts, karanAddress)).toMatchObject({
      name: 'Karan',
      address: karanAddress,
    });
    expect(useContactsStore.getState().usageByWalletAddress[walletAddress]).toBeUndefined();
    expect(useContactsStore.getState().recentClearedAtByWalletAddress[walletAddress]).toBe(1000);
  });
});
