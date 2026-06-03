import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { parseRecipientInput } from '@/lib/identity/recipient-parser';
import { resolveSnsName } from '@/lib/identity/sns';
import { resolveXHandle, XHandleNotRegisteredError } from '@/lib/identity/x-handle';
import {
  isSelfRecipientIntent,
  resolveAgenticPrivateSendRecipient,
} from '@/lib/agentic-payments/private-send-intent';

import {
  hydrateStringArg,
  isNetworkReady,
  isSelfRecipientArg,
  normalizeRecipientArg,
  readStringArg,
} from './helpers';
import type { AgenticToolDefinition, AgenticToolRunnerContext } from './types';

export type ToolRecipientSource = 'address' | 'known_wallet' | 'self' | 'sns' | 'x' | 'user_text';

export type ToolRecipientResolution =
  | {
      ok: true;
      recipient: string;
      allowSelfRecipient: boolean;
      source: ToolRecipientSource;
    }
  | { ok: false; code: string };

function resolveKnownWalletAddress(
  value: string,
  context: AgenticToolRunnerContext,
): { address: string; source: ToolRecipientSource } | null {
  if (context.scope.walletAddress == null) return null;
  const resolved = resolveAgenticPrivateSendRecipient({
    aiRecipient: value,
    userText: context.userText,
    walletAddress: context.scope.walletAddress,
    knownWallets: [...context.knownWallets],
  });
  if (!isValidSolanaAddress(resolved.recipient)) return null;
  if (resolved.recipient === value && isValidSolanaAddress(value)) {
    return { address: resolved.recipient, source: 'address' };
  }
  if (resolved.recipient === context.scope.walletAddress && resolved.selfRecipientRequested) {
    return { address: resolved.recipient, source: 'self' };
  }
  const matchedWallet = context.knownWallets.find(
    (wallet) => wallet.address === resolved.recipient,
  );
  return {
    address: resolved.recipient,
    source: matchedWallet == null ? 'user_text' : 'known_wallet',
  };
}

export async function resolveRecipientForDraft(params: {
  rawRecipient: string;
  context: AgenticToolRunnerContext;
}): Promise<ToolRecipientResolution> {
  const walletAddress = params.context.scope.walletAddress;
  const raw = params.rawRecipient.trim();
  const normalized = normalizeRecipientArg(raw, params.context.redactions);

  if (isSelfRecipientArg(raw)) {
    if (walletAddress == null) return { ok: false, code: 'wallet_not_connected' };
    return {
      ok: true,
      recipient: walletAddress,
      allowSelfRecipient: true,
      source: 'self',
    };
  }

  if (normalized.length === 0) {
    if (walletAddress != null && isSelfRecipientIntent(params.context.userText)) {
      return {
        ok: true,
        recipient: walletAddress,
        allowSelfRecipient: true,
        source: 'self',
      };
    }
    return { ok: true, recipient: '', allowSelfRecipient: false, source: 'user_text' };
  }

  const known = resolveKnownWalletAddress(normalized, params.context);
  if (known != null) {
    return {
      ok: true,
      recipient: known.address,
      allowSelfRecipient: known.address === walletAddress,
      source: known.source,
    };
  }

  const candidate = parseRecipientInput(normalized);
  if (candidate.kind === 'address') {
    return {
      ok: true,
      recipient: candidate.address,
      allowSelfRecipient: candidate.address === walletAddress,
      source: 'address',
    };
  }
  if (candidate.kind === 'ambiguous') return { ok: false, code: 'recipient_ambiguous' };
  if (candidate.kind === 'invalid') {
    return {
      ok: true,
      recipient: normalized,
      allowSelfRecipient: false,
      source: 'user_text',
    };
  }
  if (!isNetworkReady(params.context)) return { ok: false, code: 'requires_online_mode' };

  try {
    if (candidate.kind === 'sns') {
      const address = await resolveSnsName(candidate.domain);
      return {
        ok: true,
        recipient: address,
        allowSelfRecipient: address === walletAddress,
        source: 'sns',
      };
    }

    const resolved = await resolveXHandle(candidate.handle);
    return {
      ok: true,
      recipient: resolved.address,
      allowSelfRecipient: resolved.address === walletAddress,
      source: 'x',
    };
  } catch (error) {
    if (error instanceof XHandleNotRegisteredError) return { ok: false, code: 'x_not_registered' };
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('timed out')) return { ok: false, code: 'recipient_lookup_timeout' };
    return { ok: false, code: candidate.kind === 'sns' ? 'sns_lookup_failed' : 'x_lookup_failed' };
  }
}

export const resolveRecipientTool: AgenticToolDefinition = {
  name: 'resolve_recipient',
  schema: {
    name: 'resolve_recipient',
    description:
      'Resolves a recipient reference locally: full Solana address, self, saved wallet name, SNS .sol name, or X handle. Result never includes the resolved address.',
    parameters: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'Address, [ADDRESS_1], saved wallet name, .sol name, @handle, or self.',
        },
      },
      required: ['recipient'],
    },
  },
  run: async (call, context) => {
    const raw =
      (hydrateStringArg(call, 'recipient', context.redactions) || readStringArg(call, 'query')) ??
      '';
    if (raw.trim().length === 0) return { error: { code: 'recipient_missing' } };

    const resolution = await resolveRecipientForDraft({ rawRecipient: raw, context });
    if (!resolution.ok) return { error: { code: resolution.code } };
    if (!isValidSolanaAddress(resolution.recipient))
      return { error: { code: 'recipient_invalid' } };

    return {
      result: {
        status: 'resolved',
        source: resolution.source,
        selfRecipient: resolution.recipient === context.scope.walletAddress,
        addressAvailableLocally: true,
      },
    };
  },
};
