import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

import { FLASH_V2_PROGRAM_ID } from '@/lib/flash-trade/constants';
import {
  sendAndConfirmFlashTradeTransaction,
  verifyFlashTradeTransaction,
  verifySignedFlashTradeTransaction,
  type FlashTradeTransactionIntent,
} from '@/lib/flash-trade/execution';
import type {
  FlashEncodedAmount,
  FlashExpectedMarketAccounts,
  FlashSide,
  FlashTradeEconomicIntent,
} from '@/lib/flash-trade/types';

const FLASH_PROGRAM = new PublicKey(FLASH_V2_PROGRAM_ID);
const INSTRUCTION_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const PERPETUALS = PublicKey.findProgramAddressSync([Buffer.from('perpetuals')], FLASH_PROGRAM)[0];
const REALLOC = PublicKey.findProgramAddressSync([Buffer.from('realloc_vault')], FLASH_PROGRAM)[0];
const EVENT = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')],
  FLASH_PROGRAM,
)[0];

const DISCRIMINATORS = {
  add: 'e12d954274a0e45d',
  cancel: 'c8ccc19b74f06d66',
  close: '77545c12ee6d1e5c',
  decrease: '561b02f0fe13c652',
  editTrigger: 'd22a7c153dff1801',
  increase: 'fb389c2168ad84f7',
  open: '3884e4954122a76f',
  placeLimit: '514bd522743419bf',
  placeTrigger: '1296e15d2ab60338',
  remove: '824690d560fe01e1',
} as const;

interface MarketFixture extends FlashExpectedMarketAccounts {
  selectedCustodyPubkey: string;
}

function key(): PublicKey {
  return Keypair.generate().publicKey;
}

function marketFixture(selectedCustody = key(), side: FlashSide = 'long'): MarketFixture {
  return {
    side,
    marketPubkey: key().toBase58(),
    poolPubkey: key().toBase58(),
    targetCustodyPubkey: key().toBase58(),
    collateralCustodyPubkey: key().toBase58(),
    selectedCustodyPubkey: selectedCustody.toBase58(),
  };
}

function amount(rawAmount: bigint, decimals: number, symbol: string): FlashEncodedAmount {
  return { rawAmount: rawAmount.toString(), decimals, symbol };
}

function u64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

function oracle(price: bigint, exponent = -8): Buffer {
  const bytes = Buffer.alloc(12);
  bytes.writeBigUInt64LE(price, 0);
  bytes.writeInt32LE(exponent, 8);
  return bytes;
}

function instructionData(...parts: (string | Buffer | Uint8Array | number)[]): Buffer {
  return Buffer.concat(
    parts.map((part) => {
      if (typeof part === 'string') return Buffer.from(part, 'hex');
      if (typeof part === 'number') return Buffer.from([part]);
      return Buffer.from(part);
    }),
  );
}

function meta(pubkey: PublicKey | string, isSigner = false) {
  return {
    pubkey: typeof pubkey === 'string' ? new PublicKey(pubkey) : pubkey,
    isSigner,
    isWritable: true,
  };
}

function ownerAccounts(wallet: PublicKey) {
  return {
    basket: PublicKey.findProgramAddressSync(
      [Buffer.from('basket'), wallet.toBuffer()],
      FLASH_PROGRAM,
    )[0],
    depositLedger: PublicKey.findProgramAddressSync(
      [Buffer.from('user_deposit_ledger'), wallet.toBuffer()],
      FLASH_PROGRAM,
    )[0],
  };
}

function openInstruction(params: {
  wallet: PublicKey;
  market: MarketFixture;
  collateralRaw: bigint;
  sizeRaw: bigint;
  executionPrice?: bigint;
  selectedCustody?: string;
  privilege?: number;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  const selected = params.selectedCustody ?? params.market.selectedCustodyPubkey;
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      meta(params.wallet),
      meta(params.wallet, true),
      meta(FLASH_PROGRAM),
      meta(PERPETUALS),
      meta(owner.basket),
      meta(owner.depositLedger),
      meta(params.market.poolPubkey),
      meta(params.market.marketPubkey),
      meta(params.market.targetCustodyPubkey),
      meta(params.market.collateralCustodyPubkey),
      meta(selected),
      meta(key()),
      meta(key()),
      meta(key()),
      meta(REALLOC),
      meta(EVENT),
      meta(FLASH_PROGRAM),
      meta(INSTRUCTION_SYSVAR),
    ],
    data: instructionData(
      DISCRIMINATORS.open,
      oracle(params.executionPrice ?? 75_000_000n),
      u64(params.collateralRaw),
      u64(params.sizeRaw),
      params.privilege ?? 0,
    ),
  });
}

