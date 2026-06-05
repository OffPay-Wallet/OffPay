import { Platform } from 'react-native';

import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { validateAgenticPrivateSendDraft } from '@/lib/agentic-payments/private-send';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import {
  getUmbraSupportedTokens,
  isUmbraNetworkSupported,
  resolveUmbraSupportedToken,
} from '@/lib/umbra/umbra-supported-tokens';
import { walletHasLocalSigningMaterial } from '@/lib/wallet/wallet-capabilities';

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

const ROUTE_WORDS: Record<AgenticTransferRoute, RegExp> = {
  normal:
    /\b(?:normal|public|direct)\s+(?:send|route|transfer|payment)\b|\b(?:send|transfer|pay)\s+(?:normally|publicly|directly)\b/i,
  magicblock: /\b(?:magic\s*block|private\s+(?:send|route|transfer|payment)|shielded|stealth)\b/i,
  umbra: /\b(?:umbra|private\s+p2p)\b/i,
};

const DEFAULT_PAYMENT_TOKENS = ['SOL', 'USDC', 'USDT', 'dUSDC', 'dUSDT'] as const;

function routeKind(route: AgenticTransferRoute): 'normal_send' | 'private_send' {
  return route === 'normal' ? 'normal_send' : 'private_send';
}

function inferRouteFromRecentUserText(userText: string): AgenticTransferRoute | null {
  const turns = userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0)
    .reverse();

  for (const turn of turns) {
    if (ROUTE_WORDS.umbra.test(turn)) return 'umbra';
    if (ROUTE_WORDS.magicblock.test(turn)) return 'magicblock';
    if (ROUTE_WORDS.normal.test(turn)) return 'normal';
  }

  return null;
}

function latestUserTurn(userText: string): string {
  const turns = userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0);
  return turns.at(-1) ?? '';
}

function canRecoverDraftFields(userText: string): boolean {
  const latest = latestUserTurn(userText);
  return /\b(?:send|transfer|pay|move|yes|yep|yeah|ok|okay|go\s+ahead|use|try|switch|change)\b/i.test(
    latest,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRecoverableTokenSymbols(
  context: AgenticToolRunnerContext,
  route: AgenticTransferRoute,
): string[] {
  const symbols = new Set<string>(DEFAULT_PAYMENT_TOKENS);
  for (const token of context.balance?.tokens ?? []) {
    const symbol = token.symbol.trim();
    if (symbol.length > 0 && symbol.toUpperCase() !== 'UMBRA') symbols.add(symbol);
  }

  if (context.scope.network != null) {
    for (const token of getUmbraSupportedTokens(context.scope.network)) {
      if (token.symbol.toUpperCase() !== 'UMBRA') symbols.add(token.symbol);
      for (const alias of token.aliases ?? []) {
        if (alias.trim().toUpperCase() !== 'UMBRA') symbols.add(alias.trim());
      }
    }
  }

  if (route !== 'umbra') {
    symbols.delete('dUSDC');
    symbols.delete('dUSDT');
  }

  return [...symbols]
    .filter((symbol) => symbol.length > 0)
    .sort((left, right) => {
      return right.length - left.length || left.localeCompare(right);
    });
}

function buildTokenRegex(
  context: AgenticToolRunnerContext,
  route: AgenticTransferRoute,
): RegExp | null {
  const alternation = buildRecoverableTokenAlternation(context, route);
  if (alternation == null) return null;
  return new RegExp(`(?<![A-Za-z0-9])(${alternation})(?![A-Za-z0-9])`, 'i');
}

function buildRecoverableTokenAlternation(
  context: AgenticToolRunnerContext,
  route: AgenticTransferRoute,
): string | null {
  const symbols = buildRecoverableTokenSymbols(context, route);
  if (symbols.length === 0) return null;
  return symbols.map(escapeRegExp).join('|');
}

function inferTokenFromRecentUserText(
  context: AgenticToolRunnerContext,
  route: AgenticTransferRoute,
): string | null {
  if (!canRecoverDraftFields(context.userText)) return null;
  const tokenRegex = buildTokenRegex(context, route);
  if (tokenRegex == null) return null;

  const turns = context.userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0)
    .reverse();

  for (const turn of turns) {
    const match = tokenRegex.exec(turn);
    if (match?.[1] != null) return match[1];
  }

  return null;
}

function inferAmountFromRecentUserText(params: {
  context: AgenticToolRunnerContext;
  route: AgenticTransferRoute;
}): string | null {
  if (!canRecoverDraftFields(params.context.userText)) return null;
  const tokenAlternation = buildRecoverableTokenAlternation(params.context, params.route);
  if (tokenAlternation == null) return null;
  const amountTokenRegex = new RegExp(
    `(?<![A-Za-z0-9.])(\\d+(?:\\.\\d+)?)\\s*(?:${tokenAlternation})(?![A-Za-z0-9])`,
    'i',
  );

  const turns = params.context.userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0)
    .reverse();

  for (const turn of turns) {
    const match = amountTokenRegex.exec(turn);
    if (match?.[1] != null) return match[1];
  }

  return null;
}

