import { Buffer } from 'buffer';

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { getRpcAccounts } from '@/lib/api/offpay-api-client';
import {
  preparePrivatePaymentPlan,
  verifyPrivatePaymentUnsignedTransaction,
} from '@/lib/magicblock/private-payment';
import { deriveAssociatedTokenAddress } from '@/lib/crypto/solana-token-accounts';

jest.mock('@/lib/api/offpay-api-client', () => ({
  getRpcAccounts: jest.fn(),
  getRpcFeeForMessage: jest.fn(),
  getRpcMinimumBalanceForRentExemption: jest.fn(),
  initializePrivatePaymentMint: jest.fn(),
  preparePrivateSend: jest.fn(),
}));

const mockGetRpcAccounts = getRpcAccounts as jest.MockedFunction<typeof getRpcAccounts>;
const {
  getRpcFeeForMessage,
  getRpcMinimumBalanceForRentExemption,
  initializePrivatePaymentMint,
  preparePrivateSend,
} = jest.requireMock('@/lib/api/offpay-api-client') as {
  getRpcFeeForMessage: jest.Mock;
  getRpcMinimumBalanceForRentExemption: jest.Mock;
  initializePrivatePaymentMint: jest.Mock;
  preparePrivateSend: jest.Mock;
};

const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ADDRESS_LOOKUP_TABLE_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID = 'SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2';
const MAGICBLOCK_DELEGATION_PROGRAM_ID = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';

function pubkey(byte: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => byte));
}

function shortVec(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}

function u64LittleEndian(value: bigint): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number((value >> BigInt(index * 8)) & 0xffn));
  }
  return bytes;
}