function increaseInstruction(params: {
  wallet: PublicKey;
  market: MarketFixture;
  collateralRaw: bigint;
  sizeRaw: bigint;
  executionPrice?: bigint;
  privilege?: number;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      meta(params.wallet),
      meta(params.wallet, true),
      meta(FLASH_PROGRAM),
      meta(PERPETUALS),
      meta(owner.basket),
      meta(owner.depositLedger),
      meta(params.market.marketPubkey),
      meta(params.market.poolPubkey),
      meta(params.market.targetCustodyPubkey),
      meta(params.market.selectedCustodyPubkey),
      meta(params.market.collateralCustodyPubkey),
      meta(key()),
      meta(key()),
      meta(key()),
      meta(REALLOC),
      meta(EVENT),
      meta(FLASH_PROGRAM),
      meta(INSTRUCTION_SYSVAR),
    ],
    data: instructionData(
      DISCRIMINATORS.increase,
      oracle(params.executionPrice ?? 75_000_000n),
      u64(params.sizeRaw),
      u64(params.collateralRaw),
      params.privilege ?? 0,
    ),
  });
}

function limitInstruction(params: {
  wallet: PublicKey;
  market: MarketFixture;
  reserveRaw: bigint;
  sizeRaw: bigint;
  limitPrice?: bigint;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      meta(params.wallet),
      meta(params.wallet, true),
      meta(FLASH_PROGRAM),
      meta(PERPETUALS),
      meta(owner.basket),
      meta(owner.depositLedger),
      meta(params.market.poolPubkey),
      meta(params.market.marketPubkey),
      meta(params.market.targetCustodyPubkey),
      meta(params.market.collateralCustodyPubkey),
      meta(params.market.selectedCustodyPubkey),
      meta(params.market.selectedCustodyPubkey),
      meta(key()),
      meta(key()),
      meta(REALLOC),
      meta(EVENT),
      meta(FLASH_PROGRAM),
      meta(INSTRUCTION_SYSVAR),
    ],
    data: instructionData(
      DISCRIMINATORS.placeLimit,
      oracle(params.limitPrice ?? 70_000_000n),
      u64(params.reserveRaw),
      u64(params.sizeRaw),
      oracle(60_000_000n),
      oracle(80_000_000n),
    ),
  });
}

function closeInstruction(params: {
  wallet: PublicKey;
  market: MarketFixture;
  executionPrice?: bigint;
  selectedCustody?: string;
  privilege?: number;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      meta(params.wallet),
      meta(params.wallet, true),
      meta(FLASH_PROGRAM),
      meta(PERPETUALS),
      meta(owner.basket),
      meta(params.market.poolPubkey),
      meta(params.market.marketPubkey),
      meta(params.market.targetCustodyPubkey),
      meta(params.market.collateralCustodyPubkey),
      meta(params.selectedCustody ?? params.market.selectedCustodyPubkey),
      meta(key()),
      meta(key()),
      meta(key()),
      meta(REALLOC),
      meta(EVENT),
      meta(FLASH_PROGRAM),
      meta(INSTRUCTION_SYSVAR),
    ],
    data: instructionData(
      DISCRIMINATORS.close,
      oracle(params.executionPrice ?? 74_000_000n),
      params.privilege ?? 0,
    ),
  });
}

function decreaseInstruction(params: {
  wallet: PublicKey;
  market: MarketFixture;
  sizeRaw: bigint;
  executionPrice?: bigint;
  privilege?: number;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      meta(params.wallet),
      meta(params.wallet, true),
      meta(FLASH_PROGRAM),
      meta(PERPETUALS),
      meta(owner.basket),
      meta(params.market.marketPubkey),
      meta(params.market.poolPubkey),
      meta(params.market.targetCustodyPubkey),
      meta(params.market.selectedCustodyPubkey),
      meta(params.market.collateralCustodyPubkey),
      meta(key()),
      meta(key()),
      meta(key()),
      meta(REALLOC),
      meta(EVENT),
      meta(FLASH_PROGRAM),
      meta(INSTRUCTION_SYSVAR),
    ],
    data: instructionData(
      DISCRIMINATORS.decrease,
      oracle(params.executionPrice ?? 74_000_000n),
      u64(params.sizeRaw),
      params.privilege ?? 0,
    ),
  });
}

