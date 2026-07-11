import { Buffer } from 'buffer';
import { ed25519 } from '@noble/curves/ed25519.js';
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { AppError } from './errors.js';

interface BoundTransactionMessageRequest {
  transactionBase64: string;
  requiredSignerAddress: string;
  requiredFeePayerAddress?: string;
  requireSignerSignature: boolean;
  label: string;
}

interface BoundTransactionDetails {
  transactionMessageBase64: string;
  transactionSignature: string | null;
}

/**
 * Returns the canonical Solana message bytes while enforcing signer ownership.
 * Comparing this value before and after wallet signing prevents a caller from
 * substituting another valid transaction under an existing provider request ID.
 */
function readBoundTransactionDetails(
  request: BoundTransactionMessageRequest,
): BoundTransactionDetails {
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(
      Buffer.from(request.transactionBase64, 'base64'),
    );
  } catch {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${request.label} transaction wire payload is invalid.`,
    });
  }

  const messageBytes = transaction.message.serialize();
  if (
    request.requiredFeePayerAddress != null &&
    transaction.message.staticAccountKeys[0]?.toBase58() !== request.requiredFeePayerAddress
  ) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${request.label} transaction does not use the authenticated wallet as fee payer.`,
    });
  }
  const signerKeys = transaction.message.staticAccountKeys.slice(
    0,
    transaction.message.header.numRequiredSignatures,
  );
  const signerIndex = signerKeys.findIndex(
    (publicKey) => publicKey.toBase58() === request.requiredSignerAddress,
  );
  if (signerIndex < 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${request.label} transaction does not require the authenticated wallet signature.`,
    });
  }

  if (request.requireSignerSignature) {
    const signature = transaction.signatures[signerIndex];
    const publicKey = signerKeys[signerIndex];
    if (
      signature == null ||
      publicKey == null ||
      signature.every((byte) => byte === 0) ||
      !ed25519.verify(signature, messageBytes, publicKey.toBytes())
    ) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: `${request.label} transaction is not signed by the authenticated wallet.`,
      });
    }
  }

  const primarySignature = transaction.signatures[0];
  return {
    transactionMessageBase64: Buffer.from(messageBytes).toString('base64'),
    transactionSignature:
      primarySignature == null || primarySignature.every((byte) => byte === 0)
        ? null
        : bs58.encode(primarySignature),
  };
}

function readBoundTransactionMessage(request: BoundTransactionMessageRequest): string {
  return readBoundTransactionDetails(request).transactionMessageBase64;
}

export { readBoundTransactionDetails, readBoundTransactionMessage };
export type { BoundTransactionDetails };
