import { Buffer } from 'buffer';
import { describe, expect, it } from '@jest/globals';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CLOSE_DCA_DISCRIMINATOR,
  JUPITER_EVENT_AUTHORITY,
  JUPITER_RECURRING_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID,
  JUPITER_V6_EVENT_AUTHORITY,
  OPEN_DCA_DISCRIMINATOR,
  ROUTE_V2_DISCRIMINATOR,
  SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  verifyJupiterTransaction,
  type JupiterVerifierAccountLoader,
} from '../jupiter-transaction-verifier';
import type { RpcAccountInfo } from '../helius';
import type { Bindings } from '../types';

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(71));
const receiver = Keypair.fromSeed(new Uint8Array(32).fill(72)).publicKey;
const order = Keypair.fromSeed(new Uint8Array(32).fill(73)).publicKey;
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const solMint = new PublicKey(WRAPPED_SOL_MINT);
const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
const token2022Program = new PublicKey(TOKEN_2022_PROGRAM_ID);
const associatedTokenProgram = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
const dcaProgram = new PublicKey(JUPITER_RECURRING_PROGRAM_ID);
const eventAuthority = new PublicKey(JUPITER_EVENT_AUTHORITY);
const bindings = {} as Bindings;
const swapOutputAmount = 78_126n;
const swapSlippageBps = 50;
const swapMinimumOutputAmount = 77_736n;
const OFFICIAL_RECURRING_CANCEL_TRANSACTION =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAgORL7cu4ZNuxh1wI9W7GVURyr3A06dH348HDpIQzcAJ4oZOZHXAukWalAX/odOiV55UZa1ePBg8d2tRKQyqCjV6C/H8IQcrfZR4QeOJFykenP3QJznc6vNpqe2D57HTD7Gd1R4MYi595YUO8ViNwpWb17+Q9DxkVcz5fWpSqjtDyiji2RfCl7yoUfzkV42QPexQNFjBK5/+pJhV8QuWShN6r9vLZM5XJNS670dgAgf7wC+wCLLIFWHgjgWx32LJMnJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAAabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABBt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKmMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WbB1qAZjecpv43A3/wwo1VSm5NY22ehRjP5uuuk/Ujb+tSfUXWQOPsFfYV1bDiOlSpa4PwuCC/cGNfJDSsZAzATG+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYVCj/auTzJLgPke1v9c3puAy81rBYgsabmuLUTEQsZyVAwcABQL9WQEABwAJA0ANAwAAAAAADA0AAg0IAQQDBQYJCgsMCBYHIWKotyLz';

function ata(owner: PublicKey, mint: PublicKey, program = tokenProgram): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), program.toBuffer(), mint.toBuffer()],
    associatedTokenProgram,
  )[0];
}

function wire(instructions: TransactionInstruction[], feePayer = wallet.publicKey): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: SYSTEM_PROGRAM_ID,
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

function rpcAccount(address: string, owner: string): RpcAccountInfo {
  return {
    address,
    pubkey: address,
    exists: true,
    executable: false,
    lamports: '1',
    owner,
    rentEpoch: 0,
    dataBase64: '',
    data: '',
    space: 82,
  };
}

function loader(extra: RpcAccountInfo[] = []): JupiterVerifierAccountLoader {
  const accounts = new Map(
    [
      rpcAccount(solMint.toBase58(), TOKEN_PROGRAM_ID),
      rpcAccount(usdcMint.toBase58(), TOKEN_PROGRAM_ID),
      ...extra,
    ].map((account) => [account.address, account]),
  );
  return async (addresses) =>
    addresses.map((address) => {
      const account = accounts.get(address);
      if (!account) throw new Error(`Missing fixture account: ${address}`);
      return account;
    });
}

function createAta(
  owner: PublicKey,
  mint: PublicKey,
  program = tokenProgram,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: associatedTokenProgram,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint, program), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function routeV2Data(params: {
  inputAmount: bigint;
  quotedOutputAmount: bigint;
  slippageBps: number;
  platformFeeBps?: number;
}): Buffer {
  const data = Buffer.alloc(39);
  Buffer.from(ROUTE_V2_DISCRIMINATOR, 'hex').copy(data, 0);
  data.writeBigUInt64LE(params.inputAmount, 8);
  data.writeBigUInt64LE(params.quotedOutputAmount, 16);
  data.writeUInt16LE(params.slippageBps, 24);
  data.writeUInt16LE(params.platformFeeBps ?? 0, 26);
  data.writeUInt16LE(0, 28);
  data.writeUInt32LE(1, 30);
  Buffer.from([0, 0x10, 0x27, 0, 1]).copy(data, 34);
  return data;
}

