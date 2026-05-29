import { Buffer } from 'buffer';

import { sha256 } from '@noble/hashes/sha2.js';

import type { OffpayNetwork } from '@/types/offpay-api';

export const OFFPAY_BLE_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
export const OFFPAY_BLE_IDENTITY_CHARACTERISTIC_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';
export const OFFPAY_BLE_PAYLOAD_CHARACTERISTIC_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
export const OFFPAY_BLE_PROTOCOL = 'offpay-offline-ble';
export const OFFPAY_BLE_VERSION = 1;

const BLE_FRAME_DATA_CHARS = 360;

export interface OfflineBlePaymentPayload {
  version: 1;
  protocol: typeof OFFPAY_BLE_PROTOCOL;
  type: 'offline-payment';
  txId: string;
  signedBlob: string;
  network: OffpayNetwork;
  sender: string;
  recipient: string;
  recipientTokenAccount?: string | null;
  amount: string;
  rawAmount: string;
  tokenMint: string;
  tokenSymbol: 'USDC' | 'USDT';
  tokenDecimals?: number | null;
  createdAt: number;
  sessionId: string;
}

export function createOfflineBleDeviceName(walletAddress: string): string {
  return `OffPay-${walletAddress.slice(0, 4)}-${walletAddress.slice(-4)}`;
}

export interface OfflineBleFrame {
  version: 1;
  protocol: typeof OFFPAY_BLE_PROTOCOL;
  sessionId: string;
  index: number;
  total: number;
  checksum: string;
  data: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function utf8ToHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

export function hexToUtf8(value: string): string {
  return Buffer.from(value, 'hex').toString('utf8');
}

export function checksumPayload(value: string): string {
  return bytesToHex(sha256(Buffer.from(value, 'utf8'))).slice(0, 32);
}

export function serializeOfflineBlePayload(payload: OfflineBlePaymentPayload): string {
  return JSON.stringify(payload);
}

export function parseOfflineBlePayload(value: string): OfflineBlePaymentPayload {
  const parsed = JSON.parse(value) as Partial<OfflineBlePaymentPayload>;
  if (
    parsed.version !== OFFPAY_BLE_VERSION ||
    parsed.protocol !== OFFPAY_BLE_PROTOCOL ||
    parsed.type !== 'offline-payment' ||
    typeof parsed.txId !== 'string' ||
    typeof parsed.signedBlob !== 'string' ||
    (parsed.network !== 'mainnet' && parsed.network !== 'devnet') ||
    typeof parsed.sender !== 'string' ||
    typeof parsed.recipient !== 'string' ||
    typeof parsed.amount !== 'string' ||
    typeof parsed.rawAmount !== 'string' ||
    typeof parsed.tokenMint !== 'string' ||
    (parsed.tokenSymbol !== 'USDC' && parsed.tokenSymbol !== 'USDT') ||
    (parsed.tokenDecimals != null &&
      (typeof parsed.tokenDecimals !== 'number' ||
        !Number.isInteger(parsed.tokenDecimals) ||
        parsed.tokenDecimals < 0 ||
        parsed.tokenDecimals > 255)) ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.sessionId !== 'string'
  ) {
    throw new Error('Offline BLE payment payload is invalid.');
  }

  return {
    version: 1,
    protocol: OFFPAY_BLE_PROTOCOL,
    type: 'offline-payment',
    txId: parsed.txId,
    signedBlob: parsed.signedBlob,
    network: parsed.network,
    sender: parsed.sender,
    recipient: parsed.recipient,
    recipientTokenAccount:
      typeof parsed.recipientTokenAccount === 'string' ? parsed.recipientTokenAccount : null,
    amount: parsed.amount,
    rawAmount: parsed.rawAmount,
    tokenMint: parsed.tokenMint,
    tokenSymbol: parsed.tokenSymbol,
    tokenDecimals: typeof parsed.tokenDecimals === 'number' ? parsed.tokenDecimals : null,
    createdAt: parsed.createdAt,
    sessionId: parsed.sessionId,
  };
}

export function createOfflineBleFrames(payload: OfflineBlePaymentPayload): OfflineBleFrame[] {
  const serialized = serializeOfflineBlePayload(payload);
  const checksum = checksumPayload(serialized);
  const total = Math.max(1, Math.ceil(serialized.length / BLE_FRAME_DATA_CHARS));

  return Array.from({ length: total }, (_, index) => ({
    version: 1,
    protocol: OFFPAY_BLE_PROTOCOL,
    sessionId: payload.sessionId,
    index,
    total,
    checksum,
    data: serialized.slice(index * BLE_FRAME_DATA_CHARS, (index + 1) * BLE_FRAME_DATA_CHARS),
  }));
}

export function parseOfflineBleFrame(hexValue: string): OfflineBleFrame {
  const parsed = JSON.parse(hexToUtf8(hexValue)) as Partial<OfflineBleFrame>;
  if (
    parsed.version !== OFFPAY_BLE_VERSION ||
    parsed.protocol !== OFFPAY_BLE_PROTOCOL ||
    typeof parsed.sessionId !== 'string' ||
    typeof parsed.index !== 'number' ||
    typeof parsed.total !== 'number' ||
    typeof parsed.checksum !== 'string' ||
    typeof parsed.data !== 'string' ||
    parsed.index < 0 ||
    parsed.total <= 0 ||
    parsed.index >= parsed.total
  ) {
    throw new Error('Offline BLE frame is invalid.');
  }

  return {
    version: 1,
    protocol: OFFPAY_BLE_PROTOCOL,
    sessionId: parsed.sessionId,
    index: parsed.index,
    total: parsed.total,
    checksum: parsed.checksum,
    data: parsed.data,
  };
}

export function serializeOfflineBleFrameToBytes(frame: OfflineBleFrame): number[] {
  return Array.from(Buffer.from(JSON.stringify(frame), 'utf8'));
}

export function reassembleOfflineBlePayload(frames: OfflineBleFrame[]): OfflineBlePaymentPayload {
  if (frames.length === 0) throw new Error('No offline BLE frames were received.');
  const [first] = frames;
  if (first == null) throw new Error('No offline BLE frames were received.');
  if (frames.length !== first.total) throw new Error('Offline BLE payload is incomplete.');

  const sorted = [...frames].sort((left, right) => left.index - right.index);
  sorted.forEach((frame, index) => {
    if (
      frame.sessionId !== first.sessionId ||
      frame.total !== first.total ||
      frame.checksum !== first.checksum ||
      frame.index !== index
    ) {
      throw new Error('Offline BLE frames do not belong to the same payload.');
    }
  });

  const serialized = sorted.map((frame) => frame.data).join('');
  if (checksumPayload(serialized) !== first.checksum) {
    throw new Error('Offline BLE payload checksum failed.');
  }

  return parseOfflineBlePayload(serialized);
}
