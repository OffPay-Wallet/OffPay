import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

export interface SavedContact {
  id: string;
  name: string;
  address: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContactUsageStats {
  count: number;
  lastUsedAt: number;
}

export interface FrequentRecipientOption {
  address: string;
  name?: string;
  usedAt: number;
  useCount: number;
  isContact: boolean;
}

interface ContactUpsertInput {
  name: string;
  address: string;
  editingAddress?: string | null;
}

interface MarkRecipientUsedInput {
  walletAddress: string | null | undefined;
  recipientAddress: string | null | undefined;
  usedAt?: number;
}

interface ContactsState {
  contacts: SavedContact[];
  usageByWalletAddress: Record<string, Record<string, ContactUsageStats>>;
  recentClearedAtByWalletAddress: Record<string, number>;
  hiddenRecentRecipientsByWalletAddress: Record<string, Record<string, number>>;
  upsertContact: (input: ContactUpsertInput) => SavedContact | null;
  deleteContact: (address: string) => void;
  clearContacts: () => void;
  markRecipientUsed: (input: MarkRecipientUsedInput) => void;
  clearRecentUsage: (walletAddress: string) => void;
  dismissRecentRecipient: (walletAddress: string, recipientAddress: string) => void;
}

const MAX_CONTACTS = 250;

function contactIdForAddress(address: string): string {
  return `contact:${address}`;
}

export function normalizeContactName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeAddress(value: string): string {
  return value.trim();
}

export function getContactByAddress(
  contacts: readonly SavedContact[],
  address: string | null | undefined,
): SavedContact | null {
  const normalizedAddress = normalizeAddress(address ?? '');
  if (normalizedAddress.length === 0) return null;
  return contacts.find((contact) => contact.address === normalizedAddress) ?? null;
}

export function buildFrequentRecipientOptions(params: {
  contacts: readonly SavedContact[];
  usageByAddress: Readonly<Record<string, ContactUsageStats>> | null | undefined;
  walletAddress?: string | null;
  limit?: number;
}): FrequentRecipientOption[] {
  const limit = params.limit ?? 5;
  if (limit <= 0) return [];

  const walletAddress = normalizeAddress(params.walletAddress ?? '');
  const contactsByAddress = new Map(params.contacts.map((contact) => [contact.address, contact]));
  const byAddress = new Map<string, FrequentRecipientOption>();

  for (const [address, stats] of Object.entries(params.usageByAddress ?? {})) {
    if (!isValidSolanaAddress(address) || address === walletAddress) continue;
    const contact = contactsByAddress.get(address);
    byAddress.set(address, {
      address,
      name: contact?.name,
      usedAt: stats.lastUsedAt,
      useCount: Math.max(0, stats.count),
      isContact: contact != null,
    });
  }

  for (const contact of params.contacts) {
    if (contact.address === walletAddress) continue;
    const current = byAddress.get(contact.address);
    if (current != null) {
      byAddress.set(contact.address, {
        ...current,
        name: contact.name,
        usedAt: Math.max(current.usedAt, contact.updatedAt),
        isContact: true,
      });
      continue;
    }
    byAddress.set(contact.address, {
      address: contact.address,
      name: contact.name,
      usedAt: contact.updatedAt,
      useCount: 0,
      isContact: true,
    });
  }

  return [...byAddress.values()]
    .sort((left, right) => {
      return (
        right.useCount - left.useCount ||
        Number(right.isContact) - Number(left.isContact) ||
        right.usedAt - left.usedAt ||
        left.address.localeCompare(right.address)
      );
    })
    .slice(0, limit);
}

function normalizePersistedContact(value: unknown): SavedContact | null {
  if (typeof value !== 'object' || value == null) return null;
  const contact = value as Partial<SavedContact>;
  const address = normalizeAddress(contact.address ?? '');
  const name = normalizeContactName(contact.name ?? '');
  if (!isValidSolanaAddress(address) || name.length === 0) return null;
  const createdAt =
    typeof contact.createdAt === 'number' && Number.isFinite(contact.createdAt)
      ? contact.createdAt
      : Date.now();
  const updatedAt =
    typeof contact.updatedAt === 'number' && Number.isFinite(contact.updatedAt)
      ? contact.updatedAt
      : createdAt;
  return {
    id: contact.id ?? contactIdForAddress(address),
    name,
    address,
    createdAt,
    updatedAt,
  };
}

function normalizePersistedUsage(
  usageByWalletAddress: unknown,
): Record<string, Record<string, ContactUsageStats>> {
  if (typeof usageByWalletAddress !== 'object' || usageByWalletAddress == null) return {};

  const next: Record<string, Record<string, ContactUsageStats>> = {};
  for (const [walletAddress, usageByAddress] of Object.entries(
    usageByWalletAddress as Record<string, unknown>,
  )) {
    if (!isValidSolanaAddress(walletAddress)) continue;
    if (typeof usageByAddress !== 'object' || usageByAddress == null) continue;

    const normalizedUsage: Record<string, ContactUsageStats> = {};
    for (const [recipientAddress, stats] of Object.entries(
      usageByAddress as Record<string, unknown>,
    )) {
      if (!isValidSolanaAddress(recipientAddress)) continue;
      if (typeof stats !== 'object' || stats == null) continue;
      const candidate = stats as Partial<ContactUsageStats>;
      const count =
        typeof candidate.count === 'number' && Number.isFinite(candidate.count)
          ? Math.max(0, Math.floor(candidate.count))
          : 0;
      const lastUsedAt =
        typeof candidate.lastUsedAt === 'number' && Number.isFinite(candidate.lastUsedAt)
          ? candidate.lastUsedAt
          : 0;
      if (count === 0 && lastUsedAt === 0) continue;
      normalizedUsage[recipientAddress] = { count, lastUsedAt };
    }

    if (Object.keys(normalizedUsage).length > 0) {
      next[walletAddress] = normalizedUsage;
    }
  }

  return next;
}

function normalizePersistedClearTimes(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value == null) return {};
  const next: Record<string, number> = {};
  for (const [walletAddress, timestamp] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidSolanaAddress(walletAddress)) continue;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) continue;
    next[walletAddress] = timestamp;
  }
  return next;
}

