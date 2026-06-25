import type { AgentIntentName, AgentIntentResult, AgentIntentRoute } from '../types';

const TEXT_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;
const ALLOWED_INTENTS = new Set<AgentIntentName>([
  'smalltalk',
  'draft_payment',
  'wallet_query',
  'wallet_advice',
  'clarification',
  'unsupported',
  'intent_parse_error',
]);
const ALLOWED_ROUTES = new Set<AgentIntentRoute>(['normal', 'private', 'magicblock', 'unknown']);

export function sanitizeProviderText(text: string): string {
  return text
    .replace(
      /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/g,
      '[wallet reference]',
    )
    .replace(/\b\d+\.\d{7,}\b/g, '[exact amount]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function parseIntentResult(text: string): AgentIntentResult {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed)) {
    throw new Error('Provider returned invalid intent JSON.');
  }

  const candidate = parsed;
  const intent = normalizeIntent(candidate.intent);

  return {
    kind: 'intent_result',
    intent,
    route: normalizeRoute(candidate.route),
    token: stringField(candidate.token),
    amount: stringField(candidate.amount),
    recipientRef: stringField(candidate.recipientRef),
    clarification: stringField(candidate.clarification),
    message: stringField(candidate.message),
    confidence: numberField(candidate.confidence),
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(TEXT_BLOCK_PATTERN)?.[1]?.trim();
  const source = fenced ?? extractJsonObject(trimmed);

  if (source == null) return null;

  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeIntent(value: unknown): AgentIntentName {
  return typeof value === 'string' && ALLOWED_INTENTS.has(value as AgentIntentName)
    ? (value as AgentIntentName)
    : 'intent_parse_error';
}

function normalizeRoute(value: unknown): AgentIntentRoute | undefined {
  return typeof value === 'string' && ALLOWED_ROUTES.has(value as AgentIntentRoute)
    ? (value as AgentIntentRoute)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? sanitizeProviderText(value)
    : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
