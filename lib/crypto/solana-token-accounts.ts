import { Buffer } from 'buffer';

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const PDA_MARKER = 'ProgramDerivedAddress';

function assertBase58PublicKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!isValidSolanaAddress(normalized)) {
    throw new Error(`${label} must be a valid Solana public key.`);
  }
  return normalized;
}

function publicKeyBytes(value: string, label: string): Uint8Array {
  return bs58.decode(assertBase58PublicKey(value, label));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function isPointOnEd25519Curve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

function createProgramAddress(seeds: Uint8Array[], programId: string): string {
  const programIdBytes = publicKeyBytes(programId, 'Program id');
  for (const seed of seeds) {
    if (seed.length > 32) {
      throw new Error('Solana PDA seed is too long.');
    }
  }

  const digest = sha256(
    concatBytes([
      ...seeds,
      programIdBytes,
      Uint8Array.from(Buffer.from(PDA_MARKER, 'utf8')),
    ]),
  );
  if (isPointOnEd25519Curve(digest)) {
    throw new Error('Solana PDA derivation resolved to an on-curve address.');
  }

  return bs58.encode(digest);
}

function findProgramAddress(seeds: Uint8Array[], programId: string): string {
  for (let bump = 255; bump >= 0; bump -= 1) {
    try {
      return createProgramAddress([...seeds, Uint8Array.from([bump])], programId);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'Solana PDA derivation resolved to an on-curve address.'
      ) {
        throw error;
      }
    }
  }

  throw new Error('Unable to derive a Solana PDA for the associated token account.');
}

export function deriveAssociatedTokenAddress({
  owner,
  mint,
  tokenProgramId = SPL_TOKEN_PROGRAM_ID,
}: {
  owner: string;
  mint: string;
  tokenProgramId?: string;
}): string {
  return findProgramAddress(
    [
      publicKeyBytes(owner, 'Token account owner'),
      publicKeyBytes(tokenProgramId, 'Token program'),
      publicKeyBytes(mint, 'Token mint'),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}
