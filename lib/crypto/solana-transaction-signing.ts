import { Buffer } from 'buffer';

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { Transaction, VersionedTransaction } from '@solana/web3.js';

import {
  getStoredWalletInfo,
  getStoredWalletSigningMaterialWithAuth,
} from '@/lib/wallet/secure-wallet-store';
import {
  decodeSigningSeedFromPrivateKey,
  deriveSigningSeedFromMnemonic,
} from '@/lib/wallet/wallet';
import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
import { getOrDeriveSigningSeed } from '@/lib/wallet/signing-seed-cache';
import { mark, measure } from '@/lib/perf/perf-marks';
import { yieldToEventLoop, yieldToUi } from '@/lib/perf/ui-work-scheduler';
import {
  getExternalWalletSigner,
  waitForExternalWalletSigner,
} from '@/lib/wallet/external-wallet-signing';
import {
  getWalletSigningBlocker,
  walletHasLocalSigningMaterial,
} from '@/lib/wallet/wallet-capabilities';

import type {
  ExternalSignableSolanaTransaction,
  ExternalWalletSigner,
} from '@/lib/wallet/external-wallet-signing';

const EXTERNAL_SIGNER_WAIT_TIMEOUT_MS = 8000;

interface SignSerializedTransactionParams {
  unsignedTransaction: string;
  walletAddress: string;
  walletId?: string | null;
}

interface SignSerializedTransactionsParams {
  unsignedTransactions: readonly string[];
  walletAddress: string;
  walletId?: string | null;
}

interface SignSerializedTransactionWithSeedParams {
  unsignedTransaction: string;
  walletAddress: string;
  signingSeed: Uint8Array;
  transactionLabel?: string;
}

interface ShortVecReadResult {
  value: number;
  offset: number;
}

interface ParsedMessageHeader {
  numRequiredSignatures: number;
  accountKeysOffset: number;
  accountKeyCount: number;
}

function readShortVec(bytes: Uint8Array, startOffset: number): ShortVecReadResult {
  let offset = startOffset;
  let value = 0;
  let shift = 0;

  while (offset < bytes.length) {
    const current = bytes[offset];
    value |= (current & 0x7f) << shift;
    offset += 1;

    if ((current & 0x80) === 0) {
      return { value, offset };
    }

    shift += 7;
    if (shift > 28) break;
  }

  throw new Error('Unable to decode Solana transaction length prefix.');
}

function assertRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`Malformed Solana transaction: ${label} is out of bounds.`);
  }
}

function parseMessageHeader(message: Uint8Array): ParsedMessageHeader {
  if (message.length < 3) {
    throw new Error('Malformed Solana transaction: message header is missing.');
  }

  let cursor = 0;
  const firstByte = message[cursor];

  if ((firstByte & 0x80) !== 0) {
    const version = firstByte & 0x7f;
    if (version !== 0) {
      throw new Error(`Unsupported Solana transaction version: ${version}.`);
    }
    cursor += 1;
  }

  assertRange(message, cursor, 3, 'message header');
  const numRequiredSignatures = message[cursor];
  cursor += 3;

  const keyCount = readShortVec(message, cursor);
  cursor = keyCount.offset;

  assertRange(message, cursor, keyCount.value * 32, 'account keys');

  return {
    numRequiredSignatures,
    accountKeysOffset: cursor,
    accountKeyCount: keyCount.value,
  };
}

function findRequiredSignerIndex(message: Uint8Array, walletAddress: string): number {
  const walletBytes = bs58.decode(walletAddress);
  if (walletBytes.length !== 32) {
    throw new Error('Active wallet address is not a valid Solana public key.');
  }

  const header = parseMessageHeader(message);
  const signerCount = Math.min(header.numRequiredSignatures, header.accountKeyCount);

  for (let index = 0; index < signerCount; index += 1) {
    const keyOffset = header.accountKeysOffset + index * 32;
    const accountKey = message.subarray(keyOffset, keyOffset + 32);
    const matches = accountKey.every((value, keyIndex) => value === walletBytes[keyIndex]);
    if (matches) return index;
  }

  throw new Error('Requested signer is not required for this transaction.');
}

function getMessageFromSerializedTransaction(transactionBase64: string): {
  transaction: Uint8Array;
  signatureCount: ShortVecReadResult;
  signaturesOffset: number;
  messageOffset: number;
  message: Uint8Array;
} {
  const transaction = Uint8Array.from(Buffer.from(transactionBase64, 'base64'));
  const signatureCount = readShortVec(transaction, 0);
  const signaturesOffset = signatureCount.offset;
  const messageOffset = signaturesOffset + signatureCount.value * 64;

  assertRange(transaction, signaturesOffset, signatureCount.value * 64, 'signatures');
  assertRange(transaction, messageOffset, transaction.length - messageOffset, 'message');

  return {
    transaction,
    signatureCount,
    signaturesOffset,
    messageOffset,
    message: transaction.subarray(messageOffset),
  };
}