function collateralInstruction(params: {
  operation: 'add' | 'remove';
  wallet: PublicKey;
  market: MarketFixture;
  rawAmount: bigint;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  const add = params.operation === 'add';
  const keys = add
    ? [
        meta(params.wallet),
        meta(params.wallet, true),
        meta(FLASH_PROGRAM),
        meta(PERPETUALS),
        meta(owner.basket),
        meta(owner.depositLedger),
        meta(params.market.marketPubkey),
        meta(params.market.poolPubkey),
        meta(params.market.targetCustodyPubkey),
        meta(params.market.selectedCustodyPubkey),
        meta(params.market.collateralCustodyPubkey),
        meta(key()),
        meta(key()),
        meta(key()),
        meta(REALLOC),
        meta(EVENT),
        meta(FLASH_PROGRAM),
        meta(INSTRUCTION_SYSVAR),
      ]
    : [
        meta(params.wallet),
        meta(params.wallet, true),
        meta(FLASH_PROGRAM),
        meta(PERPETUALS),
        meta(owner.basket),
        meta(params.market.marketPubkey),
        meta(params.market.poolPubkey),
        meta(params.market.targetCustodyPubkey),
        meta(params.market.selectedCustodyPubkey),
        meta(params.market.collateralCustodyPubkey),
        meta(key()),
        meta(key()),
        meta(key()),
        meta(REALLOC),
        meta(EVENT),
        meta(FLASH_PROGRAM),
        meta(INSTRUCTION_SYSVAR),
      ];
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys,
    data: instructionData(add ? DISCRIMINATORS.add : DISCRIMINATORS.remove, u64(params.rawAmount)),
  });
}

function triggerInstruction(params: {
  operation: 'place' | 'edit';
  wallet: PublicKey;
  market: MarketFixture;
  sizeRaw: bigint;
  price?: bigint;
  orderSlot?: number;
  isStopLoss?: boolean;
}): TransactionInstruction {
  const owner = ownerAccounts(params.wallet);
  const edit = params.operation === 'edit';
  const prefix = edit
    ? instructionData(DISCRIMINATORS.editTrigger, params.orderSlot ?? 2)
    : instructionData(DISCRIMINATORS.placeTrigger);
  const data = instructionData(
    prefix,
    oracle(params.price ?? 80_000_000n),
    u64(params.sizeRaw),
    params.isStopLoss === true ? 1 : 0,
  );
  const keys = [
    meta(params.wallet),
    meta(params.wallet, true),
    meta(FLASH_PROGRAM),
    meta(PERPETUALS),
    meta(owner.basket),
    meta(params.market.poolPubkey),
    meta(params.market.marketPubkey),
    meta(params.market.targetCustodyPubkey),
    meta(params.market.collateralCustodyPubkey),
    meta(params.market.selectedCustodyPubkey),
    meta(key()),
    meta(key()),
    ...(edit ? [] : [meta(REALLOC)]),
    meta(EVENT),
    meta(FLASH_PROGRAM),
    meta(INSTRUCTION_SYSVAR),
  ];
  return new TransactionInstruction({ programId: FLASH_PROGRAM, keys, data });
}

function cancelAllInstruction(wallet: PublicKey, marketPubkey: string): TransactionInstruction {
  const owner = ownerAccounts(wallet);
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      meta(wallet),
      meta(wallet, true),
      meta(FLASH_PROGRAM),
      meta(PERPETUALS),
      meta(owner.basket),
      meta(EVENT),
      meta(FLASH_PROGRAM),
    ],
    data: instructionData(DISCRIMINATORS.cancel, new PublicKey(marketPubkey).toBytes(), 255, 1),
  });
}

function transaction(
  wallet: PublicKey,
  instructions: TransactionInstruction[],
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: key().toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...instructions],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function transactionWithCompute(
  wallet: PublicKey,
  compute: TransactionInstruction,
  instructions: TransactionInstruction[],
): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: key().toBase58(),
      instructions: [compute, ...instructions],
    }).compileToV0Message(),
  );
}