function readPaymentRoute(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
  defaultRoute: AgenticTransferRoute,
): AgenticTransferRoute {
  const raw = stringField(call.args?.route).toLowerCase();
  if (raw === 'normal' || raw === 'magicblock' || raw === 'umbra') return raw;

  const inferred = inferRouteFromRecentUserText(context.userText);
  if (inferred != null) return inferred;

  return readTransferRouteArg(call, defaultRoute);
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
  if (!walletHasLocalSigningMaterial(context.walletImportMethod)) {
    return { ok: false, code: 'wallet_cannot_sign' };
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
  tokenMint?: string | null;
}): { ok: true } | { ok: false; code: string } {
  try {
    resolveUmbraSupportedToken({
      network: params.network,
      token: params.token,
      tokenMint: params.tokenMint,
      requireMixer: true,
    });
    return { ok: true };
  } catch {
    return { ok: false, code: 'token_not_supported_for_umbra' };
  }
}

function resolveUmbraTokenArg(params: {
  network: OffpayNetwork | null;
  token: string;
}): { ok: true; token: string } | { ok: false; code: string } {
  const normalizedToken = params.token.trim();
  if (normalizedToken.length === 0) return { ok: true, token: params.token };
  if (params.network == null) return { ok: false, code: 'network_not_selected' };

  try {
    const token = resolveUmbraSupportedToken({
      network: params.network,
      token: normalizedToken,
      tokenMint: isValidSolanaAddress(normalizedToken) ? normalizedToken : null,
      requireMixer: true,
    });
    return { ok: true, token: token.mint };
  } catch {
    return { ok: false, code: 'token_not_supported_for_umbra' };
  }
}

export async function buildPaymentDraft(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
  options: PaymentDraftToolOptions,
): Promise<ToolHandlerOutcome> {
  const route = readPaymentRoute(call, context, options.defaultRoute);
  const args = call.args ?? {};
  const rawRecipient = stringField(args.recipient);
  const recipientResolution = await resolveRecipientForDraft({ rawRecipient, context });
  if (!recipientResolution.ok) return { error: { code: recipientResolution.code } };

  if (route === 'umbra') {
    const routeReady = isUmbraRouteReady(context);
    if (!routeReady.ok) return { error: { code: routeReady.code } };
  }

  const amount =
    hydrateStringArg(call, 'amount', context.redactions) ||
    inferAmountFromRecentUserText({ context, route }) ||
    '';
  const token =
    hydrateStringArg(call, 'token', context.redactions) ||
    inferTokenFromRecentUserText(context, route) ||
    '';
  const validationToken =
    route === 'umbra'
      ? resolveUmbraTokenArg({ network: context.scope.network, token })
      : ({ ok: true, token } as const);
  if (!validationToken.ok) return { error: { code: validationToken.code } };

  const validationInput = {
    input: {
      recipient: recipientResolution.recipient,
      amount,
      token: validationToken.token,
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
    const tokenReady = ensureUmbraTokenSupported({
      network: validation.draft.network,
      token: validation.draft.tokenSymbol,
      tokenMint: validation.draft.tokenMint,
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
    description: `Prepares a private-route transfer for explicit user confirmation. Supports MagicBlock private send or Umbra private P2P. For Umbra, use only current-network Umbra tokens (${getUmbraSupportedTokens(
      'mainnet',
    )
      .map((token) => token.symbol)
      .join(', ')} on mainnet; ${getUmbraSupportedTokens('devnet')
      .map((token) => token.symbol)
      .join(', ')} on devnet, with aliases USDC/USDT).`,
    parameters: {
      type: 'object',
      properties: transferProperties,
      required: ['amount', 'token', 'recipient'],
    },
  },
  run: (call, context) => buildPaymentDraft(call, context, { defaultRoute: 'magicblock' }),
};
