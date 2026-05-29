import { getRpcSignatureStatuses } from '@/lib/api/offpay-api-client';
import { getUmbraFriendlyErrorMessage, type UmbraErrorAction } from '@/lib/umbra/umbra-error-messages';
import { isBenignArciumDuplicateCallback } from '@/lib/umbra/umbra-indexer-adapter';

import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Cross-flow Umbra transaction helpers.
 *
 * `UmbraOnChainTransactionError` and `assertUmbraTransactionSignaturesLanded`
 * are the canonical "did the transaction(s) land?" check across all
 * Umbra flows (register, shield, private P2P, claim, withdraw). They
 * tolerate Arcium's known double-callback race
 * (`AlreadyCallbackedComputation`) — the second submission landing as
 * a duplicate is benign because the first already settled the
 * computation on-chain.
 *
 * `extractCustomProgramCode`, `isUmbraInstructionFallbackNotFound`,
 * and `stringifyErrorForInspection` are the error-shape probes used
 * to decide which protocol version to retry against and how to render
 * the failure to the user.
 *
 * Everything in this file is pure logic + one OffPay API call
 * (`getRpcSignatureStatuses`) — no SDK references, no runtime
 * dependencies.
 */

export function assertPositiveAtomicAmount(amountAtomic: string): string {
  if (!/^\d+$/.test(amountAtomic) || BigInt(amountAtomic) <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  return amountAtomic;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stringifyErrorForInspection(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function extractCustomProgramCode(error: unknown): number | null {
  if (error == null) return null;
  if (typeof error === 'number' && Number.isSafeInteger(error)) return error;
  if (typeof error === 'string') {
    const customMatch = error.match(/custom program error:\s*(0x[0-9a-f]+|\d+)/i);
    if (customMatch?.[1] != null) {
      const raw = customMatch[1];
      return raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number(raw);
    }
    const anchorMatch = error.match(/Custom['"]?\s*[:=]\s*['"]?(\d+)/i);
    if (anchorMatch?.[1] != null) return Number(anchorMatch[1]);
    return null;
  }
  if (Array.isArray(error)) {
    if (error.length === 2) {
      const instructionDetailCode = extractCustomProgramCode(error[1]);
      if (instructionDetailCode != null) return instructionDetailCode;
    }
    for (const entry of error) {
      const code = extractCustomProgramCode(entry);
      if (code != null) return code;
    }
    return null;
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const custom = record.Custom ?? record.custom;
    if (typeof custom === 'number' && Number.isSafeInteger(custom)) return custom;
    const instructionError = record.InstructionError ?? record.instructionError;
    if (instructionError != null) return extractCustomProgramCode(instructionError);
    const err = record.err ?? record.error ?? record.rpcError;
    if (err != null) return extractCustomProgramCode(err);
    if (error instanceof Error) return extractCustomProgramCode(error.message);
  }
  return null;
}

export function isUmbraInstructionFallbackNotFound(error: unknown): boolean {
  const message = stringifyErrorForInspection(error);
  return (
    extractCustomProgramCode(error) === 101 ||
    /InstructionFallbackNotFound|Fallback functions are not supported|custom program error:\s*0x65/i.test(
      message,
    )
  );
}

export class UmbraOnChainTransactionError extends Error {
  readonly action: UmbraErrorAction;
  readonly err: unknown;
  readonly network: OffpayNetwork;
  readonly signature: string;

  constructor(params: {
    action: UmbraErrorAction;
    err: unknown;
    network: OffpayNetwork;
    signature: string;
  }) {
    super(getUmbraFriendlyErrorMessage(params.err, params.action));
    this.name = 'UmbraOnChainTransactionError';
    this.action = params.action;
    this.err = params.err;
    this.network = params.network;
    this.signature = params.signature;
  }
}

export async function assertUmbraTransactionSignaturesLanded(params: {
  network: OffpayNetwork;
  signatures: string[];
  action: UmbraErrorAction;
  requireSignature?: boolean;
}): Promise<void> {
  if (params.signatures.length === 0) {
    if (params.requireSignature === true) {
      throw new Error(
        getUmbraFriendlyErrorMessage('Umbra action did not submit a transaction.', params.action),
      );
    }
    return;
  }

  let response: Awaited<ReturnType<typeof getRpcSignatureStatuses>> | null = null;
  let missingSignature: string | undefined;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await getRpcSignatureStatuses({
      network: params.network,
      signatures: params.signatures,
    });
    missingSignature = params.signatures.find((_, index) => response?.statuses[index] == null);
    if (missingSignature == null) break;
    await sleep(750);
  }

  if (response == null || missingSignature != null) {
    throw new Error(
      getUmbraFriendlyErrorMessage(
        `Umbra transaction produced a signature, but it is not visible on-chain yet: ${
          missingSignature ?? 'unknown'
        }`,
        params.action,
      ),
    );
  }

  const failedIndex = response.statuses.findIndex((status) => status?.err != null);
  if (failedIndex >= 0) {
    const failedStatus = response.statuses[failedIndex]!;
    // Arcium's MPC cluster occasionally races to submit `CallbackComputation`:
    // two cluster nodes each broadcast the callback, the first lands and the
    // second trips Arcium's `AlreadyCallbackedComputation` guard (error 6204).
    // Because the first callback already ran the on-chain settlement, the
    // user's registration/shield/unshield is effectively complete. Treat this
    // case as non-fatal so the setup flow doesn't mark a succeeded computation
    // as "Send failed". Any other on-chain error is still surfaced.
    if (!isBenignArciumDuplicateCallback(failedStatus.err)) {
      const signature = params.signatures[failedIndex] ?? 'unknown';
      if (__DEV__) {
        console.warn('[umbra-execution] transaction failed on-chain', {
          action: params.action,
          network: params.network,
          signature,
          err: failedStatus.err,
        });
      }
      throw new UmbraOnChainTransactionError({
        action: params.action,
        err: failedStatus.err,
        network: params.network,
        signature,
      });
    }
  }
}