function base64(value: VersionedTransaction): string {
  return Buffer.from(value.serialize()).toString('base64');
}

function rpcMock() {
  return {
    getAddressLookupTable: jest.fn(async () => ({ value: null })),
    isBlockhashValid: jest.fn(async () => ({ value: true })),
    sendRawTransaction: jest.fn(async () => 'signature'),
    getSignatureStatuses: jest.fn(async () => ({
      value: [
        {
          slot: 1,
          confirmations: 1,
          err: null,
          confirmationStatus: 'confirmed' as const,
        },
      ],
    })),
  };
}

function intent(
  wallet: PublicKey,
  economicIntent: FlashTradeEconomicIntent,
): FlashTradeTransactionIntent {
  return { walletAddress: wallet.toBase58(), economicIntent };
}

function openEconomic(
  market: MarketFixture,
  overrides: Partial<Extract<FlashTradeEconomicIntent, { operation: 'open_position' }>> = {},
): Extract<FlashTradeEconomicIntent, { operation: 'open_position' }> {
  return {
    operation: 'open_position',
    side: 'long',
    tradeType: 'market',
    positionChange: 'open',
    market,
    inputCustodyPubkey: market.selectedCustodyPubkey,
    collateral: amount(10_000_000n, 9, 'JitoSOL'),
    size: amount(270_000_000n, 8, 'SUI'),
    executionPriceLimit: 0.75,
    privilege: 'none',
    triggerOrders: [],
    ...overrides,
  };
}