function normalizePersistedHiddenRecipients(
  value: unknown,
): Record<string, Record<string, number>> {
  if (typeof value !== 'object' || value == null) return {};
  const next: Record<string, Record<string, number>> = {};
  for (const [walletAddress, hiddenByAddress] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidSolanaAddress(walletAddress)) continue;
    if (typeof hiddenByAddress !== 'object' || hiddenByAddress == null) continue;

    const normalizedHidden: Record<string, number> = {};
    for (const [recipientAddress, timestamp] of Object.entries(
      hiddenByAddress as Record<string, unknown>,
    )) {
      if (!isValidSolanaAddress(recipientAddress)) continue;
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) continue;
      normalizedHidden[recipientAddress] = timestamp;
    }
    if (Object.keys(normalizedHidden).length > 0) {
      next[walletAddress] = normalizedHidden;
    }
  }
  return next;
}

export const useContactsStore = create<ContactsState>()(
  persist(
    (set) => ({
      contacts: [],
      usageByWalletAddress: {},
      recentClearedAtByWalletAddress: {},
      hiddenRecentRecipientsByWalletAddress: {},
      upsertContact: ({ name, address, editingAddress }) => {
        const normalizedName = normalizeContactName(name);
        const normalizedAddress = normalizeAddress(address);
        if (normalizedName.length === 0 || !isValidSolanaAddress(normalizedAddress)) return null;
        const normalizedEditingAddress = normalizeAddress(editingAddress ?? '');

        const now = Date.now();
        let savedContact: SavedContact | null = null;
        set((state) => {
          const existing = getContactByAddress(state.contacts, normalizedAddress);
          if (
            existing != null &&
            (normalizedEditingAddress.length === 0 || existing.address !== normalizedEditingAddress)
          ) {
            savedContact = null;
            return state;
          }

          savedContact =
            existing == null
              ? {
                  id: contactIdForAddress(normalizedAddress),
                  name: normalizedName,
                  address: normalizedAddress,
                  createdAt: now,
                  updatedAt: now,
                }
              : {
                  ...existing,
                  name: normalizedName,
                  updatedAt: now,
                };

          const contacts = [
            savedContact,
            ...state.contacts.filter((contact) => contact.address !== normalizedAddress),
          ]
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, MAX_CONTACTS);

          return { contacts };
        });

        return savedContact;
      },
      deleteContact: (address) => {
        const normalizedAddress = normalizeAddress(address);
        set((state) => ({
          contacts: state.contacts.filter((contact) => contact.address !== normalizedAddress),
        }));
      },
      clearContacts: () =>
        set({
          contacts: [],
          usageByWalletAddress: {},
          recentClearedAtByWalletAddress: {},
          hiddenRecentRecipientsByWalletAddress: {},
        }),
      markRecipientUsed: ({ walletAddress, recipientAddress, usedAt }) => {
        const normalizedWallet = normalizeAddress(walletAddress ?? '');
        const normalizedRecipient = normalizeAddress(recipientAddress ?? '');
        if (
          !isValidSolanaAddress(normalizedWallet) ||
          !isValidSolanaAddress(normalizedRecipient) ||
          normalizedWallet === normalizedRecipient
        ) {
          return;
        }

        const timestamp = usedAt ?? Date.now();
        set((state) => {
          const currentWalletUsage = state.usageByWalletAddress[normalizedWallet] ?? {};
          const currentRecipientUsage = currentWalletUsage[normalizedRecipient] ?? {
            count: 0,
            lastUsedAt: 0,
          };
          const currentHidden = state.hiddenRecentRecipientsByWalletAddress[normalizedWallet];
          const nextHiddenByWalletAddress = { ...state.hiddenRecentRecipientsByWalletAddress };
          if (currentHidden != null && currentHidden[normalizedRecipient] != null) {
            const nextWalletHidden = { ...currentHidden };
            delete nextWalletHidden[normalizedRecipient];
            if (Object.keys(nextWalletHidden).length > 0) {
              nextHiddenByWalletAddress[normalizedWallet] = nextWalletHidden;
            } else {
              delete nextHiddenByWalletAddress[normalizedWallet];
            }
          }
          return {
            usageByWalletAddress: {
              ...state.usageByWalletAddress,
              [normalizedWallet]: {
                ...currentWalletUsage,
                [normalizedRecipient]: {
                  count: currentRecipientUsage.count + 1,
                  lastUsedAt: Math.max(currentRecipientUsage.lastUsedAt, timestamp),
                },
              },
            },
            hiddenRecentRecipientsByWalletAddress: nextHiddenByWalletAddress,
          };
        });
      },
      clearRecentUsage: (walletAddress) => {
        const normalizedWallet = normalizeAddress(walletAddress);
        if (!isValidSolanaAddress(normalizedWallet)) return;
        set((state) => {
          const nextUsage = { ...state.usageByWalletAddress };
          delete nextUsage[normalizedWallet];
          const nextHidden = { ...state.hiddenRecentRecipientsByWalletAddress };
          delete nextHidden[normalizedWallet];
          return {
            usageByWalletAddress: nextUsage,
            recentClearedAtByWalletAddress: {
              ...state.recentClearedAtByWalletAddress,
              [normalizedWallet]: Date.now(),
            },
            hiddenRecentRecipientsByWalletAddress: nextHidden,
          };
        });
      },
      dismissRecentRecipient: (walletAddress, recipientAddress) => {
        const normalizedWallet = normalizeAddress(walletAddress);
        const normalizedRecipient = normalizeAddress(recipientAddress);
        if (!isValidSolanaAddress(normalizedWallet) || !isValidSolanaAddress(normalizedRecipient)) {
          return;
        }

        set((state) => {
          const currentWalletUsage = state.usageByWalletAddress[normalizedWallet] ?? {};
          const nextWalletUsage = { ...currentWalletUsage };
          delete nextWalletUsage[normalizedRecipient];

          const nextUsage = { ...state.usageByWalletAddress };
          if (Object.keys(nextWalletUsage).length > 0) {
            nextUsage[normalizedWallet] = nextWalletUsage;
          } else {
            delete nextUsage[normalizedWallet];
          }

          return {
            usageByWalletAddress: nextUsage,
            hiddenRecentRecipientsByWalletAddress: {
              ...state.hiddenRecentRecipientsByWalletAddress,
              [normalizedWallet]: {
                ...(state.hiddenRecentRecipientsByWalletAddress[normalizedWallet] ?? {}),
                [normalizedRecipient]: Date.now(),
              },
            },
          };
        });
      },
    }),
    {
      name: 'offpay-contacts',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      migrate: (persisted) => {
        if (typeof persisted !== 'object' || persisted == null) return persisted;
        const state = persisted as Partial<ContactsState>;
        const contacts = Array.isArray(state.contacts)
          ? state.contacts
              .map((contact) => normalizePersistedContact(contact))
              .filter((contact): contact is SavedContact => contact != null)
          : [];
        return {
          ...state,
          contacts,
          usageByWalletAddress: normalizePersistedUsage(state.usageByWalletAddress),
          recentClearedAtByWalletAddress: normalizePersistedClearTimes(
            state.recentClearedAtByWalletAddress,
          ),
          hiddenRecentRecipientsByWalletAddress: normalizePersistedHiddenRecipients(
            state.hiddenRecentRecipientsByWalletAddress,
          ),
        };
      },
      partialize: (state) => ({
        contacts: state.contacts,
        usageByWalletAddress: state.usageByWalletAddress,
        recentClearedAtByWalletAddress: state.recentClearedAtByWalletAddress,
        hiddenRecentRecipientsByWalletAddress: state.hiddenRecentRecipientsByWalletAddress,
      }),
    },
  ),
);
