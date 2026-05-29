import { Buffer } from 'buffer';

import bs58 from 'bs58';

/**
 * Pure transaction parsing primitives used by the MagicBlock private
 * payment client.
 *
 * The MagicBlock provider returns base64-encoded Solana transactions
 * (legacy and versioned message formats). Before signing and
 * broadcasting we deserialize the message in-process so we can verify
 * the recipient, mint, and amount match what the user requested. This
 * file owns the byte-level serialization knowledge: short-vec
 * compact-u16 decoding, compiled-instruction layout, address-table
 * lookups, and amount/byte search helpers.
 *
 * Everything in this file is pure — no I/O, no network, no policy.
 */

export interface ShortVecReadResult {
  value: number;
  offset: number;
}

export interface ParsedInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

export interface ParsedAddressTableLookup {
  accountKey: string;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface ParsedTransactionMessage {
  signatureCount: number;
  requiredSignerCount: number;
  accountKeys: string[];
  requiredSigners: string[];
  recentBlockhash: string;
  instructions: ParsedInstruction[];
  loadedAddressCount: number;
  addressTableLookups: ParsedAddressTableLookup[];
}

export function readShortVec(bytes: Uint8Array, startOffset: number): ShortVecReadResult {
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

export function assertRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`Malformed Solana transaction: ${label} is out of bounds.`);
  }
}

export function decodeBase64Transaction(transactionBase64: string): Uint8Array {
  const trimmed = transactionBase64.trim();
  if (trimmed.length === 0) {
    throw new Error('Unsigned private payment transaction is missing.');
  }

  const decoded = Uint8Array.from(Buffer.from(trimmed, 'base64'));
  if (decoded.length === 0) {
    throw new Error('Unsigned private payment transaction is empty.');
  }

  return decoded;
}

export function parseCompiledInstruction(
  message: Uint8Array,
  startOffset: number,
): { instruction: ParsedInstruction; offset: number } {
  let cursor = startOffset;
  assertRange(message, cursor, 1, 'instruction program id');
  const programIdIndex = message[cursor] ?? 0;
  cursor += 1;

  const accountsLength = readShortVec(message, cursor);
  cursor = accountsLength.offset;
  assertRange(message, cursor, accountsLength.value, 'instruction account indexes');
  const accountIndexes = Array.from(message.subarray(cursor, cursor + accountsLength.value));
  cursor += accountsLength.value;

  const dataLength = readShortVec(message, cursor);
  cursor = dataLength.offset;
  assertRange(message, cursor, dataLength.value, 'instruction data');
  const data = message.subarray(cursor, cursor + dataLength.value);
  cursor += dataLength.value;

  return {
    instruction: {
      programIdIndex,
      accountIndexes,
      data,
    },
    offset: cursor,
  };
}