function syncNative(account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  });
}

function closeAccount(account: PublicKey, destination = wallet.publicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  });
}

function routeInstruction(
  amount: bigint,
  destination = ata(wallet.publicKey, usdcMint),
): TransactionInstruction {
  const data = routeV2Data({
    inputAmount: amount,
    quotedOutputAmount: swapOutputAmount,
    slippageBps: swapSlippageBps,
  });
  return new TransactionInstruction({
    programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: ata(wallet.publicKey, solMint), isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: solMint, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(JUPITER_V6_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(JUPITER_V6_EVENT_AUTHORITY), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(JUPITER_V6_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data,
  });
}

function sharedRouteInstruction(params: {
  amount: bigint;
  quotedOutputAmount: bigint;
  slippageBps: number;
  platformFeeBps?: number;
  destination: PublicKey;
}): TransactionInstruction {
  const authorityId = 8;
  const program = new PublicKey(JUPITER_V6_PROGRAM_ID);
  const programAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), Buffer.from([authorityId])],
    program,
  )[0];
  const programSource = Keypair.fromSeed(new Uint8Array(32).fill(76)).publicKey;
  const programDestination = Keypair.fromSeed(new Uint8Array(32).fill(77)).publicKey;
  const data = Buffer.alloc(50);
  Buffer.from(SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR, 'hex').copy(data, 0);
  data[8] = authorityId;
  data.writeBigUInt64LE(params.amount, 9);
  data.writeBigUInt64LE(params.quotedOutputAmount, 17);
  data.writeUInt16LE(params.slippageBps, 25);
  data.writeUInt16LE(params.platformFeeBps ?? 0, 27);
  data.writeUInt16LE(0, 29);
  data.writeUInt32LE(3, 31);
  Buffer.from([0, 0x05, 0x0d, 0, 1, 0, 0x05, 0x0d, 1, 2, 0, 0x06, 0x0d, 2, 3]).copy(data, 35);
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: programAuthority, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: ata(wallet.publicKey, solMint), isSigner: false, isWritable: true },
      { pubkey: programSource, isSigner: false, isWritable: true },
      { pubkey: programDestination, isSigner: false, isWritable: true },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: solMint, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(JUPITER_V6_EVENT_AUTHORITY), isSigner: false, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function swapWire(amount = 1_000_000n, extra: TransactionInstruction[] = []): string {
  const source = ata(wallet.publicKey, solMint);
  return wire([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    createAta(wallet.publicKey, solMint),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: source, lamports: amount }),
    syncNative(source),
    routeInstruction(amount),
    closeAccount(source),
    ...extra,
  ]);
}

