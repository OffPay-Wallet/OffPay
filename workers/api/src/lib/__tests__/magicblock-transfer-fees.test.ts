import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

import { createMagicBlockPrivatePaymentTransaction } from '../magicblock';
import { resetHeliusFetchImplementation, setHeliusFetchImplementation } from '../helius';
import { preparePrivatePayment } from '../payment';

import type { Bindings } from '../types';

const sender = Keypair.fromSeed(new Uint8Array(32).fill(61)).publicKey.toBase58();
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey.toBase58();
const validator = Keypair.fromSeed(new Uint8Array(32).fill(63)).publicKey.toBase58();
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MagicBlock private transfer fee metadata', () => {
  afterEach(() => {
    resetHeliusFetchImplementation();
    jest.restoreAllMocks();
  });

  it('preserves the real provider token and lamport fees for balance gating and review', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        from: sender,
        to: recipient,
        amount: 1_000_000,
        cluster: 'mainnet',
        mint,
        visibility: 'private',
        fromBalance: 'base',
        toBalance: 'base',
        validator,
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: false,
      });
      return new Response(
        JSON.stringify({
          kind: 'transfer',
          version: 'v0',
          transactionBase64: 'AQIDBA==',
          sendTo: 'base',
          recentBlockhash: Keypair.fromSeed(new Uint8Array(32).fill(64)).publicKey.toBase58(),
          lastValidBlockHeight: 123_456,
          instructionCount: 4,
          requiredSigners: [sender],
          validator,
          fees: { lamports: '2039280', tokens: '1000' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await expect(
      createMagicBlockPrivatePaymentTransaction({} as Bindings, {
        senderWallet: sender,
        recipientWallet: recipient,
        mint,
        amount: '1000000',
        network: 'mainnet',
        validator,
      }),
    ).resolves.toMatchObject({
      fees: { lamports: '2039280', tokens: '1000' },
    });
  });

  it('rejects an amount that leaves no balance for the provider token fee', async () => {
    const payer = Keypair.fromSeed(new Uint8Array(32).fill(65));
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: payer.publicKey,
          lamports: 0,
        }),
      ],
    }).compileToV0Message();
    const providerTransaction = Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString('base64');
    const configuredBindings = {
      HELIUS_MAINNET_RPC_URL: 'https://mainnet-rpc.offpay.test',
      MAGICBLOCK_MAINNET_VALIDATORS: validator,
      OFFPAY_MAINNET_USDC_MINT: mint,
    } as Bindings;

    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as {
          id: unknown;
          params: [{}, { programId?: string }];
        };
        const isLegacyToken = request.params[1]?.programId?.startsWith('Tokenkeg') === true;
        return jsonRpcResponse(request.id, {
          value: isLegacyToken
            ? [
                {
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint,
                          tokenAmount: {
                            amount: '1000000',
                            decimals: 6,
                            uiAmountString: '1',
                          },
                        },
                      },
                    },
                  },
                },
              ]
            : [],
        });
      }),
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'transfer',
          version: 'v0',
          transactionBase64: providerTransaction,
          sendTo: 'base',
          recentBlockhash: '11111111111111111111111111111111',
          lastValidBlockHeight: 123_456,
          instructionCount: 4,
          requiredSigners: [payer.publicKey.toBase58()],
          validator,
          fees: { lamports: '0', tokens: '1000' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      preparePrivatePayment(configuredBindings, {
        walletAddress: payer.publicKey.toBase58(),
        recipient,
        mint,
        amount: '1000000',
        network: 'mainnet',
      }),
    ).rejects.toThrow('amount and protocol fee');
  });
});