export function parseSerializedTransaction(transactionBase64: string): ParsedTransactionMessage {
  const transaction = decodeBase64Transaction(transactionBase64);
  const signatureCount = readShortVec(transaction, 0);
  const signaturesOffset = signatureCount.offset;
  const messageOffset = signaturesOffset + signatureCount.value * 64;

  assertRange(transaction, signaturesOffset, signatureCount.value * 64, 'signatures');
  assertRange(transaction, messageOffset, transaction.length - messageOffset, 'message');

  const message = transaction.subarray(messageOffset);
  let cursor = 0;
  let isVersioned = false;
  if ((message[cursor] ?? 0) & 0x80) {
    isVersioned = true;
    const version = (message[cursor] ?? 0) & 0x7f;
    if (version !== 0) {
      throw new Error(`Unsupported Solana transaction version: ${version}.`);
    }
    cursor += 1;
  }

  assertRange(message, cursor, 3, 'message header');
  const requiredSignerCount = message[cursor] ?? 0;
  cursor += 3;

  const accountKeyCount = readShortVec(message, cursor);
  cursor = accountKeyCount.offset;
  assertRange(message, cursor, accountKeyCount.value * 32, 'account keys');
  const accountKeys = Array.from({ length: accountKeyCount.value }, (_, index) => {
    const keyStart = cursor + index * 32;
    return bs58.encode(message.subarray(keyStart, keyStart + 32));
  });
  cursor += accountKeyCount.value * 32;

  assertRange(message, cursor, 32, 'recent blockhash');
  const recentBlockhash = bs58.encode(message.subarray(cursor, cursor + 32));
  cursor += 32;

  const instructionCount = readShortVec(message, cursor);
  cursor = instructionCount.offset;
  const instructions: ParsedInstruction[] = [];
  for (let index = 0; index < instructionCount.value; index += 1) {
    const parsedInstruction = parseCompiledInstruction(message, cursor);
    instructions.push(parsedInstruction.instruction);
    cursor = parsedInstruction.offset;
  }

  let loadedAddressCount = 0;
  const addressTableLookups: ParsedAddressTableLookup[] = [];
  if (isVersioned) {
    const lookupCount = readShortVec(message, cursor);
    cursor = lookupCount.offset;
    for (let index = 0; index < lookupCount.value; index += 1) {
      assertRange(message, cursor, 32, 'address table lookup key');
      const accountKey = bs58.encode(message.subarray(cursor, cursor + 32));
      cursor += 32;

      const writableIndexes = readShortVec(message, cursor);
      cursor = writableIndexes.offset;
      assertRange(message, cursor, writableIndexes.value, 'writable lookup indexes');
      const writableAccountIndexes = Array.from(
        message.subarray(cursor, cursor + writableIndexes.value),
      );
      cursor += writableIndexes.value;
      loadedAddressCount += writableIndexes.value;

      const readonlyIndexes = readShortVec(message, cursor);
      cursor = readonlyIndexes.offset;
      assertRange(message, cursor, readonlyIndexes.value, 'readonly lookup indexes');
      const readonlyAccountIndexes = Array.from(
        message.subarray(cursor, cursor + readonlyIndexes.value),
      );
      cursor += readonlyIndexes.value;
      loadedAddressCount += readonlyIndexes.value;

      addressTableLookups.push({
        accountKey,
        writableIndexes: writableAccountIndexes,
        readonlyIndexes: readonlyAccountIndexes,
      });
    }
  }

  if (signatureCount.value < requiredSignerCount) {
    throw new Error('Private payment transaction is missing required signature slots.');
  }

  if (instructions.length === 0) {
    throw new Error('Private payment transaction contains no instructions.');
  }

  return {
    signatureCount: signatureCount.value,
    requiredSignerCount,
    accountKeys,
    requiredSigners: accountKeys.slice(0, requiredSignerCount),
    recentBlockhash,
    instructions,
    loadedAddressCount,
    addressTableLookups,
  };
}

export function normalizeAtomicAmount(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Private payment amount must be a raw integer amount.');
  }

  const parsed = BigInt(trimmed);
  if (parsed <= 0n) {
    throw new Error('Private payment amount must be greater than zero.');
  }

  return parsed;
}

export function u64FromLittleEndian(data: Uint8Array, offset: number): bigint | null {
  if (offset < 0 || offset + 8 > data.length) return null;

  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

export function dataContainsBytes(data: Uint8Array, expected: Uint8Array): boolean {
  if (expected.length === 0 || data.length < expected.length) return false;

  for (let offset = 0; offset <= data.length - expected.length; offset += 1) {
    let matched = true;
    for (let index = 0; index < expected.length; index += 1) {
      if (data[offset + index] !== expected[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

export function instructionContainsAmount(data: Uint8Array, amount: bigint): boolean {
  for (let offset = 0; offset <= data.length - 8; offset += 1) {
    if (u64FromLittleEndian(data, offset) === amount) return true;
  }

  return false;
}

export function assertInstructionIndexesAreSafe(
  parsed: ParsedTransactionMessage,
  accountKeyCount = parsed.accountKeys.length + parsed.loadedAddressCount,
): void {
  for (const instruction of parsed.instructions) {
    if (instruction.programIdIndex >= accountKeyCount) {
      throw new Error('Private payment transaction uses an unresolved program id.');
    }

    for (const accountIndex of instruction.accountIndexes) {
      if (accountIndex >= accountKeyCount) {
        throw new Error('Private payment transaction references an invalid account index.');
      }
    }
  }
}
