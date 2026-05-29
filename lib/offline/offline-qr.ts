import { Buffer } from 'buffer';

import bs58 from 'bs58';

import { sanitizeBleDisplayName } from '@/lib/api/offpay-username';
import { OFFPAY_BLE_SERVICE_UUID, createOfflineBleDeviceName } from '@/lib/offline/offline-ble-protocol';
import {
  assertBase58PublicKey,
  assertCachedNonce,
  assertPositiveAmount,
  isOfflinePayloadRecord,
  type OfflinePaymentRequest,
  type ParsedOfflineQrPayload,
} from '@/lib/offline/offline-validators';

import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Offline payment QR builders and parsers.
 *
 * OffPay supports four QR families:
 *   - `solana:<addr>?...`           — Solana Pay URIs
 *   - `offpay://offline/...`        — compact offline payment requests
 *   - `offpay://receive/<b64>`      — receive requests with BLE pairing data
 *   - `offpay://private/<addr>`     — Umbra private-address requests
 *   - `offpay://nonce/<b64>`        — durable-nonce payment requests
 *
 * Builders encode an outgoing request; `parseOfflineQrPayload` is the
 * single entry point the scanner uses to classify any incoming QR.
 *
 * No wallet access or signing here — this is encode/parse only.
 */

const OFFPAY_BLE_NAME_PREFIX = 'OffPay-';

