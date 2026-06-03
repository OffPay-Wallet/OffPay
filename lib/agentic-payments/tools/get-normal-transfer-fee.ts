import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';

import { hydrateStringArg, validatorErrorCode } from './helpers';
import { resolveRecipientForDraft } from './resolve-recipient';
import type { AgenticToolDefinition } from './types';
import type { OffpayNetwork } from '@/types/offpay-api';

export const getNormalTransferFeeTool: AgenticToolDefinition = {
  name: 'get_normal_transfer_fee',
  schema: {
    name: 'get_normal_transfer_fee',
    description:
      'Estimates the live SOL fee for a normal public token transfer by compiling the same transaction message used at confirmation time.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        token: { type: 'string' },
        recipient: {
          type: 'string',
          description: 'Address, redaction placeholder, SNS/X reference, saved wallet, or self.',
        },
      },
      required: ['amount', 'token', 'recipient'],
    },
  },
  run: async (call, context) => {
    const rawRecipient = typeof call.args?.recipient === 'string' ? call.args.recipient.trim() : '';
    const recipientResolution = await resolveRecipientForDraft({ rawRecipient, context });
    if (!recipientResolution.ok) return { error: { code: recipientResolution.code } };

    const validation = validateAgenticNormalSendDraft({
      input: {
        recipient: recipientResolution.recipient,
        amount: hydrateStringArg(call, 'amount', context.redactions),
        token: hydrateStringArg(call, 'token', context.redactions),
      },
      userText: context.userText,
      knownWallets: [...context.knownWallets],
      walletAddress: context.scope.walletAddress,
      network: context.scope.network as OffpayNetwork | null,
      walletMode: context.walletMode,
      canUseNetwork: context.canUseNetwork,
      balance: context.balance,
      capabilities: context.capabilities,
      allowSelfRecipient: recipientResolution.allowSelfRecipient,
    });
    if (!validation.ok) return { error: { code: validatorErrorCode(validation.message) } };

    try {
      const { estimateNormalTokenTransferFee } =
        await import('@/lib/payments/normal-token-transfer-fee');
      const estimate = await estimateNormalTokenTransferFee({
        walletAddress: validation.draft.walletAddress,
        recipient: validation.draft.recipient,
        mint: validation.draft.tokenMint,
        rawAmount: validation.draft.rawAmount,
        decimals: validation.draft.tokenDecimals,
        network: validation.draft.network,
        signal: context.signal,
      });
      return {
        result: {
          status: 'ok',
          lamports: estimate.lamports,
          sol:
            estimate.lamports == null
              ? null
              : formatLamportsAsSol(estimate.lamports, 9).replace(/\.?0+$/, ''),
          route: 'normal',
        },
      };
    } catch {
      return { error: { code: 'fee_estimate_failed' } };
    }
  },
};