function recurringOpenInstruction(
  total: bigint,
  perOrder: bigint,
  interval: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(43);
  Buffer.from(OPEN_DCA_DISCRIMINATOR, 'hex').copy(data, 0);
  data.writeBigUInt64LE(1_783_778_410n, 8);
  data.writeBigUInt64LE(total, 16);
  data.writeBigUInt64LE(perOrder, 24);
  data.writeBigUInt64LE(interval, 32);
  return new TransactionInstruction({
    programId: dcaProgram,
    keys: [
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: solMint, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: ata(wallet.publicKey, solMint), isSigner: false, isWritable: true },
      { pubkey: ata(order, solMint), isSigner: false, isWritable: true },
      { pubkey: ata(order, usdcMint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: associatedTokenProgram, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: dcaProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function recurringCloseInstruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: dcaProgram,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: solMint, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: ata(order, solMint), isSigner: false, isWritable: true },
      { pubkey: ata(order, usdcMint), isSigner: false, isWritable: true },
      { pubkey: ata(wallet.publicKey, solMint), isSigner: false, isWritable: true },
      { pubkey: ata(wallet.publicKey, usdcMint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: associatedTokenProgram, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: dcaProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(CLOSE_DCA_DISCRIMINATOR, 'hex'),
  });
}

describe('verifyJupiterTransaction', () => {
  it('accepts an exact mainnet swap and reports the bounded priority fee', async () => {
    await expect(
      verifyJupiterTransaction({
        bindings,
        network: 'mainnet',
        transactionBase64: swapWire(),
        intent: {
          kind: 'swap',
          walletAddress: wallet.publicKey.toBase58(),
          inputMint: solMint.toBase58(),
          outputMint: usdcMint.toBase58(),
          inputAmount: '1000000',
          outputAmount: swapOutputAmount.toString(),
          minimumOutputAmount: swapMinimumOutputAmount.toString(),
          slippageBps: swapSlippageBps,
          platformFeeBps: 0,
          providerRequestId: 'quote-1',
        },
        accountLoader: loader(),
      }),
    ).resolves.toMatchObject({
      kind: 'swap',
      feePayerAddress: wallet.publicKey.toBase58(),
      providerRequestId: 'quote-1',
      maxPriorityFeeLamports: '30000',
      maxNewTokenAccounts: 1,
    });
  });

  it('rejects amount, destination, fee-payer, and unrelated value-movement substitutions', async () => {
    const base = {
      bindings,
      network: 'mainnet' as const,
      intent: {
        kind: 'swap' as const,
        walletAddress: wallet.publicKey.toBase58(),
        inputMint: solMint.toBase58(),
        outputMint: usdcMint.toBase58(),
        inputAmount: '1000000',
        outputAmount: swapOutputAmount.toString(),
        minimumOutputAmount: swapMinimumOutputAmount.toString(),
        slippageBps: swapSlippageBps,
        platformFeeBps: 0,
      },
      accountLoader: loader(),
    };
    await expect(
      verifyJupiterTransaction({ ...base, transactionBase64: swapWire(2_000_000n) }),
    ).rejects.toThrow('exact-input amount does not match');
    const wrongRoute = routeInstruction(1_000_000n, ata(receiver, usdcMint));
    const source = ata(wallet.publicKey, solMint);
    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: wire([
          createAta(wallet.publicKey, solMint),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: source,
            lamports: 1_000_000,
          }),
          syncNative(source),
          wrongRoute,
          closeAccount(source),
        ]),
      }),
    ).rejects.toThrow('instruction account 2 does not match');
    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: wire([routeInstruction(1_000_000n)], receiver),
      }),
    ).rejects.toThrow('fee payer');
    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: swapWire(1_000_000n, [
          SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: receiver, lamports: 1 }),
        ]),
      }),
    ).rejects.toThrow('unrelated system value movement');
    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: swapWire(),
        intent: { ...base.intent, minimumOutputAmount: '1' },
      }),
    ).rejects.toThrow('minimum output threshold does not match');
  });

  it('rejects extra signers, provider pre-signing, unknown variants, and excessive priority spend', async () => {
    const base = {
      bindings,
      network: 'mainnet' as const,
      intent: {
        kind: 'swap' as const,
        walletAddress: wallet.publicKey.toBase58(),
        inputMint: solMint.toBase58(),
        outputMint: usdcMint.toBase58(),
        inputAmount: '1000000',
        outputAmount: swapOutputAmount.toString(),
        minimumOutputAmount: swapMinimumOutputAmount.toString(),
        slippageBps: swapSlippageBps,
        platformFeeBps: 0,
      },
      accountLoader: loader(),
    };
    const extraSignerRoute = routeInstruction(1_000_000n);
    extraSignerRoute.keys.push({ pubkey: receiver, isSigner: true, isWritable: false });
    await expect(
      verifyJupiterTransaction({ ...base, transactionBase64: wire([extraSignerRoute]) }),
    ).rejects.toThrow('sole signer and fee payer');

    const preSigned = VersionedTransaction.deserialize(Buffer.from(swapWire(), 'base64'));
    preSigned.sign([wallet]);
    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: Buffer.from(preSigned.serialize()).toString('base64'),
      }),
    ).rejects.toThrow('unexpectedly contains a wallet signature');

    const unknownRoute = routeInstruction(1_000_000n);
    unknownRoute.data[0] ^= 0xff;
    const source = ata(wallet.publicKey, solMint);
    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: wire([
          createAta(wallet.publicKey, solMint),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: source,
            lamports: 1_000_000,
          }),
          syncNative(source),
          unknownRoute,
          closeAccount(source),
        ]),
      }),
    ).rejects.toThrow('instruction variant is not verified');

    await expect(
      verifyJupiterTransaction({
        ...base,
        transactionBase64: wire([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000_000 }),
          createAta(wallet.publicKey, solMint),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: source,
            lamports: 1_000_000,
          }),
          syncNative(source),
          routeInstruction(1_000_000n),
          closeAccount(source),
        ]),
      }),
    ).rejects.toThrow('priority fee exceeds');
  });

  it('accepts the current shared-accounts receiver layout with a non-divisible ceil threshold', async () => {
    const inputAmount = 1_000_000n;
    const quotedOutputAmount = 1_000_805n;
    const minimumOutputAmount = 993_099n;
    const source = ata(wallet.publicKey, solMint);
    const destination = ata(receiver, usdcMint);
    await expect(
      verifyJupiterTransaction({
        bindings,
        network: 'mainnet',
        transactionBase64: wire([
          createAta(wallet.publicKey, solMint),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: source,
            lamports: inputAmount,
          }),
          syncNative(source),
          createAta(receiver, usdcMint),
          sharedRouteInstruction({
            amount: inputAmount,
            quotedOutputAmount,
            slippageBps: 77,
            destination,
          }),
          closeAccount(source),
        ]),
        intent: {
          kind: 'swap',
          walletAddress: wallet.publicKey.toBase58(),
          receiverAddress: receiver.toBase58(),
          inputMint: solMint.toBase58(),
          outputMint: usdcMint.toBase58(),
          inputAmount: inputAmount.toString(),
          outputAmount: quotedOutputAmount.toString(),
          minimumOutputAmount: minimumOutputAmount.toString(),
          slippageBps: 77,
          platformFeeBps: 0,
        },
        accountLoader: loader(),
      }),
    ).resolves.toMatchObject({ kind: 'swap', maxNewTokenAccounts: 2 });

    const feeRoundedVisibleOutput = quotedOutputAmount - 1n;
    const feeRoundedMinimum = (feeRoundedVisibleOutput * BigInt(10_000 - 77) + 9_999n) / 10_000n;
    await expect(
      verifyJupiterTransaction({
        bindings,
        network: 'mainnet',
        transactionBase64: wire([
          createAta(wallet.publicKey, solMint),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: source,
            lamports: inputAmount,
          }),
          syncNative(source),
          createAta(receiver, usdcMint),
          sharedRouteInstruction({
            amount: inputAmount,
            quotedOutputAmount,
            slippageBps: 77,
            platformFeeBps: 2,
            destination,
          }),
          closeAccount(source),
        ]),
        intent: {
          kind: 'swap',
          walletAddress: wallet.publicKey.toBase58(),
          receiverAddress: receiver.toBase58(),
          inputMint: solMint.toBase58(),
          outputMint: usdcMint.toBase58(),
          inputAmount: inputAmount.toString(),
          outputAmount: feeRoundedVisibleOutput.toString(),
          minimumOutputAmount: feeRoundedMinimum.toString(),
          slippageBps: 77,
          platformFeeBps: 2,
        },
        accountLoader: loader(),
      }),
    ).resolves.toMatchObject({ kind: 'swap' });
  });

  it('accepts a Token-2022 RWA destination only when the mint owner and canonical ATA match', async () => {
    const xStockMint = Keypair.fromSeed(new Uint8Array(32).fill(78)).publicKey;
    const inputAmount = 10_000_000n;
    const outputAmount = 250_001n;
    const data = routeV2Data({
      inputAmount,
      quotedOutputAmount: outputAmount,
      slippageBps: 50,
    });
    const route = new TransactionInstruction({
      programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: ata(wallet.publicKey, usdcMint), isSigner: false, isWritable: true },
        {
          pubkey: ata(wallet.publicKey, xStockMint, token2022Program),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: xStockMint, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: token2022Program, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(JUPITER_V6_PROGRAM_ID), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(JUPITER_V6_EVENT_AUTHORITY), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(JUPITER_V6_PROGRAM_ID), isSigner: false, isWritable: false },
      ],
      data,
    });
    const request = {
      bindings,
      network: 'mainnet' as const,
      transactionBase64: wire([createAta(wallet.publicKey, xStockMint, token2022Program), route]),
      intent: {
        kind: 'swap' as const,
        walletAddress: wallet.publicKey.toBase58(),
        inputMint: usdcMint.toBase58(),
        outputMint: xStockMint.toBase58(),
        inputAmount: inputAmount.toString(),
        outputAmount: outputAmount.toString(),
        minimumOutputAmount: '248750',
        slippageBps: 50,
        platformFeeBps: 0,
      },
      accountLoader: loader([rpcAccount(xStockMint.toBase58(), TOKEN_2022_PROGRAM_ID)]),
    };
    await expect(verifyJupiterTransaction(request)).resolves.toMatchObject({ kind: 'swap' });
    await expect(
      verifyJupiterTransaction({
        ...request,
        accountLoader: loader([rpcAccount(xStockMint.toBase58(), TOKEN_PROGRAM_ID)]),
      }),
    ).rejects.toThrow('declared token program');

    const sellInputAmount = 100_000_000n;
    const sellOutputAmount = 10_000_000n;
    const sellRoute = new TransactionInstruction({
      programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        {
          pubkey: ata(wallet.publicKey, xStockMint, token2022Program),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: ata(wallet.publicKey, usdcMint), isSigner: false, isWritable: true },
        { pubkey: xStockMint, isSigner: false, isWritable: false },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: token2022Program, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(JUPITER_V6_PROGRAM_ID), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(JUPITER_V6_EVENT_AUTHORITY), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(JUPITER_V6_PROGRAM_ID), isSigner: false, isWritable: false },
      ],
      data: routeV2Data({
        inputAmount: sellInputAmount,
        quotedOutputAmount: sellOutputAmount,
        slippageBps: 100,
      }),
    });
    await expect(
      verifyJupiterTransaction({
        bindings,
        network: 'mainnet',
        transactionBase64: wire([sellRoute]),
        intent: {
          kind: 'swap',
          walletAddress: wallet.publicKey.toBase58(),
          inputMint: xStockMint.toBase58(),
          outputMint: usdcMint.toBase58(),
          inputAmount: sellInputAmount.toString(),
          outputAmount: sellOutputAmount.toString(),
          minimumOutputAmount: '9900000',
          slippageBps: 100,
          platformFeeBps: 0,
        },
        accountLoader: loader([rpcAccount(xStockMint.toBase58(), TOKEN_2022_PROGRAM_ID)]),
      }),
    ).resolves.toMatchObject({ kind: 'swap' });
  });

  it('accepts only the exact recurring create economics and schedule', async () => {
    const total = 1_000_000n;
    const source = ata(wallet.publicKey, solMint);
    const transactionBase64 = wire([
      createAta(wallet.publicKey, solMint),
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: source, lamports: total }),
      syncNative(source),
      recurringOpenInstruction(total, 500_000n, 86_400n),
      closeAccount(source),
    ]);
    const request = {
      bindings,
      network: 'mainnet' as const,
      transactionBase64,
      intent: {
        kind: 'recurringCreate' as const,
        walletAddress: wallet.publicKey.toBase58(),
        inputMint: solMint.toBase58(),
        outputMint: usdcMint.toBase58(),
        inputAmount: total.toString(),
        numberOfOrders: 2,
        intervalSeconds: 86_400,
      },
      accountLoader: loader(),
    };
    await expect(verifyJupiterTransaction(request)).resolves.toMatchObject({
      kind: 'recurringCreate',
    });
    await expect(
      verifyJupiterTransaction({
        ...request,
        intent: { ...request.intent, intervalSeconds: 3_600 },
      }),
    ).rejects.toThrow('interval does not match');
  });

  it('binds recurring cancellation to the exact Jupiter-owned order and refund mints', async () => {
    const orderAccount = rpcAccount(order.toBase58(), JUPITER_RECURRING_PROGRAM_ID);
    const request = {
      bindings,
      network: 'mainnet' as const,
      transactionBase64: wire([recurringCloseInstruction()]),
      intent: {
        kind: 'recurringCancel' as const,
        walletAddress: wallet.publicKey.toBase58(),
        orderAddress: order.toBase58(),
        inputMint: solMint.toBase58(),
        outputMint: usdcMint.toBase58(),
      },
      accountLoader: loader([orderAccount]),
    };
    await expect(verifyJupiterTransaction(request)).resolves.toMatchObject({
      kind: 'recurringCancel',
    });
    await expect(
      verifyJupiterTransaction({
        ...request,
        intent: { ...request.intent, orderAddress: receiver.toBase58() },
        accountLoader: loader([rpcAccount(receiver.toBase58(), TOKEN_PROGRAM_ID)]),
      }),
    ).rejects.toThrow('instruction account 1 does not match');
  });

  it("verifies Jupiter's official documented mainnet recurring-cancel wire example", async () => {
    const documentedWallet = '5dMXLJ8GYQxcHe2fjpttVkEpRrxcajRXZqJHCiCbWS4H';
    const documentedOrder = '4DWzP4TdTsuwvYMaMWrRqzya4UTFKFoVjfUWNWh8zhzd';
    await expect(
      verifyJupiterTransaction({
        bindings,
        network: 'mainnet',
        transactionBase64: OFFICIAL_RECURRING_CANCEL_TRANSACTION,
        intent: {
          kind: 'recurringCancel',
          walletAddress: documentedWallet,
          orderAddress: documentedOrder,
          inputMint: usdcMint.toBase58(),
          outputMint: solMint.toBase58(),
          providerRequestId: '36779346-ae51-41e9-97ce-8613c8c50553',
        },
        accountLoader: loader([rpcAccount(documentedOrder, JUPITER_RECURRING_PROGRAM_ID)]),
      }),
    ).resolves.toMatchObject({
      kind: 'recurringCancel',
      feePayerAddress: documentedWallet,
      providerRequestId: '36779346-ae51-41e9-97ce-8613c8c50553',
    });
  });

  it('accepts an exact native-SOL Trigger vault deposit and rejects another receiver', async () => {
    const transactionBase64 = wire([
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: receiver,
        lamports: 1_000_000,
      }),
    ]);
    const request = {
      bindings,
      network: 'mainnet' as const,
      transactionBase64,
      intent: {
        kind: 'triggerDeposit' as const,
        walletAddress: wallet.publicKey.toBase58(),
        inputMint: solMint.toBase58(),
        outputMint: usdcMint.toBase58(),
        inputAmount: '1000000',
        receiverAddress: receiver.toBase58(),
        orderSubType: 'single' as const,
      },
      accountLoader: loader(),
    };
    await expect(verifyJupiterTransaction(request)).resolves.toMatchObject({
      kind: 'triggerDeposit',
    });
    await expect(
      verifyJupiterTransaction({
        ...request,
        intent: { ...request.intent, receiverAddress: order.toBase58() },
      }),
    ).rejects.toThrow('instruction account 1 does not match');
  });

  it('accepts one exact SPL Trigger vault deposit and rejects a duplicate debit', async () => {
    const amount = 1_000_000n;
    const transferData = Buffer.alloc(10);
    transferData[0] = 12;
    transferData.writeBigUInt64LE(amount, 1);
    transferData[9] = 6;
    const transfer = new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: ata(wallet.publicKey, usdcMint), isSigner: false, isWritable: true },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: ata(receiver, usdcMint), isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: transferData,
    });
    const request = {
      bindings,
      network: 'mainnet' as const,
      transactionBase64: wire([createAta(receiver, usdcMint), transfer]),
      intent: {
        kind: 'triggerDeposit' as const,
        walletAddress: wallet.publicKey.toBase58(),
        inputMint: usdcMint.toBase58(),
        outputMint: solMint.toBase58(),
        inputAmount: amount.toString(),
        receiverAddress: receiver.toBase58(),
        orderSubType: 'single' as const,
      },
      accountLoader: loader(),
    };
    await expect(verifyJupiterTransaction(request)).resolves.toMatchObject({
      kind: 'triggerDeposit',
    });
    await expect(
      verifyJupiterTransaction({
        ...request,
        transactionBase64: wire([createAta(receiver, usdcMint), transfer, transfer]),
      }),
    ).rejects.toThrow('multiple deposit transfers');
  });
});