export function getRequiredSignersForSerializedTransaction(transactionBase64: string): string[] {
  const { message } = getMessageFromSerializedTransaction(transactionBase64);
  const header = parseMessageHeader(message);

  return Array.from(
    { length: Math.min(header.numRequiredSignatures, header.accountKeyCount) },
    (_, index) => {
      const keyOffset = header.accountKeysOffset + index * 32;
      return bs58.encode(message.subarray(keyOffset, keyOffset + 32));
    },
  );
}

async function getSigningSeedForWallet(
  walletAddress: string,
  walletId?: string | null,
): Promise<Uint8Array> {
  const signingSeed = await getOrDeriveSigningSeed({
    walletAddress,
    derive: async () => {
      const walletInfo = await getStoredWalletInfo(walletId ?? undefined);
      if (walletInfo != null && !walletHasLocalSigningMaterial(walletInfo.importMethod)) {
        throw new Error(
          getWalletSigningBlocker(walletInfo.importMethod, 'This action', walletAddress) ??
            'Wallet signing is not available.',
        );
      }
      const material = await getStoredWalletSigningMaterialWithAuth(walletId ?? undefined);
      if (material == null) {
        throw new Error('Unlock your wallet to sign this swap.');
      }

      const seed =
        material.mnemonic != null
          ? await deriveSigningSeedFromMnemonic(material.mnemonic)
          : material.privateKey != null
            ? decodeSigningSeedFromPrivateKey(material.privateKey)
            : null;

      if (seed == null) {
        throw new Error('No signing material is available for this wallet.');
      }

      // Verify before caching: a corrupt/mismatched private key
      // should never be cached. Subsequent cache hits skip this
      // check; the post-derive guard plus clear-on-mutation keeps
      // the address-to-seed mapping correct.
      const derivedPublicKey = ed25519.getPublicKey(seed);
      try {
        if (bs58.encode(derivedPublicKey) !== walletAddress) {
          zeroOutBytes(seed);
          throw new Error('Stored signing material does not match the active wallet.');
        }
      } finally {
        zeroOutBytes(derivedPublicKey);
      }

      return seed;
    },
  });

  return signingSeed;
}

async function getExternalSignerForStoredWallet(
  walletAddress: string,
  walletId?: string | null,
): Promise<ExternalWalletSigner | null> {
  const walletInfo = await getStoredWalletInfo(walletId ?? undefined);
  if (walletInfo == null || walletInfo.importMethod !== 'privy-embedded') return null;
  if (walletInfo.publicKey !== walletAddress) {
    throw new Error('The active Privy wallet does not match the requested signer.');
  }

  const signer =
    getExternalWalletSigner(walletAddress) ??
    (await waitForExternalWalletSigner(walletAddress, EXTERNAL_SIGNER_WAIT_TIMEOUT_MS));
  if (signer == null) {
    throw new Error(
      getWalletSigningBlocker(walletInfo.importMethod, 'Privy wallet signing', walletAddress) ??
        'Privy wallet signing is not ready.',
    );
  }

  return signer;
}

function deserializeSignableTransaction(
  transactionBase64: string,
): ExternalSignableSolanaTransaction {
  const { transaction, message } = getMessageFromSerializedTransaction(transactionBase64);
  if ((message[0] & 0x80) !== 0) {
    return VersionedTransaction.deserialize(transaction);
  }

  return Transaction.from(Buffer.from(transaction));
}

function serializeSignableTransaction(transaction: ExternalSignableSolanaTransaction): string {
  const serialized =
    transaction instanceof VersionedTransaction
      ? transaction.serialize()
      : transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });

  return Buffer.from(serialized).toString('base64');
}

async function signSerializedTransactionWithExternalSigner(params: {
  unsignedTransaction: string;
  walletAddress: string;
  signer: ExternalWalletSigner;
}): Promise<string> {
  const { message } = getMessageFromSerializedTransaction(params.unsignedTransaction);
  findRequiredSignerIndex(message, params.walletAddress);

  const transaction = deserializeSignableTransaction(params.unsignedTransaction);
  const signedTransaction = await params.signer.signTransaction(transaction);
  return serializeSignableTransaction(signedTransaction);
}

function verifyExternalSignature(params: {
  signature: Uint8Array;
  message: Uint8Array;
  walletAddress: string;
}): void {
  if (params.signature.length !== 64) {
    throw new Error('Wallet provider returned an invalid Solana signature.');
  }

  const publicKey = bs58.decode(params.walletAddress);
  if (publicKey.length !== 32) {
    throw new Error('Active wallet address is not a valid Solana public key.');
  }

  if (!ed25519.verify(params.signature, params.message, publicKey)) {
    throw new Error('Wallet provider signature does not match the active wallet.');
  }
}

