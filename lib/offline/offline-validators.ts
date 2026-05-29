import bs58 from 'bs58';

import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Shared input validators and QR payload types for the offline payment
 * subsystem.
 *
 * These leaf helpers validate base58 public keys, positive decimal
 * amounts, and cached durable-nonce values. They are used by both the
 * nonce state machine (`offline-payments.ts`) and the QR
 * encode/parse layer (`offline-qr.ts`), so they live in a neutral
 * module to avoid a circular dependency between those two.
 *
 * Pure — no I/O, no SDK, no wallet access.
 */

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface OfflinePaymentRequest {
  recipient: string;
  amount: string | null;
  token: string | null;
  memo: string | null;
}

export type ParsedOfflineQrPayload =
  | {
      type: 'solana-address';
      raw: string;
      request: OfflinePaymentRequest;
    }
  | {
      type: 'offpay-offline-request';
      raw: string;
      request: OfflinePaymentRequest;
    }
  | {
      type: 'offpay-receive-request';
      raw: string;
      request: OfflinePaymentRequest & {
        network?: OffpayNetwork | null;
        route?: 'normal' | 'umbra' | null;
        bleServiceUuid?: string | null;
        bleName?: string | null;
        sessionNonce?: string | null;
      };
    }
  | {
      type: 'umbra-private-address';
      raw: string;
      umbraAddress: string;
    }
  | {
      type: 'nonce-payment-request';
      raw: string;
      request: OfflinePaymentRequest & {
        nonceAccount: string;
        cachedNonce?: string | null;
        expiresAt?: number | null;
      };
    };

export function assertBase58PublicKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!isValidSolanaAddress(normalized)) {
    throw new Error(`${label} must be a valid Solana public key.`);
  }
  return normalized;
}

export function assertPositiveAmount(value: string | null): string | null {
  if (value == null || value.trim().length === 0) return null;
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error('Offline payment amount must be greater than zero.');
  }
  return normalized;
}

export function assertCachedNonce(value: string): string {
  const normalized = value.trim();
  try {
    if (bs58.decode(normalized).length !== 32) {
      throw new Error('bad length');
    }
  } catch {
    throw new Error('Cached durable nonce must be a base58 encoded 32-byte value.');
  }
  return normalized;
}

export function isNativeOfflineSolToken(token: string | null | undefined): boolean {
  const normalized = token?.trim();
  if (normalized == null || normalized.length === 0) return true;
  const upper = normalized.toUpperCase();
  return upper === 'SOL' || upper === 'WSOL' || normalized === NATIVE_SOL_MINT;
}

export function isOfflinePayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