function u32LittleEndian(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function buildTokenTransferTransaction(params: {
  walletAddress: string;
  recipient: string;
  sourceTokenAccount: string;
  amount: bigint;
}): string {
  const accountKeys = [
    params.walletAddress,
    params.recipient,
    params.sourceTokenAccount,
    TOKEN_PROGRAM_ID,
  ];
  const transferData = [3, ...u64LittleEndian(params.amount)];
  const instruction = [
    3,
    ...shortVec(3),
    2,
    1,
    0,
    ...shortVec(transferData.length),
    ...transferData,
  ];
  const message = [
    1,
    0,
    1,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from({ length: 32 }, () => 9),
    ...shortVec(1),
    ...instruction,
  ];
  const transaction = [...shortVec(1), ...Array.from({ length: 64 }, () => 0), ...message];

  return Buffer.from(transaction).toString('base64');
}

function buildTransferCheckedTransaction(params: {
  walletAddress: string;
  sourceTokenAccount: string;
  mint: string;
  transfers: readonly { destination: string; amount: bigint }[];
  decimals?: number;
}): string {
  const accountKeys = [
    params.walletAddress,
    params.sourceTokenAccount,
    params.mint,
    ...params.transfers.map((transfer) => transfer.destination),
    TOKEN_PROGRAM_ID,
  ];
  const tokenProgramIndex = accountKeys.length - 1;
  const instructions = params.transfers.flatMap((transfer, transferIndex) => {
    const destinationIndex = 3 + transferIndex;
    const transferData = [12, ...u64LittleEndian(transfer.amount), params.decimals ?? 6];
    return [
      tokenProgramIndex,
      ...shortVec(4),
      1,
      2,
      destinationIndex,
      0,
      ...shortVec(transferData.length),
      ...transferData,
    ];
  });
  const message = [
    1,
    0,
    1,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from({ length: 32 }, () => 9),
    ...shortVec(params.transfers.length),
    ...instructions,
  ];
  const transaction = [...shortVec(1), ...Array.from({ length: 64 }, () => 0), ...message];

  return Buffer.from(transaction).toString('base64');
}

function buildTransferCheckedWithSolAccountCostsTransaction(params: {
  walletAddress: string;
  sourceTokenAccount: string;
  mint: string;
  recipient: string;
  createdAccount: string;
  associatedTokenAccount: string;
  amount: bigint;
  systemCreateLamports: bigint;
  decimals?: number;
}): string {
  const accountKeys = [
    params.walletAddress,
    params.sourceTokenAccount,
    params.mint,
    params.recipient,
    params.createdAccount,
    params.associatedTokenAccount,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ];
  const systemProgramIndex = 6;
  const tokenProgramIndex = 7;
  const associatedTokenProgramIndex = 8;
  const createAccountData = [
    ...u32LittleEndian(0),
    ...u64LittleEndian(params.systemCreateLamports),
    ...u64LittleEndian(165n),
    ...Array.from(bs58.decode(TOKEN_PROGRAM_ID)),
  ];
  const createAccountInstruction = [
    systemProgramIndex,
    ...shortVec(2),
    0,
    4,
    ...shortVec(createAccountData.length),
    ...createAccountData,
  ];
  const createAssociatedTokenInstruction = [
    associatedTokenProgramIndex,
    ...shortVec(6),
    0,
    5,
    3,
    2,
    6,
    7,
    ...shortVec(1),
    1,
  ];
  const transferData = [12, ...u64LittleEndian(params.amount), params.decimals ?? 6];
  const transferInstruction = [
    tokenProgramIndex,
    ...shortVec(4),
    1,
    2,
    3,
    0,
    ...shortVec(transferData.length),
    ...transferData,
  ];
  const message = [
    1,
    0,
    3,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from({ length: 32 }, () => 9),
    ...shortVec(3),
    ...createAccountInstruction,
    ...createAssociatedTokenInstruction,
    ...transferInstruction,
  ];
  const transaction = [...shortVec(1), ...Array.from({ length: 64 }, () => 0), ...message];

  return Buffer.from(transaction).toString('base64');
}

function buildPrivateStyleTransferTransaction(params: {
  walletAddress: string;
  recipientHint: string;
  transferDestination: string;
  sourceTokenAccount: string;
  amount: bigint;
}): string {
  const accountKeys = [
    params.walletAddress,
    params.transferDestination,
    params.sourceTokenAccount,
    TOKEN_PROGRAM_ID,
    params.recipientHint,
  ];
  const transferData = [3, ...u64LittleEndian(params.amount)];
  const transferInstruction = [
    3,
    ...shortVec(3),
    2,
    1,
    0,
    ...shortVec(transferData.length),
    ...transferData,
  ];
  const recipientHintData = Array.from(bs58.decode(params.recipientHint));
  const recipientHintInstruction = [
    0,
    ...shortVec(1),
    4,
    ...shortVec(recipientHintData.length),
    ...recipientHintData,
  ];
  const message = [
    1,
    0,
    1,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from({ length: 32 }, () => 9),
    ...shortVec(2),
    ...transferInstruction,
    ...recipientHintInstruction,
  ];
  const transaction = [...shortVec(1), ...Array.from({ length: 64 }, () => 0), ...message];

  return Buffer.from(transaction).toString('base64');
}

function buildHiddenRecipientPrivateTransferTransaction(params: {
  walletAddress: string;
  transferDestination: string;
  sourceTokenAccount: string;
  amount: bigint;
}): string {
  const accountKeys = [
    params.walletAddress,
    params.transferDestination,
    params.sourceTokenAccount,
    TOKEN_PROGRAM_ID,
  ];
  const transferData = [3, ...u64LittleEndian(params.amount)];
  const transferInstruction = [
    3,
    ...shortVec(3),
    2,
    1,
    0,
    ...shortVec(transferData.length),
    ...transferData,
  ];
  const message = [
    1,
    0,
    1,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from({ length: 32 }, () => 9),
    ...shortVec(1),
    ...transferInstruction,
  ];
  const transaction = [...shortVec(1), ...Array.from({ length: 64 }, () => 0), ...message];

  return Buffer.from(transaction).toString('base64');
}

function buildCanonicalMagicBlockPrivateTransferTransaction(params: {
  walletAddress: string;
  mint: string;
  amount: bigint;
  validator: string;
  tamper?: 'shuttleDelegationBuffer' | 'transferQueue';
}): string {
  const walletTokenAccount = deriveAssociatedTokenAddress({
    owner: params.walletAddress,
    mint: params.mint,
  });
  const magicProgram = new PublicKey(MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID);
  const delegationProgram = new PublicKey(MAGICBLOCK_DELEGATION_PROGRAM_ID);
  const pda = (seeds: readonly Uint8Array[], program = magicProgram): string =>
    PublicKey.findProgramAddressSync(
      seeds.map((seed) => Buffer.from(seed)),
      program,
    )[0].toBase58();
  const walletSeed = new PublicKey(params.walletAddress).toBytes();
  const mintSeed = new PublicKey(params.mint).toBytes();
  const validatorSeed = new PublicKey(params.validator).toBytes();
  const shuttleId = 7;
  const shuttleIdSeed = Buffer.from(u32LittleEndian(shuttleId));
  const encryptionAccount = pda([walletSeed, mintSeed]);
  const encryptionBuffer = pda([Buffer.from('buffer'), new PublicKey(encryptionAccount).toBytes()]);
  const encryptionRecord = pda(
    [Buffer.from('delegation'), new PublicKey(encryptionAccount).toBytes()],
    delegationProgram,
  );
  const encryptionMetadata = pda(
    [Buffer.from('delegation-metadata'), new PublicKey(encryptionAccount).toBytes()],
    delegationProgram,
  );
  const rentPda = pda([Buffer.from('rent')]);
  const shuttleMetadata = pda([walletSeed, mintSeed, shuttleIdSeed]);
  const shuttleAccount = pda([new PublicKey(shuttleMetadata).toBytes(), mintSeed]);
  const shuttleWalletTokenAccount = deriveAssociatedTokenAddress({
    owner: shuttleMetadata,
    mint: params.mint,
  });
  const shuttleBuffer = pda([Buffer.from('buffer'), new PublicKey(shuttleAccount).toBytes()]);
  const shuttleRecord = pda(
    [Buffer.from('delegation'), new PublicKey(shuttleAccount).toBytes()],
    delegationProgram,
  );
  const shuttleMetadataRecord = pda(
    [Buffer.from('delegation-metadata'), new PublicKey(shuttleAccount).toBytes()],
    delegationProgram,
  );
  const globalVault = pda([mintSeed]);
  const globalVaultTokenAccount = deriveAssociatedTokenAddress({
    owner: globalVault,
    mint: params.mint,
  });
  const transferQueue = pda([Buffer.from('queue'), mintSeed, validatorSeed]);
  const accountKeys = [
    params.walletAddress,
    walletTokenAccount,
    params.mint,
    SYSTEM_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
    MAGICBLOCK_DELEGATION_PROGRAM_ID,
    encryptionAccount,
    encryptionBuffer,
    encryptionRecord,
    encryptionMetadata,
    rentPda,
    shuttleMetadata,
    shuttleAccount,
    shuttleWalletTokenAccount,
    params.tamper === 'shuttleDelegationBuffer' ? pubkey(214) : shuttleBuffer,
    shuttleRecord,
    shuttleMetadataRecord,
    globalVault,
    globalVaultTokenAccount,
    params.tamper === 'transferQueue' ? pubkey(215) : transferQueue,
  ];
  const accountIndex = (address: string): number => {
    const index = accountKeys.indexOf(address);
    if (index < 0) throw new Error(`Missing test account ${address}`);
    return index;
  };
  const instruction = (program: string, accounts: number[], data: number[]): number[] => [
    accountIndex(program),
    ...shortVec(accounts.length),
    ...accounts,
    ...shortVec(data.length),
    ...data,
  ];
  const validatorBytes = Array.from(bs58.decode(params.validator));
  const transferData = [
    0x19,
    ...u32LittleEndian(shuttleId),
    ...u64LittleEndian(params.amount),
    1,
    ...Array.from({ length: 80 }, () => 0),
    1,
    ...validatorBytes,
    68,
    ...Array.from({ length: 68 }, () => 0),
  ];
  const instructions = [
    instruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      [0, 1, 0, 2, 3, 4],
      [1],
    ),
    instruction(MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID, [8, 0, 0, 2, 3], [0]),
    instruction(
      MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
      [0, 8, 6, 9, 10, 11, 7, 3],
      [4, ...validatorBytes],
    ),
    instruction(
      MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
      [0, 12, 13, 14, 15, 0, 6, 16, 17, 18, 7, 5, 3, 2, 4, 19, 1, 20, 21],
      transferData,
    ),
  ];
  const message = [
    0x80,
    1,
    0,
    0,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from(bs58.decode(pubkey(90))),
    ...shortVec(instructions.length),
    ...instructions.flat(),
    ...shortVec(0),
  ];
  return Buffer.from([
    ...shortVec(1),
    ...Array.from({ length: 64 }, () => 0),
    ...message,
  ]).toString('base64');
}

