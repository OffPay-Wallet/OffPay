import { Buffer } from 'buffer';

import bs58 from 'bs58';

import { getRpcAccounts } from '@/lib/api/offpay-api-client';
import { verifyPrivatePaymentUnsignedTransaction } from '@/lib/magicblock/private-payment';
import { deriveAssociatedTokenAddress } from '@/lib/crypto/solana-token-accounts';

jest.mock('@/lib/api/offpay-api-client', () => ({
  getRpcAccounts: jest.fn(),
}));

const mockGetRpcAccounts = getRpcAccounts as jest.MockedFunction<typeof getRpcAccounts>;

const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ADDRESS_LOOKUP_TABLE_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';

function pubkey(byte: number): string {
  return bs58.encode(Uint8Array.from({ length: 32 }, () => byte));
}

function shortVec(value: number): number[] {
  return [value];
}

function u64LittleEndian(value: bigint): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number((value >> BigInt(index * 8)) & 0xffn));
  }
  return bytes;
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

function privateRouteTransaction(unsignedTransaction: string) {
  return {
    kind: 'magicblock-private-transfer',
    version: 'legacy',
    transactionBase64: unsignedTransaction,
    sendTo: pubkey(199),
    recentBlockhash: null,
    lastValidBlockHeight: null,
    instructionCount: 1,
    requiredSigners: [],
    validator: pubkey(198),
  };
}

describe('private payment transaction verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('verifies a private-style transfer when the recipient is encoded separately', async () => {
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

    const verification = await verifyPrivatePaymentUnsignedTransaction({
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
    });

    expect(verification.verifiedRecipient).toBe(true);
    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
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

  it('verifies a legacy MagicBlock private transfer response without route metadata', async () => {
    const walletAddress = pubkey(55);
    const recipient = pubkey(56);
    const transferDestination = pubkey(57);
    const sourceTokenAccount = pubkey(58);
    const amount = 22_011n;

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
    });

    expect(verification.verifiedRecipient).toBe(true);
    expect(verification.recipientVerification).toBe('private-route');
    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
  });

  it('verifies a MagicBlock private transfer whose recipient is hidden behind the route', async () => {
    const walletAddress = pubkey(61);
    const recipient = pubkey(62);
    const transferDestination = pubkey(63);
    const sourceTokenAccount = pubkey(64);
    const amount = 47_000n;

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

    const unsignedTransaction = buildHiddenRecipientPrivateTransferTransaction({
      walletAddress,
      transferDestination,
      sourceTokenAccount,
      amount,
    });

    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction,
      walletAddress,
      recipient,
      mint: MAINNET_USDC_MINT,
      amount: amount.toString(),
      network: 'mainnet',
      allowHiddenPrivateRecipient: true,
      privateRouteTransaction: privateRouteTransaction(unsignedTransaction),
    });

    expect(verification.verifiedRecipient).toBe(true);
    expect(verification.recipientVerification).toBe('private-route');
    expect(verification.verifiedMint).toBe(true);
    expect(verification.verifiedAmount).toBe(true);
  });

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
});
