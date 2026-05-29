import { Buffer } from 'buffer';

import bs58 from 'bs58';

import { getRpcAccounts } from '@/lib/api/offpay-api-client';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  deriveAssociatedTokenAddress,
} from '@/lib/crypto/solana-token-accounts';
import {
  dataContainsBytes,
  u64FromLittleEndian,
  type ParsedInstruction,
  type ParsedTransactionMessage,
} from '@/lib/magicblock/tx-parsing';

import type { OffpayNetwork, RpcAccountRecord } from '@/types/offpay-api';

/**
 * Token-transfer instruction inspection helpers used by the MagicBlock
 * private payment verifier.
 *
 * These functions know the SPL Token / Token-2022 instruction layout
 * (`Transfer` = type 3, `TransferChecked` = type 12) and walk a parsed
 * Solana message to extract source/destination accounts, mint
 * accounts, and to test whether an expected recipient is present.
 *
 * The address-table-lookup helpers resolve versioned-message
 * `addressTableLookups` into the loaded read-write/read-only addresses
 * by reading the lookup table accounts from the OffPay RPC proxy.
 *
 * Most helpers here are pure; the ones that hit `getRpcAccounts`
 * (`resolveMessageAccountKeys`, `verifyRequestedTokenMint`) are
 * explicitly async.
 */

