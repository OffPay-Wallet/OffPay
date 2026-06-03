import { Platform } from 'react-native';

import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { validateAgenticPrivateSendDraft } from '@/lib/agentic-payments/private-send';
import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import {
  isUmbraNetworkSupported,
  resolveUmbraSupportedToken,
} from '@/lib/umbra/umbra-supported-tokens';

import { hydrateStringArg, readTransferRouteArg, stringField, validatorErrorCode } from './helpers';
import { resolveRecipientForDraft } from './resolve-recipient';
import type {
  AgenticToolDefinition,
  AgenticToolRunnerContext,
  AgenticTransferRoute,
  PaymentDraftToolOptions,
  ToolHandlerOutcome,
} from './types';
import type { AgentToolCall } from '@/lib/agentic-payments/types';
import type { OffpayNetwork } from '@/types/offpay-api';

function routeKind(route: AgenticTransferRoute): 'normal_send' | 'private_send' {
  return route === 'normal' ? 'normal_send' : 'private_send';
}

function isUmbraRouteReady(
  context: AgenticToolRunnerContext,
): { ok: true } | { ok: false; code: string } {
  const capabilities = context.capabilities ?? null;
  if (context.scope.network == null) return { ok: false, code: 'network_not_selected' };
  if (!isUmbraNetworkSupported(context.scope.network))
    return { ok: false, code: 'feature_unavailable' };
  if (context.walletMode !== 'online' || !context.canUseNetwork) {
    return { ok: false, code: 'requires_online_mode' };
  }
  if (Platform.OS === 'web' || !isRnZkProverNativeModuleAvailable()) {
    return { ok: false, code: 'umbra_prover_unavailable' };
  }
  if (
    !isOffpayFeatureAvailable(capabilities, 'umbra.execution') ||
    !isOffpayFeatureAvailable(capabilities, 'payment.umbraPrivateP2p') ||
    !isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast')
  ) {
    return { ok: false, code: 'feature_unavailable' };
  }
  return { ok: true };
}

function ensureUmbraTokenSupported(params: {
  network: OffpayNetwork;
  token: string;
}): { ok: true } | { ok: false; code: string } {
  try {
    resolveUmbraSupportedToken({ network: params.network, token: params.token });
    return { ok: true };
  } catch {
    return { ok: false, code: 'token_not_supported_for_umbra' };
  }
}

export async function buildPaymentDraft(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
  options: PaymentDraftToolOptions,
): Promise<ToolHandlerOutcome> {
  const route = readTransferRouteArg(call, options.defaultRoute);
  const args = call.args ?? {};
  const rawRecipient = stringField(args.recipient);
  const recipientResolution = await resolveRecipientForDraft({ rawRecipient, context });
  if (!recipientResolution.ok) return { error: { code: recipientResolution.code } };

  const validationInput = {
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
  };

  const validation =
    route === 'magicblock'
      ? validateAgenticPrivateSendDraft(validationInput)
      : validateAgenticNormalSendDraft(validationInput);

  if (!validation.ok) return { error: { code: validatorErrorCode(validation.message) } };

  if (route === 'umbra') {
    const routeReady = isUmbraRouteReady(context);
    if (!routeReady.ok) return { error: { code: routeReady.code } };
    const tokenReady = ensureUmbraTokenSupported({
      network: validation.draft.network,
      token: validation.draft.tokenMint,
    });
    if (!tokenReady.ok) return { error: { code: tokenReady.code } };
  }

  return {
    result: {
      status: 'drafted',
      route,
      amount: validation.draft.amount,
      tokenSymbol: validation.draft.tokenSymbol,
      tokenName: validation.draft.tokenName,
      network: validation.draft.network,
    },
    draft: {
      kind: routeKind(route),
      route,
      draft: validation.draft,
    },
  };
}

const transferProperties = {
  amount: { type: 'string' },
  token: { type: 'string', description: 'Symbol or mint, e.g. USDC, SOL.' },
  recipient: {
    type: 'string',
    description:
      'Address, redaction placeholder ([ADDRESS_1]), SNS/X reference, saved wallet, or self.',
  },
  route: {
    type: 'string',
    enum: ['normal', 'magicblock', 'umbra', 'auto'],
    description:
      'Payment route. Use normal for public transfer, magicblock for MagicBlock private send, umbra for Umbra private P2P.',
  },
};

export const draftNormalSendTool: AgenticToolDefinition = {
  name: 'draft_normal_send',
  schema: {
    name: 'draft_normal_send',
    description:
      'Prepares an unsigned transfer for explicit user confirmation. Supports route normal, magicblock, or umbra when the user requests a route.',
    parameters: {
      type: 'object',
      properties: transferProperties,
      required: ['amount', 'token', 'recipient'],
    },
  },
  run: (call, context) => buildPaymentDraft(call, context, { defaultRoute: 'normal' }),
};

export const draftPrivateSendTool: AgenticToolDefinition = {
  name: 'draft_private_send',
  schema: {
    name: 'draft_private_send',
    description:
      'Prepares a private-route transfer for explicit user confirmation. Supports MagicBlock private send or Umbra private P2P. USDC/USDT-style supported private tokens only.',
    parameters: {
      type: 'object',
      properties: transferProperties,
      required: ['amount', 'token', 'recipient'],
    },
  },
  run: (call, context) => buildPaymentDraft(call, context, { defaultRoute: 'magicblock' }),
};
