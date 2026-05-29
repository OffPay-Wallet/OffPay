import type { AgentMessage } from '@/lib/agentic-payments/types';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export type AgenticRedactionType =
  | 'address'
  | 'evm_address'
  | 'tx'
  | 'sns'
  | 'email'
  | 'ip'
  | 'phone'
  | 'payment_card'
  | 'precise_amount';

export interface AgenticPrivacyRedaction {
  type: AgenticRedactionType;
  placeholder: string;
  value: string;
}

export interface AgenticPrivacyFirewallResult {
  sanitizedText: string;
  redactions: AgenticPrivacyRedaction[];
  blocked: boolean;
  blockReason?: string;
}

const SOLANA_BASE58_PATTERN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/g;
const SNS_PATTERN = /\b[a-z0-9][a-z0-9_-]{1,62}\.sol\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IP_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const EVM_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/g;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const PRECISE_AMOUNT_PATTERN = /\b\d+\.\d{7,}\b/g;
const BEARER_OR_API_KEY_PATTERN =
  /\b(?:bearer\s+[a-z0-9._~+/-]{20,}|(?:sk|rk|pk|AIza|cfut|gh[pousr]|xox[baprs])[_-][a-z0-9_-]{20,})\b/i;
const SECRET_URL_PATTERN = /\bhttps?:\/\/\S*[?&](?:token|secret|key|api_key|apikey|access_token)=([^&\s]{12,})/i;
const PRIVATE_KEY_HINT_PATTERN =
  /\b(?:private\s*key|secret\s*key|seed\s*phrase|mnemonic|recovery\s*phrase)\b/i;
const LONG_SECRET_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{64,128}\b/;
const HEX_PRIVATE_KEY_PATTERN = /\b(?:0x)?[a-f0-9]{64}\b/i;
const BIP39_WORDS = new Set<string>(wordlist);

export function runAgenticPrivacyFirewall(text: string): AgenticPrivacyFirewallResult {
  const trimmed = text.trim();
  const blockReason = getHardBlockReason(trimmed);
  if (blockReason != null) {
    const sanitizedText = trimmed.replace(/\S/g, '*');
    return {
      sanitizedText: sanitizedText.length > 0 ? '[SENSITIVE_CONTENT_BLOCKED]' : '',
      redactions: [],
      blocked: true,
      blockReason,
    };
  }

  const redactions: AgenticPrivacyRedaction[] = [];
  let sanitizedText = trimmed;

  sanitizedText = redactMatches(sanitizedText, EMAIL_PATTERN, 'email', redactions);
  sanitizedText = redactMatches(sanitizedText, IP_PATTERN, 'ip', redactions);
  sanitizedText = redactMatches(sanitizedText, PRECISE_AMOUNT_PATTERN, 'precise_amount', redactions);
  sanitizedText = redactMatches(sanitizedText, EVM_ADDRESS_PATTERN, 'evm_address', redactions);
  sanitizedText = redactMatches(sanitizedText, PAYMENT_CARD_PATTERN, 'payment_card', redactions);
  sanitizedText = redactMatches(sanitizedText, PHONE_PATTERN, 'phone', redactions);
  sanitizedText = redactMatches(sanitizedText, SNS_PATTERN, 'sns', redactions);
  sanitizedText = redactMatches(sanitizedText, SOLANA_BASE58_PATTERN, 'address', redactions);

  return {
    sanitizedText,
    redactions,
    blocked: false,
  };
}

export function sanitizeAgentMessagesForAi(
  messages: readonly AgentMessage[],
): {
  messages: AgentMessage[];
  redactions: AgenticPrivacyRedaction[];
  blocked: boolean;
  blockReason?: string;
} {
  const redactions: AgenticPrivacyRedaction[] = [];
  const sanitizedMessages: AgentMessage[] = [];

  for (const message of messages) {
    const result = runAgenticPrivacyFirewall(message.content);
    if (result.blocked) {
      return {
        messages: sanitizedMessages,
        redactions,
        blocked: true,
        blockReason: result.blockReason,
      };
    }
    let content = result.sanitizedText;
    for (const redaction of result.redactions) {
      const placeholder = `[${placeholderPrefix(redaction.type)}_${redactions.length + 1}]`;
      content = content.split(redaction.placeholder).join(placeholder);
      redactions.push({ ...redaction, placeholder });
    }
    sanitizedMessages.push({
      ...message,
      content,
    });
  }

  return {
    messages: sanitizedMessages,
    redactions,
    blocked: false,
  };
}

export function hydrateAgenticRedaction(
  value: string | null | undefined,
  redactions: readonly AgenticPrivacyRedaction[],
): string {
  if (value == null) return '';

  let hydrated = value;
  for (const redaction of redactions) {
    hydrated = hydrated.split(redaction.placeholder).join(redaction.value);
  }
  return hydrated.trim();
}

function getHardBlockReason(text: string): string | undefined {
  if (BEARER_OR_API_KEY_PATTERN.test(text)) {
    return 'That looks like an API key or bearer token. OffPay never needs it.';
  }

  if (SECRET_URL_PATTERN.test(text)) {
    return 'That link contains token-like secret material. OffPay never needs it.';
  }

  if (
    PRIVATE_KEY_HINT_PATTERN.test(text) &&
    (LONG_SECRET_PATTERN.test(text) || HEX_PRIVATE_KEY_PATTERN.test(text))
  ) {
    return 'That looks like private wallet material. OffPay never needs it.';
  }

  if (
    (PRIVATE_KEY_HINT_PATTERN.test(text) && countLikelyMnemonicWords(text) >= 12) ||
    containsBareBip39Mnemonic(text)
  ) {
    return 'That looks like a seed phrase. OffPay never needs it.';
  }

  return undefined;
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

function countLikelyMnemonicWords(text: string): number {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && word.length <= 10).length;
}

function redactMatches(
  text: string,
  pattern: RegExp,
  type: AgenticRedactionType,
  redactions: AgenticPrivacyRedaction[],
): string {
  const seen = new Map<string, string>();
  return text.replace(pattern, (value: string) => {
    const existing = seen.get(value);
    if (existing != null) return existing;

    const placeholder = `[${placeholderPrefix(type)}_${redactions.length + 1}]`;
    seen.set(value, placeholder);
    redactions.push({ type, placeholder, value });
    return placeholder;
  });
}

function placeholderPrefix(type: AgenticRedactionType): string {
  if (type === 'precise_amount') return 'AMOUNT';
  return type.toUpperCase();
}
