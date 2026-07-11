import { toOffpayNetwork } from '@/constants/networks';
import { createAiSession } from '@/lib/api/offpay-api-client';
import { getStoredWalletInfo } from '@/lib/wallet/secure-wallet-store';
import { usePreferencesStore } from '@/store/preferencesStore';

import type { OffpayNetwork } from '@/types/offpay-api';

export interface OffpayAiSessionToken {
  token: string;
  walletAddress: string;
  network: OffpayNetwork;
  issuedAt: number;
  expiresAt: number;
}

const SESSION_REFRESH_BUFFER_MS = 30_000;

const sessions = new Map<string, OffpayAiSessionToken>();
const sessionRequests = new Map<string, Promise<OffpayAiSessionToken>>();

export class OffpayAiSessionTokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffpayAiSessionTokenUnavailableError';
  }
}

/** Server-issued sessions require no build-time secret in the mobile app. */
export function isOffpayAiSessionTokenConfigured(): boolean {
  return true;
}

function isFresh(session: OffpayAiSessionToken, now: number): boolean {
  return session.expiresAt - SESSION_REFRESH_BUFFER_MS > now;
}

function sessionKey(walletAddress: string, network: OffpayNetwork): string {
  return `${network}:${walletAddress}`;
}

export function clearOffpayAiSessionTokenCache(): void {
  sessions.clear();
  sessionRequests.clear();
}

export async function buildOffpayAiSessionToken(params?: {
  network?: OffpayNetwork;
  forceRefresh?: boolean;
}): Promise<OffpayAiSessionToken> {
  const walletInfo = await getStoredWalletInfo();
  if (walletInfo == null) {
    throw new OffpayAiSessionTokenUnavailableError('A wallet is required before using Yuga.');
  }

  const network =
    params?.network ?? toOffpayNetwork(usePreferencesStore.getState().network);
  const key = sessionKey(walletInfo.publicKey, network);
  const now = Date.now();
  const cached = sessions.get(key);
  if (params?.forceRefresh !== true && cached != null && isFresh(cached, now)) {
    return cached;
  }

  const existingRequest = sessionRequests.get(key);
  if (existingRequest != null) return existingRequest;

  const request = (async (): Promise<OffpayAiSessionToken> => {
    try {
      const issued = await createAiSession(network, { walletId: walletInfo.id });
      if (
        issued.walletAddress !== walletInfo.publicKey ||
        issued.network !== network ||
        typeof issued.token !== 'string' ||
        issued.token.length === 0 ||
        !Number.isFinite(issued.issuedAt) ||
        !Number.isFinite(issued.expiresAt) ||
        issued.expiresAt <= Math.max(issued.issuedAt, Date.now() + SESSION_REFRESH_BUFFER_MS)
      ) {
        throw new Error('OffPay API returned an invalid Yuga session.');
      }

      const session: OffpayAiSessionToken = {
        token: issued.token,
        walletAddress: issued.walletAddress,
        network: issued.network,
        issuedAt: issued.issuedAt,
        expiresAt: issued.expiresAt,
      };
      sessions.set(key, session);
      return session;
    } catch (error) {
      throw new OffpayAiSessionTokenUnavailableError(
        error instanceof Error ? error.message : 'Unable to create a Yuga session.',
      );
    } finally {
      sessionRequests.delete(key);
    }
  })();

  sessionRequests.set(key, request);
  return request;
}

export const __aiSessionTokenInternal = {
  SESSION_REFRESH_BUFFER_MS,
  isFresh,
  sessionKey,
};