const TOKEN_PROGRAM_IDS = new Set([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
const ADDRESS_LOOKUP_TABLE_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';
const ADDRESS_LOOKUP_TABLE_META_SIZE = 56;

export function instructionHasTokenTransferAmount(params: {
  instruction: ParsedInstruction;
  accountKeys: string[];
  amount: bigint;
}): boolean {
  const programId = params.accountKeys[params.instruction.programIdIndex];
  if (programId == null || !TOKEN_PROGRAM_IDS.has(programId)) return false;

  const instructionType = params.instruction.data[0];
  if (instructionType === 3) {
    return u64FromLittleEndian(params.instruction.data, 1) === params.amount;
  }

  if (instructionType === 12) {
    return u64FromLittleEndian(params.instruction.data, 1) === params.amount;
  }

  return false;
}

function getStaticAccountKey(
  parsed: ParsedTransactionMessage,
  accountIndex: number,
): string | null {
  return accountIndex < parsed.accountKeys.length
    ? (parsed.accountKeys[accountIndex] ?? null)
    : null;
}

function instructionHasRequestedMintAccount(params: {
  instruction: ParsedInstruction;
  parsed: ParsedTransactionMessage;
  mint: string;
}): boolean {
  const programId = params.parsed.accountKeys[params.instruction.programIdIndex];
  if (programId == null || !TOKEN_PROGRAM_IDS.has(programId)) return false;

  const instructionType = params.instruction.data[0];
  if (instructionType !== 12) return false;

  const mintAccountIndex = params.instruction.accountIndexes[1];
  if (mintAccountIndex == null) return false;

  return getStaticAccountKey(params.parsed, mintAccountIndex) === params.mint;
}

export function getTokenTransferSourceAccounts(params: {
  parsed: ParsedTransactionMessage;
  accountKeys: string[];
  amount: bigint;
}): string[] {
  const sourceAccounts = new Set<string>();

  for (const instruction of params.parsed.instructions) {
    const programId = params.accountKeys[instruction.programIdIndex];
    if (programId == null || !TOKEN_PROGRAM_IDS.has(programId)) continue;
    if (
      !instructionHasTokenTransferAmount({
        instruction,
        accountKeys: params.accountKeys,
        amount: params.amount,
      })
    ) {
      continue;
    }

    const sourceAccountIndex = instruction.accountIndexes[0];
    if (sourceAccountIndex == null) continue;

    const sourceAccount = params.accountKeys[sourceAccountIndex] ?? null;
    if (sourceAccount != null) {
      sourceAccounts.add(sourceAccount);
    }
  }

  return Array.from(sourceAccounts);
}

export function getTokenTransferDestinationAccounts(params: {
  parsed: ParsedTransactionMessage;
  accountKeys: string[];
  amount: bigint;
}): string[] {
  const destinationAccounts = new Set<string>();

  for (const instruction of params.parsed.instructions) {
    const programId = params.accountKeys[instruction.programIdIndex];
    if (programId == null || !TOKEN_PROGRAM_IDS.has(programId)) continue;
    if (
      !instructionHasTokenTransferAmount({
        instruction,
        accountKeys: params.accountKeys,
        amount: params.amount,
      })
    ) {
      continue;
    }

    const instructionType = instruction.data[0];
    const destinationAccountIndex =
      instructionType === 3
        ? instruction.accountIndexes[1]
        : instructionType === 12
          ? instruction.accountIndexes[2]
          : undefined;
    if (destinationAccountIndex == null) continue;

    const destinationAccount = params.accountKeys[destinationAccountIndex] ?? null;
    if (destinationAccount != null) {
      destinationAccounts.add(destinationAccount);
    }
  }

  return Array.from(destinationAccounts);
}

export function getExpectedRecipientAccounts(params: {
  recipient: string;
  mint: string;
}): string[] {
  return [
    params.recipient,
    deriveAssociatedTokenAddress({
      owner: params.recipient,
      mint: params.mint,
      tokenProgramId: SPL_TOKEN_PROGRAM_ID,
    }),
    deriveAssociatedTokenAddress({
      owner: params.recipient,
      mint: params.mint,
      tokenProgramId: TOKEN_2022_PROGRAM_ID,
    }),
  ];
}

export function instructionDataContainsAnyAccount(params: {
  parsed: ParsedTransactionMessage;
  expectedAccounts: string[];
}): boolean {
  const expectedBytes = params.expectedAccounts.map((account) => bs58.decode(account));
  return params.parsed.instructions.some((instruction) =>
    expectedBytes.some((accountBytes) => dataContainsBytes(instruction.data, accountBytes)),
  );
}

export function verifyExpectedRecipient(params: {
  parsed: ParsedTransactionMessage;
  accountKeys: string[];
  recipient: string;
  mint: string;
  amount: bigint;
}): boolean {
  const expectedRecipientAccountList = getExpectedRecipientAccounts({
    recipient: params.recipient,
    mint: params.mint,
  });
  const expectedRecipientAccounts = new Set(expectedRecipientAccountList);
  const transferDestinations = getTokenTransferDestinationAccounts({
    parsed: params.parsed,
    accountKeys: params.accountKeys,
    amount: params.amount,
  });
  const recipientAppearsInMessage =
    params.accountKeys.some((account) => expectedRecipientAccounts.has(account)) ||
    instructionDataContainsAnyAccount({
      parsed: params.parsed,
      expectedAccounts: expectedRecipientAccountList,
    });

  if (transferDestinations.length > 0) {
    return (
      transferDestinations.some((account) => expectedRecipientAccounts.has(account)) ||
      recipientAppearsInMessage
    );
  }

  return recipientAppearsInMessage;
}

function getAddressLookupTableAddresses(record: RpcAccountRecord | null | undefined): string[] {
  const dataBase64 = record?.data ?? record?.dataBase64 ?? null;
  if (dataBase64 == null || record?.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM_ID) {
    return [];
  }

  const data = Uint8Array.from(Buffer.from(dataBase64, 'base64'));
  if (data.length <= ADDRESS_LOOKUP_TABLE_META_SIZE) {
    return [];
  }

  const addresses: string[] = [];
  for (let offset = ADDRESS_LOOKUP_TABLE_META_SIZE; offset + 32 <= data.length; offset += 32) {
    addresses.push(bs58.encode(data.subarray(offset, offset + 32)));
  }

  return addresses;
}

function resolveLookupIndexes(params: {
  addresses: string[];
  indexes: number[];
  label: string;
}): string[] {
  return params.indexes.map((index) => {
    const address = params.addresses[index];
    if (address == null) {
      throw new Error(
        `Private payment transaction references an invalid ${params.label} lookup address.`,
      );
    }

    return address;
  });
}

export async function resolveMessageAccountKeys(
  parsed: ParsedTransactionMessage,
  network: OffpayNetwork,
): Promise<string[]> {
  if (parsed.addressTableLookups.length === 0) {
    return parsed.accountKeys;
  }

  const response = await getRpcAccounts({
    addresses: parsed.addressTableLookups.map((lookup) => lookup.accountKey),
    network,
  });
  const writableLoadedAddresses: string[] = [];
  const readonlyLoadedAddresses: string[] = [];

  parsed.addressTableLookups.forEach((lookup, index) => {
    const tableAddresses = getAddressLookupTableAddresses(response.accounts[index]);
    writableLoadedAddresses.push(
      ...resolveLookupIndexes({
        addresses: tableAddresses,
        indexes: lookup.writableIndexes,
        label: 'writable',
      }),
    );
    readonlyLoadedAddresses.push(
      ...resolveLookupIndexes({
        addresses: tableAddresses,
        indexes: lookup.readonlyIndexes,
        label: 'readonly',
      }),
    );
  });

  return [...parsed.accountKeys, ...writableLoadedAddresses, ...readonlyLoadedAddresses];
}

function getTokenAccountMint(record: RpcAccountRecord | null | undefined): string | null {
  const dataBase64 = record?.data ?? record?.dataBase64 ?? null;
  if (dataBase64 == null || record?.owner == null || !TOKEN_PROGRAM_IDS.has(record.owner)) {
    return null;
  }

  const data = Uint8Array.from(Buffer.from(dataBase64, 'base64'));
  if (data.length < 32) return null;

  return bs58.encode(data.subarray(0, 32));
}

export async function verifyRequestedTokenMint(params: {
  parsed: ParsedTransactionMessage;
  accountKeys: string[];
  mint: string;
  amount: bigint;
  network: OffpayNetwork;
  allowInstructionDataMint?: boolean;
}): Promise<boolean> {
  if (params.accountKeys.includes(params.mint)) {
    return true;
  }

  if (
    params.allowInstructionDataMint === true &&
    instructionDataContainsAnyAccount({
      parsed: params.parsed,
      expectedAccounts: [params.mint],
    })
  ) {
    return true;
  }

  if (
    params.parsed.instructions.some((instruction) =>
      instructionHasRequestedMintAccount({
        instruction,
        parsed: {
          ...params.parsed,
          accountKeys: params.accountKeys,
        },
        mint: params.mint,
      }),
    )
  ) {
    return true;
  }

  const sourceAccounts = getTokenTransferSourceAccounts({
    parsed: params.parsed,
    accountKeys: params.accountKeys,
    amount: params.amount,
  });
  if (sourceAccounts.length === 0) {
    return false;
  }

  const response = await getRpcAccounts({
    addresses: sourceAccounts,
    network: params.network,
  });

  return response.accounts.some((account) => getTokenAccountMint(account) === params.mint);
}