function encodePathPart(value: string | null | undefined): string {
  return encodeURIComponent(value ?? '');
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomBase58Nonce(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bs58.encode(bytes);
}

function createReceiveBleName(recipient: string, displayName?: string | null): string {
  const username = sanitizeBleDisplayName(displayName);
  return username == null
    ? createOfflineBleDeviceName(recipient)
    : `${OFFPAY_BLE_NAME_PREFIX}${username}`;
}

export function buildOffpayReceiveRequestQr(request: {
  recipient: string;
  network: OffpayNetwork;
  amount?: string | null;
  token?: string | null;
  memo?: string | null;
  route?: 'normal' | 'umbra' | null;
  bleName?: string | null;
}): string {
  const recipient = assertBase58PublicKey(request.recipient, 'Receive recipient');
  const amount = assertPositiveAmount(request.amount ?? null);
  const payload = encodeBase64UrlJson({
    version: 1,
    type: 'offpay-receive-request',
    recipient,
    network: request.network,
    amount,
    token: request.token ?? null,
    memo: request.memo ?? null,
    route: request.route ?? null,
    ble: {
      serviceUuid: OFFPAY_BLE_SERVICE_UUID,
      name: createReceiveBleName(recipient, request.bleName),
    },
    sessionNonce: randomBase58Nonce(16),
    createdAt: Date.now(),
  });

  return `offpay://receive/${payload}`;
}

export function buildOfflinePaymentRequestQr(request: OfflinePaymentRequest): string {
  const recipient = assertBase58PublicKey(request.recipient, 'Offline recipient');
  const amount = assertPositiveAmount(request.amount);

  return `offpay://offline/${encodePathPart(recipient)}/${encodePathPart(amount)}/${encodePathPart(
    request.token,
  )}/${encodePathPart(request.memo)}`;
}

export function buildSolanaPayRequestQr(request: OfflinePaymentRequest): string {
  const recipient = assertBase58PublicKey(request.recipient, 'Solana recipient');
  const params = new URLSearchParams();
  const amount = assertPositiveAmount(request.amount);
  if (amount != null) params.set('amount', amount);
  if (request.token != null && request.token.trim().length > 0)
    params.set('spl-token', request.token.trim());
  if (request.memo != null && request.memo.trim().length > 0)
    params.set('memo', request.memo.trim());
  const query = params.toString();

  return query.length > 0 ? `solana:${recipient}?${query}` : `solana:${recipient}`;
}

function parseSolanaUri(raw: string): ParsedOfflineQrPayload | null {
  if (!raw.startsWith('solana:')) return null;
  const withoutScheme = raw.slice('solana:'.length);
  const [addressPart, queryPart = ''] = withoutScheme.split('?');
  const recipient = assertBase58PublicKey(
    decodeURIComponent(addressPart ?? ''),
    'Solana recipient',
  );
  const query = new URLSearchParams(queryPart);

  return {
    type: 'solana-address',
    raw,
    request: {
      recipient,
      amount: assertPositiveAmount(query.get('amount')),
      token: query.get('spl-token')?.trim() || query.get('token')?.trim() || null,
      memo: query.get('memo')?.trim() || null,
    },
  };
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as unknown;
  if (!isOfflinePayloadRecord(parsed)) {
    throw new Error('Nonce QR payload must decode to an object.');
  }
  if ('signedTransaction' in parsed || 'signedBlob' in parsed || 'rawTransaction' in parsed) {
    throw new Error('Nonce QR requests must not contain signed transaction data.');
  }
  return parsed;
}

function parseOffpayUri(raw: string): ParsedOfflineQrPayload | null {
  if (!raw.startsWith('offpay://')) return null;
  const url = new URL(raw);
  const parts = url.pathname.split('/').slice(1).map(decodeURIComponent);

  if (url.host === 'offline') {
    const recipient = assertBase58PublicKey(parts[0] ?? '', 'Offline recipient');
    return {
      type: 'offpay-offline-request',
      raw,
      request: {
        recipient,
        amount: assertPositiveAmount(parts[1] ?? null),
        token: parts[2]?.trim() || null,
        memo: parts[3]?.trim() || null,
      },
    };
  }

  if (url.host === 'receive') {
    const payload = decodeBase64UrlJson(parts[0] ?? '');
    const recipient = assertBase58PublicKey(String(payload.recipient ?? ''), 'Receive recipient');
    const networkValue =
      payload.network === 'mainnet' || payload.network === 'devnet' ? payload.network : null;
    const ble = isOfflinePayloadRecord(payload.ble) ? payload.ble : {};
    return {
      type: 'offpay-receive-request',
      raw,
      request: {
        recipient,
        amount: assertPositiveAmount(typeof payload.amount === 'string' ? payload.amount : null),
        token: typeof payload.token === 'string' ? payload.token : null,
        memo: typeof payload.memo === 'string' ? payload.memo : null,
        network: networkValue,
        route: payload.route === 'umbra' || payload.route === 'normal' ? payload.route : null,
        bleServiceUuid:
          typeof ble.serviceUuid === 'string' && ble.serviceUuid.length > 0
            ? ble.serviceUuid
            : null,
        bleName: typeof ble.name === 'string' && ble.name.length > 0 ? ble.name : null,
        sessionNonce:
          typeof payload.sessionNonce === 'string' && payload.sessionNonce.length > 0
            ? payload.sessionNonce
            : null,
      },
    };
  }

  if (url.host === 'private') {
    const umbraAddress = parts[0]?.trim();
    if (umbraAddress == null || umbraAddress.length === 0) {
      throw new Error('Umbra private QR is missing an address.');
    }
    return {
      type: 'umbra-private-address',
      raw,
      umbraAddress,
    };
  }

  if (url.host === 'nonce') {
    const payload = decodeBase64UrlJson(parts[0] ?? '');
    const recipient = assertBase58PublicKey(
      String(payload.recipient ?? ''),
      'Nonce request recipient',
    );
    const nonceAccount = assertBase58PublicKey(String(payload.nonceAccount ?? ''), 'Nonce account');
    const cachedNonce =
      typeof payload.cachedNonce === 'string' && payload.cachedNonce.length > 0
        ? assertCachedNonce(payload.cachedNonce)
        : null;
    const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : null;

    return {
      type: 'nonce-payment-request',
      raw,
      request: {
        recipient,
        amount: assertPositiveAmount(typeof payload.amount === 'string' ? payload.amount : null),
        token: typeof payload.token === 'string' ? payload.token : null,
        memo: typeof payload.memo === 'string' ? payload.memo : null,
        nonceAccount,
        cachedNonce,
        expiresAt,
      },
    };
  }

  return null;
}

export function parseOfflineQrPayload(rawPayload: string): ParsedOfflineQrPayload {
  const raw = rawPayload.trim();
  if (raw.length === 0) {
    throw new Error('QR payload is empty.');
  }

  const parsed = parseSolanaUri(raw) ?? parseOffpayUri(raw);
  if (parsed == null) {
    throw new Error(
      'Unsupported QR payload. Use a Solana, OffPay receive, private, or nonce request QR.',
    );
  }

  return parsed;
}