function buildVersionedTokenTransferWithLookup(params: {
  walletAddress: string;
  recipient: string;
  lookupTable: string;
  sourceTokenAccountLookupIndex: number;
  amount: bigint;
}): string {
  const accountKeys = [params.walletAddress, params.recipient, TOKEN_PROGRAM_ID];
  const transferData = [3, ...u64LittleEndian(params.amount)];
  const instruction = [
    2,
    ...shortVec(3),
    3,
    1,
    0,
    ...shortVec(transferData.length),
    ...transferData,
  ];
  const message = [
    0x80,
    1,
    0,
    1,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => Array.from(bs58.decode(key))),
    ...Array.from({ length: 32 }, () => 8),
    ...shortVec(1),
    ...instruction,
    ...shortVec(1),
    ...Array.from(bs58.decode(params.lookupTable)),
    ...shortVec(1),
    params.sourceTokenAccountLookupIndex,
    ...shortVec(0),
  ];
  const transaction = [...shortVec(1), ...Array.from({ length: 64 }, () => 0), ...message];

  return Buffer.from(transaction).toString('base64');
}

function tokenAccountData(mint: string): string {
  return Buffer.from([
    ...Array.from(bs58.decode(mint)),
    ...Array.from({ length: 133 }, () => 0),
  ]).toString('base64');
}

