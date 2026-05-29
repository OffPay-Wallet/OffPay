import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
import { runCryptoTask } from '@/lib/crypto/crypto-scheduler';
import { mark, measure } from '@/lib/perf/perf-marks';
import { getOrDeriveSigningSeed } from '@/lib/wallet/signing-seed-cache';
import { getStoredWalletSigningMaterialWithAuth } from '@/lib/wallet/secure-wallet-store';
import {
  decodeSigningSeedFromPrivateKey,
  deriveSigningSeedFromMnemonic,
} from '@/lib/wallet/wallet';

import type { IUmbraSigner } from '@umbra-privacy/sdk/client';

/**
 * Security-critical helpers for the Umbra signer.
 *
 * `deriveSigningSeedForUmbra` reads stored wallet material, runs the
 * mnemonic/private-key derivation through the warm signing-seed cache,
 * and verifies that the derived public key matches the active wallet
 * address before caching. A mismatched seed is zeroed and rejected
 * before it can be reused.
 *
 * `createNobleUmbraSigner` adapts the derived seed into the Umbra SDK's
 * `IUmbraSigner` interface using `@noble/curves` for ed25519 message
 * and transaction signing. Each signing call is routed through
 * `runCryptoTask` so the work is scheduled off the main thread.
 *
 * The returned signer owns a fresh copy of the seed; calling
 * `dispose()` zeros that copy. Callers MUST invoke `dispose` after the
 * runtime is finished to limit how long the signing seed sits in
 * memory.
 */

export async function deriveSigningSeedForUmbra(
  walletAddress: string,
  walletId?: string | null,
): Promise<Uint8Array> {
  const startedAt = mark();

  const signingSeed = await getOrDeriveSigningSeed({
    walletAddress,
    derive: async () => {
      const signingMaterial = await getStoredWalletSigningMaterialWithAuth(
        walletId ?? undefined,
      );
      const seed =
        signingMaterial?.mnemonic != null
          ? await deriveSigningSeedFromMnemonic(signingMaterial.mnemonic)
          : signingMaterial?.privateKey != null
            ? decodeSigningSeedFromPrivateKey(signingMaterial.privateKey)
            : null;

      if (seed == null) {
        throw new Error('Unlock your wallet to run Umbra private payments.');
      }

      // Verify before caching to keep a corrupt/mismatched private
      // key out of the warm cache.
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
  measure('umbra.deriveSigningSeed', startedAt);

  return signingSeed;
}

export interface UmbraSignerHandle {
  signer: IUmbraSigner;
  dispose: () => void;
}

export function createNobleUmbraSigner(
  walletAddress: string,
  signingSeed: Uint8Array,
): UmbraSignerHandle {
  if (signingSeed.length !== 32) {
    throw new Error(`Umbra signer requires a 32-byte signing seed, got ${signingSeed.length}.`);
  }

  const signerSeed = Uint8Array.from(signingSeed);
  const signer: IUmbraSigner = {
    address: walletAddress as never,
    signMessage: async (message: Uint8Array) => {
      const signature = await runCryptoTask('umbra.signMessage', () =>
        ed25519.sign(message, signerSeed),
      );
      return {
        message,
        signature: Uint8Array.from(signature) as never,
        signer: walletAddress as never,
      };
    },
    signTransaction: async (transaction) => {
      const messageBytes = transaction.messageBytes as unknown as Uint8Array;
      const signature = await runCryptoTask('umbra.signTransaction', () =>
        ed25519.sign(messageBytes, signerSeed),
      );
      return {
        ...transaction,
        signatures: {
          ...transaction.signatures,
          [walletAddress]: Uint8Array.from(signature),
        },
      } as never;
    },
    signTransactions: async (transactions) =>
      Promise.all(transactions.map((transaction) => signer.signTransaction(transaction))),
  };

  return {
    signer,
    dispose: () => zeroOutBytes(signerSeed),
  };
}
