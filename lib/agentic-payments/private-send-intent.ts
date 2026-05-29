import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type { OffpayNetwork } from '@/types/offpay-api';

export interface AgenticPrivateSendToolInput {
  recipient?: unknown;
  amount?: unknown;
  token?: unknown;
  tokenSymbol?: unknown;
  tokenMint?: unknown;
}

export interface AgenticKnownWallet {
  name: string;
  address: string;
  active?: boolean;
}

export interface NormalizedPrivateSendToolInput {
  recipient: string;
  amount: string;
  token: string;
}

export interface AgenticRecipientResolution {
  recipient: string;
  selfRecipientRequested: boolean;
}

export function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAgenticPrivateSendInput(input: unknown): NormalizedPrivateSendToolInput {
  const fields = (typeof input === 'object' && input !== null
    ? input
    : {}) as AgenticPrivateSendToolInput;

  return {
    recipient: textField(fields.recipient),
    amount: textField(fields.amount),
    token: getRequestedToken(fields),
  };
}

export function getRequestedNetwork(text: string | null | undefined): OffpayNetwork | null {
  // Only explicit network words count as a network hint. Token aliases like
  // `dusdc` / `dusdt` are stablecoin symbols, not network selectors — treating
  // them as such caused false-positive "request mentions devnet" errors when
  // mainnet users typed `dusdc`.
  const normalized = text?.toLowerCase() ?? '';
  const mentionsDevnet = /(^|[^a-z])(devnet|testnet)(?=$|[^a-z])/.test(normalized);
  const mentionsMainnet = /(^|[^a-z])(mainnet|mainnet-beta|mainnet beta)(?=$|[^a-z])/.test(
    normalized,
  );

  if (mentionsDevnet === mentionsMainnet) return null;
  return mentionsDevnet ? 'devnet' : 'mainnet';
}

export function normalizeStablecoinRequest(value: string): 'USDC' | 'USDT' | null {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized === 'USDC' || normalized === 'DUSDC' || normalized === 'DEVNETUSDC') {
    return 'USDC';
  }
  if (normalized === 'USDT' || normalized === 'DUSDT' || normalized === 'DEVNETUSDT') {
    return 'USDT';
  }
  return null;
}

export function resolveAgenticPrivateSendRecipient(params: {
  aiRecipient: string;
  userText?: string;
  walletAddress: string;
  knownWallets?: AgenticKnownWallet[];
}): AgenticRecipientResolution {
  const selfRecipientRequested = isSelfRecipientIntent(params.userText);
  const userTextRecipient = extractUserTextRecipient(params.userText, params.walletAddress);
  const knownWalletRecipient = !isValidSolanaAddress(params.aiRecipient)
    ? resolveKnownWalletReference(params.aiRecipient, params.knownWallets)
    : null;

  if (userTextRecipient != null && params.aiRecipient === params.walletAddress) {
    return { recipient: userTextRecipient, selfRecipientRequested };
  }

  if (knownWalletRecipient != null) {
    return {
      recipient: knownWalletRecipient.address,
      selfRecipientRequested,
    };
  }

  if (!isValidSolanaAddress(params.aiRecipient)) {
    if (userTextRecipient != null) {
      return { recipient: userTextRecipient, selfRecipientRequested };
    }

    if (selfRecipientRequested) {
      return { recipient: params.walletAddress, selfRecipientRequested: true };
    }
  }

  return { recipient: params.aiRecipient, selfRecipientRequested };
}

function getRequestedToken(input: AgenticPrivateSendToolInput): string {
  return textField(input.token) || textField(input.tokenSymbol) || textField(input.tokenMint);
}

// Adjective slot tolerated between "my" and "wallet" — common natural phrases
// like "to my main wallet" or "to my own primary wallet" should still resolve
// as a self-recipient request. Kept conservative; ordinary nouns ("brother",
// "friend") are not in the list so "to my brother's wallet" is NOT self-send.
const SELF_WALLET_ADJECTIVE = String.raw`(?:own\s+)?(?:main|primary|default|first|second|active|new|old|other|same|saving|savings|trading|hot|cold|personal)?\s*`;
const SELF_WALLET_PHRASE = String.raw`my\s+${SELF_WALLET_ADJECTIVE}wallet|own\s+wallet|same\s+wallet|myself|me`;
// The standalone form drops bare "me" so that incidental phrases like
// "tell me when done" do not get mis-classified as a self-send. The
// remaining patterns are wallet-specific enough to be safe.
const SELF_WALLET_STANDALONE_PHRASE = String.raw`my\s+${SELF_WALLET_ADJECTIVE}wallet|own\s+wallet|same\s+wallet|myself`;

export function isSelfRecipientIntent(text: string | null | undefined): boolean {
  const normalized = text?.toLowerCase() ?? '';
  if (normalized.length === 0) return false;

  const directRecipient = new RegExp(
    String.raw`\b(?:to|into|towards?|back\s+to|send\s+(?:back\s+)?to|pay\s+to|transfer\s+to)\s+(?:${SELF_WALLET_PHRASE})\b`,
  );
  if (directRecipient.test(normalized)) return true;

  // "send 5 dusdc … to my own wallet" with adverbs/objects in between.
  const verbToSelf = new RegExp(
    String.raw`\b(?:send|transfer|pay|move)\b[^.]*?\b(?:to|into|towards?|back\s+to)\b[^.]*?\b(?:${SELF_WALLET_PHRASE})\b`,
  );
  if (verbToSelf.test(normalized)) return true;

  // Bare affirmative replies in a multi-turn flow — for example a user
  // answering the agent's "tell me the recipient" prompt with just
  // "My own wallet", "myself", or "same wallet". The validator only sees
  // the current turn, but the underlying intent is unambiguous.
  const standaloneSelf = new RegExp(
    String.raw`(?:^|[\s.;:!?(])(?:${SELF_WALLET_STANDALONE_PHRASE})(?=[\s.;:!?)]|$)`,
  );
  if (standaloneSelf.test(normalized)) return true;

  return /\bself[-\s]?send\b/.test(normalized);
}

function extractUserTextRecipient(
  text: string | null | undefined,
  walletAddress: string,
): string | null {
  const candidates = Array.from(new Set(text?.match(/[1-9A-HJ-NP-Za-km-z]{32,88}/g) ?? []))
    .filter(isValidSolanaAddress)
    .filter((address) => address !== walletAddress);

  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function resolveKnownWalletReference(
  value: string,
  knownWallets: AgenticKnownWallet[] | undefined,
): AgenticKnownWallet | null {
  const normalized = normalizeReference(value);
  if (normalized.length === 0 || knownWallets == null) return null;

  const matches = knownWallets.filter(
    (wallet) =>
      wallet.address === value ||
      normalizeReference(wallet.name) === normalized ||
      normalizeReference(wallet.address) === normalized,
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function normalizeReference(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