function addressLookupTableData(addresses: string[]): string {
  return Buffer.from([
    ...Array.from({ length: 56 }, () => 0),
    ...addresses.flatMap((address) => Array.from(bs58.decode(address))),
  ]).toString('base64');
}

function privateRouteTransaction(params: {
  unsignedTransaction: string;
  walletAddress: string;
  validator: string;
  amount: bigint;
}) {
  return {
    kind: 'transfer',
    version: 'v0',
    transactionBase64: params.unsignedTransaction,
    sendTo: 'base',
    recentBlockhash: pubkey(90),
    lastValidBlockHeight: 123_456,
    instructionCount: 4,
    requiredSigners: [params.walletAddress],
    validator: params.validator,
    fees: {
      lamports: '2039280',
      tokens: (params.amount / 1_000n).toString(),
    },
  };
}

describe('private payment transaction verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRpcAccounts.mockReset();
    getRpcFeeForMessage.mockReset();
    getRpcMinimumBalanceForRentExemption.mockReset();
    initializePrivatePaymentMint.mockReset();
    preparePrivateSend.mockReset();
  });

  it('verifies a stablecoin transfer when the mint is proven by the source token account', async () => {
    const walletAddress = pubkey(1);
    const recipient = pubkey(2);
    const sourceTokenAccount = pubkey(3);
    const amount = 30_015n;

    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [
        {
          pubkey: sourceTokenAccount,
          data: tokenAccountData(MAINNET_USDC_MINT),
          owner: TOKEN_PROGRAM_ID,
          lamports: '1',
          executable: false,
          rentEpoch: '0',
        },
      ],
    });

    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction: buildTokenTransferTransaction({
        walletAddress,
        recipient,
        sourceTokenAccount,
        amount,
      }),
      walletAddress,
      recipient,
      mint: MAINNET_USDC_MINT,
      amount: amount.toString(),
      network: 'mainnet',
    });

    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
    expect(mockGetRpcAccounts).toHaveBeenCalledWith({
      addresses: [sourceTokenAccount],
      network: 'mainnet',
    });
  });

  it('verifies a stablecoin transfer whose recipient is represented by the recipient ATA', async () => {
    const walletAddress = pubkey(31);
    const recipient = pubkey(32);
    const sourceTokenAccount = pubkey(33);
    const recipientTokenAccount = deriveAssociatedTokenAddress({
      owner: recipient,
      mint: MAINNET_USDC_MINT,
    });
    const amount = 12_345n;

    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [
        {
          pubkey: sourceTokenAccount,
          data: tokenAccountData(MAINNET_USDC_MINT),
          owner: TOKEN_PROGRAM_ID,
          lamports: '1',
          executable: false,
          rentEpoch: '0',
        },
      ],
    });

    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction: buildTokenTransferTransaction({
        walletAddress,
        recipient: recipientTokenAccount,
        sourceTokenAccount,
        amount,
      }),
      walletAddress,
      recipient,
      mint: MAINNET_USDC_MINT,
      amount: amount.toString(),
      network: 'mainnet',
    });

    expect(verification.verifiedRecipient).toBe(true);
    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
  });

  it('rejects a decoy recipient that is merely encoded in an unrelated instruction', async () => {
    const walletAddress = pubkey(41);
    const recipient = pubkey(42);
    const transferDestination = pubkey(43);
    const sourceTokenAccount = pubkey(44);
    const amount = 55_001n;

    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [
        {
          pubkey: sourceTokenAccount,
          data: tokenAccountData(MAINNET_USDC_MINT),
          owner: TOKEN_PROGRAM_ID,
          lamports: '1',
          executable: false,
          rentEpoch: '0',
        },
      ],
    });

    await expect(
      verifyPrivatePaymentUnsignedTransaction({
        unsignedTransaction: buildPrivateStyleTransferTransaction({
          walletAddress,
          recipientHint: recipient,
          transferDestination,
          sourceTokenAccount,
          amount,
        }),
        walletAddress,
        recipient,
        mint: MAINNET_USDC_MINT,
        amount: amount.toString(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('intended recipient');
    expect(mockGetRpcAccounts).not.toHaveBeenCalled();
  });

  it('rejects a hidden-recipient private transfer unless the private route allows it', async () => {
    const walletAddress = pubkey(51);
    const recipient = pubkey(52);
    const transferDestination = pubkey(53);
    const sourceTokenAccount = pubkey(54);
    const amount = 22_010n;

    await expect(
      verifyPrivatePaymentUnsignedTransaction({
        unsignedTransaction: buildHiddenRecipientPrivateTransferTransaction({
          walletAddress,
          transferDestination,
          sourceTokenAccount,
          amount,
        }),
        walletAddress,
        recipient,
        mint: MAINNET_USDC_MINT,
        amount: amount.toString(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('intended recipient');

    expect(mockGetRpcAccounts).not.toHaveBeenCalled();
  });

  it('rejects a hidden-recipient transfer without provider metadata', async () => {
    const walletAddress = pubkey(55);
    const recipient = pubkey(56);
    const transferDestination = pubkey(57);
    const sourceTokenAccount = pubkey(58);
    const amount = 22_011n;

    await expect(
      verifyPrivatePaymentUnsignedTransaction({
        unsignedTransaction: buildHiddenRecipientPrivateTransferTransaction({
          walletAddress,
          transferDestination,
          sourceTokenAccount,
          amount,
        }),
        walletAddress,
        recipient,
        mint: MAINNET_USDC_MINT,
        amount: amount.toString(),
        network: 'mainnet',
        allowHiddenPrivateRecipient: true,
      }),
    ).rejects.toThrow('metadata is required');
  });

  it('verifies a MagicBlock private transfer whose recipient is hidden behind the route', async () => {
    const walletAddress = pubkey(61);
    const recipient = pubkey(62);
    const amount = 47_000n;
    const validator = pubkey(198);
    const unsignedTransaction = buildCanonicalMagicBlockPrivateTransferTransaction({
      walletAddress,
      mint: MAINNET_USDC_MINT,
      amount,
      validator,
    });

    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction,
      walletAddress,
      recipient,
      mint: MAINNET_USDC_MINT,
      amount: amount.toString(),
      network: 'mainnet',
      allowHiddenPrivateRecipient: true,
      privateRouteTransaction: privateRouteTransaction({
        unsignedTransaction,
        walletAddress,
        validator,
        amount,
      }),
    });

    expect(verification.verifiedRecipient).toBe(false);
    expect(verification.recipientVerification).toBe('provider-request-bound');
    expect(verification.providerRequestBound).toBe(true);
    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
  });

  it.each(['shuttleDelegationBuffer', 'transferQueue'] as const)(
    'rejects a MagicBlock private transfer with a substituted %s PDA',
    async (tamper) => {
      const walletAddress = pubkey(63);
      const recipient = pubkey(64);
      const amount = 48_000n;
      const validator = pubkey(198);
      const unsignedTransaction = buildCanonicalMagicBlockPrivateTransferTransaction({
        walletAddress,
        mint: MAINNET_USDC_MINT,
        amount,
        validator,
        tamper,
      });

      await expect(
        verifyPrivatePaymentUnsignedTransaction({
          unsignedTransaction,
          walletAddress,
          recipient,
          mint: MAINNET_USDC_MINT,
          amount: amount.toString(),
          network: 'mainnet',
          allowHiddenPrivateRecipient: true,
          privateRouteTransaction: privateRouteTransaction({
            unsignedTransaction,
            walletAddress,
            validator,
            amount,
          }),
        }),
      ).rejects.toThrow('does not match the confirmed mint and amount');
    },
  );

  it('verifies a mainnet-style transfer when the source token account is loaded from an address lookup table', async () => {
    const walletAddress = pubkey(7);
    const recipient = pubkey(8);
    const lookupTable = pubkey(9);
    const sourceTokenAccount = pubkey(10);
    const amount = 30_015n;

    mockGetRpcAccounts
      .mockResolvedValueOnce({
        network: 'mainnet',
        accounts: [
          {
            address: lookupTable,
            dataBase64: addressLookupTableData([sourceTokenAccount]),
            owner: ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
            lamports: '1',
            executable: false,
            rentEpoch: '0',
          },
        ],
      })
      .mockResolvedValueOnce({
        network: 'mainnet',
        accounts: [
          {
            address: sourceTokenAccount,
            dataBase64: tokenAccountData(MAINNET_USDC_MINT),
            owner: TOKEN_PROGRAM_ID,
            lamports: '1',
            executable: false,
            rentEpoch: '0',
          },
        ],
      });

    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction: buildVersionedTokenTransferWithLookup({
        walletAddress,
        recipient,
        lookupTable,
        sourceTokenAccountLookupIndex: 0,
        amount,
      }),
      walletAddress,
      recipient,
      mint: MAINNET_USDC_MINT,
      amount: amount.toString(),
      network: 'mainnet',
    });

    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
    expect(mockGetRpcAccounts).toHaveBeenNthCalledWith(1, {
      addresses: [lookupTable],
      network: 'mainnet',
    });
    expect(mockGetRpcAccounts).toHaveBeenNthCalledWith(2, {
      addresses: [sourceTokenAccount],
      network: 'mainnet',
    });
  });

  it('rejects a transfer whose token account belongs to a different mint', async () => {
    const walletAddress = pubkey(4);
    const recipient = pubkey(5);
    const sourceTokenAccount = pubkey(6);
    const amount = 1_000n;

    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [
        {
          pubkey: sourceTokenAccount,
          data: tokenAccountData('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
          owner: TOKEN_PROGRAM_ID,
          lamports: '1',
          executable: false,
          rentEpoch: '0',
        },
      ],
    });

    await expect(
      verifyPrivatePaymentUnsignedTransaction({
        unsignedTransaction: buildTokenTransferTransaction({
          walletAddress,
          recipient,
          sourceTokenAccount,
          amount,
        }),
        walletAddress,
        recipient,
        mint: MAINNET_USDC_MINT,
        amount: amount.toString(),
        network: 'mainnet',
      }),
    ).rejects.toThrow('requested token mint');
  });

  it('estimates MagicBlock SOL fees and account-creation rent from the prepared transaction', async () => {
    const walletAddress = pubkey(81);
    const recipient = pubkey(82);
    const amount = 1_000_000n;
    const associatedTokenRentLamports = 2_039_280;
    const validator = pubkey(198);
    const associatedTokenAccount = deriveAssociatedTokenAddress({
      owner: walletAddress,
      mint: MAINNET_USDC_MINT,
    });
    const unsignedTransaction = buildCanonicalMagicBlockPrivateTransferTransaction({
      walletAddress,
      mint: MAINNET_USDC_MINT,
      amount,
      validator,
    });

    initializePrivatePaymentMint.mockResolvedValueOnce({
      queueId: pubkey(196),
      validator: pubkey(198),
      status: 'initialized',
    });
    preparePrivateSend.mockResolvedValueOnce({
      intentId: 'private-intent-1',
      expiresAt: Date.now() + 60_000,
      unsignedTransaction,
      transaction: privateRouteTransaction({
        unsignedTransaction,
        walletAddress,
        validator,
        amount,
      }),
    });
    getRpcFeeForMessage.mockResolvedValueOnce({ lamports: 8_000 });
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [null],
    });
    getRpcMinimumBalanceForRentExemption.mockResolvedValueOnce({
      lamports: associatedTokenRentLamports,
    });

    const plan = await preparePrivatePaymentPlan({
      walletAddress,
      recipient,
      mint: MAINNET_USDC_MINT,
      amount: amount.toString(),
      network: 'mainnet',
    });

    expect(plan.feeLamports).toBe(8_000 + associatedTokenRentLamports);
    expect(plan.tokenFeeRaw).toBe('1000');
    expect(plan.solFeePayer).toBe(walletAddress);
    expect(plan.includesMintInitialization).toBe(false);
    expect(plan).not.toHaveProperty('relayFeeAtomicAmount');
    expect(plan).not.toHaveProperty('relayFeeMint');
    expect(getRpcFeeForMessage).toHaveBeenCalledWith({
      network: 'mainnet',
      messageBase64: expect.any(String),
    });
    expect(mockGetRpcAccounts).toHaveBeenCalledWith({
      addresses: [associatedTokenAccount],
      network: 'mainnet',
    });
    expect(getRpcMinimumBalanceForRentExemption).toHaveBeenCalledWith({
      space: 165,
      network: 'mainnet',
    });
  });
});