describe('Flash Trade V2 economic-intent verification', () => {
  it('accepts an exact new-position transaction and validates the ER blockhash', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const value = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
      }),
    ]);
    const rpc = rpcMock();

    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(value),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc,
      }),
    ).resolves.toMatchObject({ flashInstructionNames: ['open_position_er'] });
    expect(rpc.isBlockhashValid).toHaveBeenCalledWith(value.message.recentBlockhash);
  });

  it.each([
    ['collateral', 10_000_001n, 270_000_000n],
    ['position size', 10_000_000n, 270_000_001n],
  ])('rejects malicious open %s substitution', async (_label, collateralRaw, sizeRaw) => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const value = transaction(wallet.publicKey, [
      openInstruction({ wallet: wallet.publicKey, market, collateralRaw, sizeRaw }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(value),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed amount');
  });

  it('binds increase-position size, collateral, price, and privilege in their live order', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const economic = openEconomic(market, {
      positionChange: 'increase',
      collateral: amount(5_000_000n, 9, 'JitoSOL'),
      size: amount(135_000_000n, 8, 'SUI'),
    });
    const exact = transaction(wallet.publicKey, [
      increaseInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 5_000_000n,
        sizeRaw: 135_000_000n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(exact),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).resolves.toMatchObject({ flashInstructionNames: ['increase_position_size_er'] });

    const tampered = transaction(wallet.publicKey, [
      increaseInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 5_000_000n,
        sizeRaw: 135_000_001n,
        privilege: 2,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(tampered),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed amount');
  });

  it('rejects side/market and selected-custody substitution', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const wrongMarket = marketFixture(new PublicKey(market.selectedCustodyPubkey));
    const wrongMarketTx = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market: wrongMarket,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(wrongMarketTx),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected pool account');

    const wrongCustodyTx = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
        selectedCustody: key().toBase58(),
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(wrongCustodyTx),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected selected custody');
  });

  it('cryptographically binds direction through the exact side-specific market account', async () => {
    const wallet = Keypair.generate();
    const longMarket = marketFixture();
    const shortMarket: MarketFixture = {
      ...longMarket,
      side: 'short',
      marketPubkey: key().toBase58(),
    };
    const oppositeSideTx = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market: shortMarket,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
      }),
    ]);

    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(oppositeSideTx),
        intent: intent(wallet.publicKey, openEconomic(longMarket)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected market account');

    const mismatchedLiveMetadata = openEconomic({ ...longMarket, side: 'short' });
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(oppositeSideTx),
        intent: intent(wallet.publicKey, mismatchedLiveMetadata),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('does not match the confirmed side');
  });

  it('decodes and rejects malicious privilege substitution', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const stakePrivilegeTx = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
        privilege: 1,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(stakePrivilegeTx),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed privilege');

    const invalidPrivilegeTx = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
        privilege: 3,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(invalidPrivilegeTx),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('invalid privilege enum');
  });

  it('binds limit price, reserve, position size, stop-loss, and take-profit', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const economic = openEconomic(market, {
      tradeType: 'limit',
      executionPriceLimit: null,
      privilege: null,
      limitPrice: 0.7,
      stopLossPrice: 0.6,
      takeProfitPrice: 0.8,
      size: amount(287_418_144n, 8, 'SUI'),
    });
    const exact = transaction(wallet.publicKey, [
      limitInstruction({
        wallet: wallet.publicKey,
        market,
        reserveRaw: 10_000_000n,
        sizeRaw: 287_418_144n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(exact),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).resolves.toBeDefined();

    const malicious = transaction(wallet.publicKey, [
      limitInstruction({
        wallet: wallet.publicKey,
        market,
        reserveRaw: 10_000_000n,
        sizeRaw: 287_418_145n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(malicious),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed amount');

    const extraTrailingField = limitInstruction({
      wallet: wallet.publicKey,
      market,
      reserveRaw: 10_000_000n,
      sizeRaw: 287_418_144n,
    });
    extraTrailingField.data = Buffer.concat([extraTrailingField.data, Buffer.from([1])]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(transaction(wallet.publicKey, [extraTrailingField])),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected data layout');
  });

  it('rejects a priority-fee injection and an altered compute limit', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const open = openInstruction({
      wallet: wallet.publicKey,
      market,
      collateralRaw: 10_000_000n,
      sizeRaw: 270_000_000n,
    });
    const priorityFeeTx = transactionWithCompute(
      wallet.publicKey,
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      [open],
    );
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(priorityFeeTx),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unsupported compute-budget');

    const alteredLimitTx = transactionWithCompute(
      wallet.publicKey,
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_399_999 }),
      [open],
    );
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(alteredLimitTx),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected compute-unit limit');
  });

  it('binds exact partial-close size and rejects a full-close substitution', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const economic: FlashTradeEconomicIntent = {
      operation: 'close_position',
      side: 'long',
      closeMode: 'partial',
      market,
      outputCustodyPubkey: market.selectedCustodyPubkey,
      outputTokenSymbol: 'JitoSOL',
      size: amount(4_366_306_956n, 8, 'MON'),
      executionPriceLimit: 0.74,
      privilege: 'none',
      cleanupTriggerOrders: false,
    };
    const exact = transaction(wallet.publicKey, [
      decreaseInstruction({ wallet: wallet.publicKey, market, sizeRaw: 4_366_306_956n }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(exact),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).resolves.toBeDefined();

    const full = transaction(wallet.publicKey, [
      closeInstruction({ wallet: wallet.publicKey, market }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(full),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected protocol instruction');
  });

  it('binds add and remove collateral amounts independently', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const addEconomic: FlashTradeEconomicIntent = {
      operation: 'add_collateral',
      side: 'long',
      market,
      inputCustodyPubkey: market.selectedCustodyPubkey,
      amount: amount(10_000_000n, 9, 'JitoSOL'),
    };
    const maliciousAdd = transaction(wallet.publicKey, [
      collateralInstruction({
        operation: 'add',
        wallet: wallet.publicKey,
        market,
        rawAmount: 10_000_001n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(maliciousAdd),
        intent: intent(wallet.publicKey, addEconomic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed amount');

    const removeEconomic: FlashTradeEconomicIntent = {
      operation: 'remove_collateral',
      side: 'long',
      market,
      outputCustodyPubkey: market.selectedCustodyPubkey,
      outputTokenSymbol: 'JitoSOL',
      usdAmountRaw: '1000000',
    };
    const maliciousRemove = transaction(wallet.publicKey, [
      collateralInstruction({
        operation: 'remove',
        wallet: wallet.publicKey,
        market,
        rawAmount: 1_000_001n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(maliciousRemove),
        intent: intent(wallet.publicKey, removeEconomic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('USD amount');
  });

  it('binds trigger size, price, type, slot, and settlement custody', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const placeEconomic: FlashTradeEconomicIntent = {
      operation: 'place_trigger_order',
      side: 'long',
      market,
      receiveCustodyPubkey: market.selectedCustodyPubkey,
      receiveTokenSymbol: 'JitoSOL',
      triggerPrice: 0.8,
      isStopLoss: false,
      size: amount(100_000_000_000n, 8, 'MON'),
    };
    const maliciousSize = transaction(wallet.publicKey, [
      triggerInstruction({
        operation: 'place',
        wallet: wallet.publicKey,
        market,
        sizeRaw: 100_000_000_001n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(maliciousSize),
        intent: intent(wallet.publicKey, placeEconomic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed amount');

    const editEconomic: FlashTradeEconomicIntent = {
      operation: 'edit_trigger_order',
      side: 'long',
      market,
      receiveCustodyPubkey: market.selectedCustodyPubkey,
      receiveTokenSymbol: 'JitoSOL',
      orderSlot: 2,
      triggerPrice: 0.8,
      isStopLoss: false,
      size: amount(100_000_000_000n, 8, 'MON'),
    };
    const wrongSlot = transaction(wallet.publicKey, [
      triggerInstruction({
        operation: 'edit',
        wallet: wallet.publicKey,
        market,
        sizeRaw: 100_000_000_000n,
        orderSlot: 3,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(wrongSlot),
        intent: intent(wallet.publicKey, editEconomic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('unexpected order slot');
  });

  it('binds reverse source/destination markets and exact reopen economics', async () => {
    const wallet = Keypair.generate();
    const settlement = key();
    const source = marketFixture(settlement);
    const destination = marketFixture(settlement, 'short');
    const economic: FlashTradeEconomicIntent = {
      operation: 'reverse_position',
      sourceSide: 'long',
      destinationSide: 'short',
      sourceMarket: source,
      destinationMarket: destination,
      settlementCustodyPubkey: settlement.toBase58(),
      settlementTokenSymbol: 'USDC',
      collateral: amount(35_839_905n, 6, 'USDC'),
      size: amount(781_793_937_470n, 8, 'MON'),
      closeExecutionPriceLimit: 0.74,
      openExecutionPriceLimit: 0.75,
      closePrivilege: 'none',
      openPrivilege: 'none',
      cleanupTriggerOrders: true,
    };
    const malicious = transaction(wallet.publicKey, [
      closeInstruction({ wallet: wallet.publicKey, market: source }),
      cancelAllInstruction(wallet.publicKey, source.marketPubkey),
      openInstruction({
        wallet: wallet.publicKey,
        market: destination,
        collateralRaw: 35_839_905n,
        sizeRaw: 781_793_937_471n,
      }),
    ]);
    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(malicious),
        intent: intent(wallet.publicKey, economic),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('confirmed amount');

    await expect(
      verifyFlashTradeTransaction({
        transactionBase64: base64(malicious),
        intent: intent(wallet.publicKey, {
          ...economic,
          destinationMarket: { ...source, side: 'short' },
        }),
        rpc: rpcMock(),
      }),
    ).rejects.toThrow('distinct side-specific markets');
  });

  it('requires the signed message to match and verifies the wallet signature', async () => {
    const wallet = Keypair.generate();
    const market = marketFixture();
    const unsigned = transaction(wallet.publicKey, [
      openInstruction({
        wallet: wallet.publicKey,
        market,
        collateralRaw: 10_000_000n,
        sizeRaw: 270_000_000n,
      }),
    ]);
    const signed = VersionedTransaction.deserialize(unsigned.serialize());
    signed.sign([wallet]);
    await expect(
      verifySignedFlashTradeTransaction({
        unsignedTransactionBase64: base64(unsigned),
        signedTransactionBase64: base64(signed),
        intent: intent(wallet.publicKey, openEconomic(market)),
        rpc: rpcMock(),
      }),
    ).resolves.toMatchObject({ walletSignerIndex: 0 });
  });

  it('submits to the injected ER RPC with preflight and waits for confirmation', async () => {
    const wallet = Keypair.generate();
    const value = transaction(wallet.publicKey, []);
    value.sign([wallet]);
    const rpc = rpcMock();
    await expect(
      sendAndConfirmFlashTradeTransaction({ signedTransactionBase64: base64(value), rpc }),
    ).resolves.toMatchObject({ signature: 'signature' });
    expect(rpc.sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), {
      skipPreflight: false,
      maxRetries: 3,
    });
  });
});
