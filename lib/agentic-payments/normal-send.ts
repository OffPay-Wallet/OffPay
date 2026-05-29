import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';
import {
  getRequestedNetwork,
  normalizeAgenticPrivateSendInput,
  resolveAgenticPrivateSendRecipient,
  type AgenticKnownWallet,
} from '@/lib/agentic-payments/private-send-intent';
import { resolveAgenticBalanceToken } from '@/lib/agentic-payments/token-resolution';

import type { AgenticPrivateSendAction } from '@/store/agenticChatStore';
import type {
  CapabilitiesResponse,
  OffpayNetwork,
  WalletBalanceResponse,
} from '@/types/offpay-api';

interface ValidateAgenticNormalSendParams {
  input: unknown;
  userText?: string;
  knownWallets?: AgenticKnownWallet[];
  walletAddress: string | null;
  network: OffpayNetwork | null;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  allowSelfRecipient?: boolean;
}

export type AgenticNormalSendValidation =
  | {
      ok: true;
      draft: Omit<
        AgenticPrivateSendAction,
        'id' | 'kind' | 'status' | 'route' | 'createdAt' | 'updatedAt'
      >;
      selfRecipientRequested: boolean;
    }
  | {
      ok: false;
      message: string;
    };

function isPositiveRawAmount(value: string | null): value is string {
  if (value == null || !/^\d+$/.test(value)) return false;
  return BigInt(value) > 0n;
}

function isAmountWithinBalance(amountRaw: string, balanceRaw: string | null): boolean {
  if (balanceRaw == null || !/^\d+$/.test(balanceRaw)) return false;
  return BigInt(amountRaw) <= BigInt(balanceRaw);
}

export function validateAgenticNormalSendDraft(
  params: ValidateAgenticNormalSendParams,
): AgenticNormalSendValidation {
  if (params.walletAddress == null) {
    return { ok: false, message: 'Connect a wallet before using Yuga normal send.' };
  }

  if (params.network == null) {
    return { ok: false, message: 'Select a supported network before sending.' };
  }

  const network = params.network;
  const requestedNetwork = getRequestedNetwork(params.userText);
  if (requestedNetwork != null && requestedNetwork !== network) {
    return {
      ok: false,
      message: `This request mentions ${requestedNetwork}, but the app is on ${network}. Switch networks before confirming.`,
    };
  }

  if (params.walletMode !== 'online' || !params.canUseNetwork) {
    return { ok: false, message: 'Yuga normal send needs online wallet mode.' };
  }

  if (params.capabilities == null) {
    return { ok: false, message: 'Wallet capability checks are still loading.' };
  }

  if (!isOffpayFeatureAvailable(params.capabilities, 'wallet.balance')) {
    return { ok: false, message: 'Wallet balance is not available on the current network.' };
  }

  if (params.balance == null) {
    return { ok: false, message: 'Wallet balance is still loading. Try again in a moment.' };
  }

  const input = normalizeAgenticPrivateSendInput(params.input);
  const recipientResolution = resolveAgenticPrivateSendRecipient({
    aiRecipient: input.recipient,
    userText: params.userText,
    walletAddress: params.walletAddress,
    knownWallets: params.knownWallets,
  });
  const recipient = recipientResolution.recipient;
  const amountText = input.amount;
  const tokenText = input.token;

  if (!isValidSolanaAddress(recipient)) {
    return { ok: false, message: 'Enter a full Solana wallet address for the recipient.' };
  }

  if (
    recipient === params.walletAddress &&
    !recipientResolution.selfRecipientRequested &&
    params.allowSelfRecipient !== true
  ) {
    return {
      ok: false,
      message:
        'Tell me the recipient wallet address, or say that you want to send to your own wallet.',
    };
  }

  if (amountText.length === 0) {
    return { ok: false, message: 'Tell me the amount to send.' };
  }

  if (tokenText.length === 0) {
    return { ok: false, message: 'Tell me which token to send.' };
  }

  const tokenResolution = resolveAgenticBalanceToken({
    balance: params.balance,
    network,
    tokenText,
  });
  if (!tokenResolution.ok) {
    return { ok: false, message: tokenResolution.message };
  }
  const token = tokenResolution.token;

  const amount = sanitizeDecimalInput(amountText, token.decimals);
  const rawAmount = decimalInputToAtomicAmount(amount, token.decimals);
  if (!isPositiveRawAmount(rawAmount)) {
    return { ok: false, message: 'Enter an amount greater than zero.' };
  }

  const balanceRaw = decimalInputToAtomicAmount(token.balance, token.decimals);
  if (!isAmountWithinBalance(rawAmount, balanceRaw)) {
    return { ok: false, message: `Insufficient ${token.symbol} balance for this normal send.` };
  }

  return {
    ok: true,
    selfRecipientRequested: recipientResolution.selfRecipientRequested,
    draft: {
      walletAddress: params.walletAddress,
      network,
      recipient,
      amount,
      rawAmount,
      tokenMint: token.mint,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      tokenLogo: token.logo,
      tokenDecimals: token.decimals,
      selfRecipientRequested: recipientResolution.selfRecipientRequested,
      signature: null,
      txId: null,
      errorMessage: null,
    },
  };
}
