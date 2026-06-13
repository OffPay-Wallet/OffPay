import { ProviderError } from '../http';
import type { AgentChatRequest, AgentMessage } from '../types';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const SOLANA_BASE58_PATTERN =
  /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/g;
const SOLANA_BASE58_TEST_PATTERN =
  /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/;
const SNS_PATTERN = /\b[a-z0-9][a-z0-9_-]{1,62}\.sol\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IP_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const EVM_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/g;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const PRECISE_AMOUNT_PATTERN = /\b\d+\.\d{7,}\b/g;
const PRECISE_AMOUNT_TEST_PATTERN = /\b\d+\.\d{7,}\b/;
const BEARER_OR_API_KEY_PATTERN =
  /\b(?:bearer\s+[a-z0-9._~+/-]{20,}|(?:sk|rk|pk|AIza|cfut|gh[pousr]|xox[baprs])[_-][a-z0-9_-]{20,})\b/i;
const SECRET_URL_PATTERN =
  /\bhttps?:\/\/\S*[?&](?:token|secret|key|api_key|apikey|access_token)=([^&\s]{12,})/i;
const PRIVATE_KEY_HINT_PATTERN =
  /\b(?:private\s*key|secret\s*key|seed\s*phrase|mnemonic|recovery\s*phrase)\b/i;
const LONG_SECRET_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{64,128}\b/;
const HEX_PRIVATE_KEY_PATTERN = /\b(?:0x)?[a-f0-9]{64}\b/i;
const FORBIDDEN_CONTEXT_KEY_PATTERN =
  /\b(walletAddress|walletBalanceApiResponse|tokenMints|tokenMint|contractAddress|privateKey|seedPhrase|mnemonic|txHash|signature)\b/i;
const BIP39_WORDS = new Set<string>(wordlist);
const MAX_SAFE_CONTEXT_TOKEN_SYMBOLS = 24;
const MAX_SAFE_CONTEXT_ACTIONS = 40;

export function sanitizeChatRequestForProvider(body: AgentChatRequest): AgentChatRequest {
  if (containsForbiddenContextKey(body.context)) {
    throw new ProviderError('proxy', 400, 'Request context contains disallowed wallet data.');
  }

  return {
    ...body,
    messages: sanitizeMessages(body.messages),
    context: sanitizeIntentContext(body.context),
  };
}

export function sanitizeTextForProvider(text: string): string {
  assertNoHardBlockedSecret(text);

  return text
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(IP_PATTERN, '[IP]')
    .replace(PRECISE_AMOUNT_PATTERN, '[AMOUNT]')
    .replace(EVM_ADDRESS_PATTERN, '[ADDRESS]')
    .replace(PAYMENT_CARD_PATTERN, '[PAYMENT_CARD]')
    .replace(PHONE_PATTERN, '[PHONE]')
    .replace(SNS_PATTERN, '[SNS]')
    .replace(SOLANA_BASE58_PATTERN, '[ADDRESS]');
}

export function assertSafeVoiceText(text: string): void {
  assertNoHardBlockedSecret(text);
  if (SOLANA_BASE58_TEST_PATTERN.test(text) || PRECISE_AMOUNT_TEST_PATTERN.test(text)) {
    throw new ProviderError('proxy', 400, 'Voice speech text contains sensitive wallet data.');
  }
}

function sanitizeMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: sanitizeTextForProvider(message.content).slice(0, 4000),
  }));
}

function assertNoHardBlockedSecret(text: string): void {
  if (BEARER_OR_API_KEY_PATTERN.test(text)) {
    throw new ProviderError('proxy', 400, 'Request contains sensitive key material.');
  }

  if (SECRET_URL_PATTERN.test(text)) {
    throw new ProviderError('proxy', 400, 'Request contains sensitive key material.');
  }

  if (
    PRIVATE_KEY_HINT_PATTERN.test(text) &&
    (LONG_SECRET_PATTERN.test(text) || HEX_PRIVATE_KEY_PATTERN.test(text))
  ) {
    throw new ProviderError('proxy', 400, 'Request contains sensitive wallet material.');
  }

  if (
    (PRIVATE_KEY_HINT_PATTERN.test(text) && countLikelyMnemonicWords(text) >= 12) ||
    containsBareBip39Mnemonic(text)
  ) {
    throw new ProviderError('proxy', 400, 'Request contains sensitive wallet material.');
  }
}

function countLikelyMnemonicWords(text: string): number {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && word.length <= 10).length;
}

function containsBareBip39Mnemonic(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const lengths = [24, 21, 18, 15, 12];

  for (const length of lengths) {
    if (words.length < length) continue;
    for (let index = 0; index <= words.length - length; index += 1) {
      const phrase = words.slice(index, index + length);
      if (phrase.every((word) => BIP39_WORDS.has(word))) {
        return true;
      }
    }
  }

  return false;
}

function containsForbiddenContextKey(value: unknown): boolean {
  if (value == null) return false;
  const serialized = JSON.stringify(value);
  return serialized != null && FORBIDDEN_CONTEXT_KEY_PATTERN.test(serialized);
}

function sanitizeIntentContext(value: AgentChatRequest['context']): AgentChatRequest['context'] {
  if (value == null) return undefined;
  return {
    privacyMode: 'strict',
    network: value.network,
    walletMode: value.walletMode,
    locale: value.locale,
    capabilities: value.capabilities,
    tokenSymbols: Array.isArray(value.tokenSymbols)
      ? value.tokenSymbols
          .filter((entry) => typeof entry === 'string')
          .slice(0, MAX_SAFE_CONTEXT_TOKEN_SYMBOLS)
      : undefined,
    supportedActions: Array.isArray(value.supportedActions)
      ? value.supportedActions
          .filter((entry) => typeof entry === 'string')
          .slice(0, MAX_SAFE_CONTEXT_ACTIONS)
      : undefined,
  };
}