export async function signSerializedTransactionForWallet({
  unsignedTransaction,
  walletAddress,
  walletId,
}: SignSerializedTransactionParams): Promise<string> {
  const startedAt = mark();
  const externalSigner = await getExternalSignerForStoredWallet(walletAddress, walletId);
  if (externalSigner != null) {
    await yieldToUi();
    const signedTransaction = await signSerializedTransactionWithExternalSigner({
      unsignedTransaction,
      walletAddress,
      signer: externalSigner,
    });
    measure('txSign.serializedWithExternal', startedAt, { label: 'wallet transaction' });
    await yieldToEventLoop();
    return signedTransaction;
  }

  const signingSeed = await getSigningSeedForWallet(walletAddress, walletId);
  try {
    await yieldToUi();
    return signSerializedTransactionWithSeed({
      unsignedTransaction,
      walletAddress,
      signingSeed,
      transactionLabel: 'wallet transaction',
    });
  } finally {
    zeroOutBytes(signingSeed);
  }
}

export async function signSerializedTransactionsForWallet({
  unsignedTransactions,
  walletAddress,
  walletId,
}: SignSerializedTransactionsParams): Promise<string[]> {
  if (unsignedTransactions.length === 0) return [];

  const externalSigner = await getExternalSignerForStoredWallet(walletAddress, walletId);
  if (externalSigner != null) {
    const transactions = unsignedTransactions.map((unsignedTransaction) => {
      const { message } = getMessageFromSerializedTransaction(unsignedTransaction);
      findRequiredSignerIndex(message, walletAddress);
      return deserializeSignableTransaction(unsignedTransaction);
    });

    await yieldToUi();
    const signedTransactions =
      externalSigner.signTransactions != null
        ? await externalSigner.signTransactions(transactions)
        : await Promise.all(
            transactions.map((transaction) => externalSigner.signTransaction(transaction)),
          );
    await yieldToEventLoop();
    return signedTransactions.map(serializeSignableTransaction);
  }

  const signingSeed = await getSigningSeedForWallet(walletAddress, walletId);
  try {
    const signedTransactions: string[] = [];
    for (let index = 0; index < unsignedTransactions.length; index += 1) {
      await yieldToUi();
      signedTransactions.push(
        signSerializedTransactionWithSeed({
          unsignedTransaction: unsignedTransactions[index],
          walletAddress,
          signingSeed,
          transactionLabel: 'wallet transaction',
        }),
      );

      await yieldToEventLoop();
    }
    return signedTransactions;
  } finally {
    zeroOutBytes(signingSeed);
  }
}

export function signSerializedTransactionWithSeed({
  unsignedTransaction,
  walletAddress,
  signingSeed,
  transactionLabel = 'transaction',
}: SignSerializedTransactionWithSeedParams): string {
  const startedAt = mark();
  const { transaction, signatureCount, signaturesOffset, message } =
    getMessageFromSerializedTransaction(unsignedTransaction);
  const signerIndex = findRequiredSignerIndex(message, walletAddress);

  if (signerIndex >= signatureCount.value) {
    throw new Error(`${transactionLabel} does not contain a signature slot for this signer.`);
  }

  const derivedPublicKey = ed25519.getPublicKey(signingSeed);
  try {
    if (bs58.encode(derivedPublicKey) !== walletAddress) {
      throw new Error(`${transactionLabel} signer does not match the provided key.`);
    }

    const signStartedAt = mark();
    const signature = ed25519.sign(message, signingSeed);
    measure('txSign.ed25519.sign', signStartedAt, { label: transactionLabel });
    try {
      const signatureOffset = signaturesOffset + signerIndex * 64;
      transaction.set(signature, signatureOffset);
      const result = Buffer.from(transaction).toString('base64');
      measure('txSign.serializedWithSeed', startedAt, { label: transactionLabel });
      return result;
    } finally {
      zeroOutBytes(signature);
    }
  } finally {
    zeroOutBytes(derivedPublicKey);
  }
}

export async function signSerializedTransactionWithSeedAsync(
  params: SignSerializedTransactionWithSeedParams,
): Promise<string> {
  await yieldToUi();
  const signedTransaction = signSerializedTransactionWithSeed(params);
  await yieldToEventLoop();
  return signedTransaction;
}

export async function signMessageForWallet(params: {
  message: string;
  walletAddress: string;
  walletId?: string | null;
}): Promise<string> {
  const startedAt = mark();
  const externalSigner = await getExternalSignerForStoredWallet(
    params.walletAddress,
    params.walletId,
  );
  if (externalSigner != null) {
    await yieldToUi();
    const messageBytes = Uint8Array.from(Buffer.from(params.message, 'utf8'));
    const signature = await externalSigner.signMessage(messageBytes);
    verifyExternalSignature({
      signature,
      message: messageBytes,
      walletAddress: params.walletAddress,
    });
    measure('txSign.signMessage.external.total', startedAt);
    await yieldToEventLoop();
    return bs58.encode(signature);
  }

  const signingSeed = await getSigningSeedForWallet(params.walletAddress, params.walletId);
  try {
    await yieldToUi();
    const signStartedAt = mark();
    const signature = ed25519.sign(Buffer.from(params.message, 'utf8'), signingSeed);
    measure('txSign.signMessage.ed25519.sign', signStartedAt);
    try {
      const encoded = bs58.encode(signature);
      measure('txSign.signMessage.total', startedAt);
      return encoded;
    } finally {
      zeroOutBytes(signature);
    }
  } finally {
    zeroOutBytes(signingSeed);
  }
}
