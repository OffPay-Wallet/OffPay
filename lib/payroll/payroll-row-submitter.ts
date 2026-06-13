import type { PayrollRowSubmitContext, PayrollSubmitOutcome } from '@/lib/payroll/payroll-executor';
import { getWalletSigningBlocker } from '@/lib/wallet/wallet-capabilities';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type { OffpayNetwork } from '@/types/offpay-api';

export interface PayrollSubmitterContext {
  walletAddress: string;
  walletId: string | null;
  network: OffpayNetwork;
  /** Token symbol for the run (Umbra resolves token by symbol/mint). */
  tokenSymbol: string;
  /** Import method for the wallet that will sign this run. */
  walletImportMethod: WalletImportMethod | null;
}

/**
 * Bridges a routed batch-send row to the real Umbra / MagicBlock send paths and
 * normalizes their differing result shapes into a single
 * `PayrollSubmitOutcome`.
 *
 * Heavy modules (`@/lib/magicblock/private-payment`, `@/lib/umbra/...`) are
 * lazy-imported so batch send can be staged and validated without pulling the
 * prover / MagicBlock client into the bundle until execution actually runs.
 */
export function createPayrollRowSubmitter(
  context: PayrollSubmitterContext,
): (submit: PayrollRowSubmitContext) => Promise<PayrollSubmitOutcome> {
  return async ({ row, route }) => {
    const signingBlocker = getWalletSigningBlocker(
      context.walletImportMethod,
      'Batch send',
      context.walletAddress,
    );
    if (signingBlocker != null) {
      throw new Error(signingBlocker);
    }

    if (route === 'magicblock') {
      return submitViaMagicBlock(context, row.recipient, row.amountAtomic, row.tokenMint);
    }
    return submitViaUmbra(
      context,
      row.recipient,
      row.amountDisplay,
      row.tokenMint,
      row.tokenSymbol,
    );
  };
}

async function submitViaMagicBlock(
  context: PayrollSubmitterContext,
  recipient: string,
  amountAtomic: string,
  mint: string,
): Promise<PayrollSubmitOutcome> {
  const { submitPrivatePayment } = await import('@/lib/magicblock/private-payment');
  const result = await submitPrivatePayment({
    walletAddress: context.walletAddress,
    walletId: context.walletId,
    recipient,
    amount: amountAtomic,
    mint,
    network: context.network,
  });

  if (result.status === 'submitted') {
    return {
      status: 'submitted',
      signature: result.signature,
      initSignature: result.initSignature,
    };
  }
  return {
    status: 'queued',
    txId: result.txId,
    initSignature: result.initSignature,
  };
}

async function submitViaUmbra(
  context: PayrollSubmitterContext,
  recipient: string,
  amountDisplay: string,
  mint: string,
  symbol: string,
): Promise<PayrollSubmitOutcome> {
  const { sendUmbraPrivateP2PFromPublicBalance } = await import('@/lib/umbra/umbra-execution');
  const result = await sendUmbraPrivateP2PFromPublicBalance({
    walletAddress: context.walletAddress,
    walletId: context.walletId,
    network: context.network,
    token: symbol || context.tokenSymbol,
    tokenMint: mint,
    amount: amountDisplay,
    recipient,
    // The mainnet sender mixer-registration preflight runs before the batch;
    // we do not auto-setup mid-run (it would inject extra txs unexpectedly).
    autoSetupSender: false,
  });

  const signature = result.primarySignature ?? result.signatures[0] ?? null;
  if (signature == null) {
    throw new Error('Umbra deposit did not return a signature.');
  }
  // An Umbra P2P deposit is a sender-side success but the recipient must
  // claim — the executor records this as `deposited_unclaimed`.
  return { status: 'deposited_unclaimed', signature };
}
