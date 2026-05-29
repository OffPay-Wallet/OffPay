import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { getUmbraFriendlyErrorMessage, type UmbraErrorAction } from '@/lib/umbra/umbra-error-messages';
import { getCallbackStatusFromResult } from '@/lib/umbra/umbra-indexer-adapter';
import { getStringProperty } from '@/lib/umbra/umbra-parsing';

/**
 * Pure helpers for inspecting Umbra SDK call results.
 *
 * `assertWalletAddress` / `assertRecipientAddress` validate base58
 * addresses used by every Umbra flow.
 *
 * `collectSignaturesFromResult`, `getUmbraPublicCreateUtxoSignature`,
 * and `getUmbraPreferredSignature` walk the SDK's nested result
 * objects (signatures may sit on `txSignature`, `callbackSignature`,
 * `signatures`, `batches`, etc.) and pull out the on-chain transaction
 * IDs we surface to the user.
 *
 * `assertUmbraComputationFinalized` checks that an Arcium MPC
 * computation actually finalized — pruned/timed-out states need a
 * retry, missing callback statuses bubble up as user-facing failures.
 *
 * No SDK or runtime dependencies, so this file imports cleanly from
 * any flow.
 */

export function assertWalletAddress(value: string): string {
  const normalized = value.trim();
  if (!isValidSolanaAddress(normalized)) {
    throw new Error('Umbra execution requires a valid active wallet.');
  }

  return normalized;
}

export function assertRecipientAddress(value: string): string {
  const normalized = value.trim();
  if (!isValidSolanaAddress(normalized)) {
    throw new Error('Enter a valid recipient wallet address.');
  }

  return normalized;
}

export function collectSignaturesFromResult(result: unknown): string[] {
  const signatures: string[] = [];

  function visit(value: unknown): void {
    if (typeof value === 'string' && value.length > 0) {
      signatures.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value instanceof Map) {
      for (const entry of value.values()) {
        visit(entry);
      }
      return;
    }
    if (value == null || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    for (const key of [
      'signature',
      'queueSignature',
      'callbackSignature',
      'callback_signature',
      'rentClaimSignature',
      'rent_claim_signature',
      'closeProofAccountSignature',
      'createProofAccountSignature',
      'createUtxoSignature',
      'txSignature',
    ]) {
      visit(record[key]);
    }
    visit(record.callback);
    visit(record.rentClaim);
    visit(record.signatures);
    visit(record.batches);
  }

  visit(result);
  return Array.from(new Set(signatures));
}

export function getUmbraPublicCreateUtxoSignature(result: unknown): string | null {
  return (
    getStringProperty(result, ['createUtxoSignature']) ??
    collectSignaturesFromResult(result).at(-1) ??
    null
  );
}

export function getUmbraPreferredSignature(result: unknown): string | null {
  return (
    getStringProperty(result, [
      'txSignature',
      'callbackSignature',
      'createUtxoSignature',
      'queueSignature',
      'signature',
    ]) ??
    collectSignaturesFromResult(result)[0] ??
    null
  );
}

export function assertUmbraComputationFinalized(params: {
  result: unknown;
  action: UmbraErrorAction;
}): void {
  const callbackStatus = getCallbackStatusFromResult(params.result);
  if (callbackStatus === 'finalized') return;

  if (callbackStatus === 'pruned' || callbackStatus === 'timed-out') {
    throw new Error(
      `Umbra settlement is still pending (${callbackStatus}). Refresh shielded balance in a moment.`,
    );
  }

  throw new Error(
    getUmbraFriendlyErrorMessage(
      callbackStatus == null
        ? 'Umbra computation did not return a callback finalization result.'
        : `Umbra computation callback did not finalize: ${callbackStatus}.`,
      params.action,
    ),
  );
}
