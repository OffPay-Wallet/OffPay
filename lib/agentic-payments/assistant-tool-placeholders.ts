import type { AgentToolResult } from './types';

type PlaceholderKind = 'AMOUNT' | 'PHONE' | 'PAYMENT_CARD';

interface ToolNumericCandidate {
  value: string;
  key: string;
  symbol?: string;
  sourceIndex: number;
}

const TOOL_NUMERIC_VALUE_KEY_PATTERN =
  /^(?:amount|displayBalance|rawAmount|fee|feeLamports)$/i;
const GENERIC_TOOL_PLACEHOLDER_PATTERN = /\[(AMOUNT|PHONE|PAYMENT_CARD)\]/g;
const PRECISE_AMOUNT_VALUE_PATTERN = /^\d+\.\d{7,}$/;
const LONG_NUMERIC_VALUE_PATTERN = /^\+?\d[\d\s().-]{7,}\d$/;
const TOOL_NUMERIC_CONTEXT_PATTERN =
  /\b(?:amount|balance|vault|private|public|activity|sent|received|fee|token)\b/i;
const MAX_COLLECT_DEPTH = 6;
const MAX_TOOL_NUMERIC_CANDIDATES = 80;

/**
 * Some deployed provider sanitizers can still echo generic placeholders from
 * freshly fetched tool results. Before rendering, replace only numeric
 * placeholders with safe numeric fields returned by the just-run local tools.
 */
export function hydrateAssistantToolResultPlaceholders(
  text: string,
  toolResults: readonly AgentToolResult[],
): string {
  if (!GENERIC_TOOL_PLACEHOLDER_PATTERN.test(text)) return text;
  GENERIC_TOOL_PLACEHOLDER_PATTERN.lastIndex = 0;

  const candidates = collectToolNumericCandidates(toolResults);
  if (candidates.length === 0) return text;

  const used = new Set<number>();
  const preciseCandidates = candidates.filter((candidate) =>
    PRECISE_AMOUNT_VALUE_PATTERN.test(candidate.value),
  );
  const longNumericCandidates = candidates.filter((candidate) =>
    LONG_NUMERIC_VALUE_PATTERN.test(candidate.value),
  );

  return text.replace(
    GENERIC_TOOL_PLACEHOLDER_PATTERN,
    (placeholder: string, rawKind: string, offset: number, source: string) => {
      const kind = rawKind as PlaceholderKind;
      const context = source.slice(Math.max(0, offset - 64), offset + 96).toLowerCase();
      const pools =
        kind === 'AMOUNT'
          ? [preciseCandidates, candidates]
          : [longNumericCandidates, preciseCandidates, candidates];
      const replacement = takeContextualCandidate(pools, used, context, kind !== 'AMOUNT');
      return replacement?.value ?? placeholder;
    },
  );
}

function collectToolNumericCandidates(
  toolResults: readonly AgentToolResult[],
): ToolNumericCandidate[] {
  const candidates: ToolNumericCandidate[] = [];
  for (const result of toolResults) {
    collectNumericCandidatesFromValue(result.result, candidates, 0, undefined, undefined);
    if (candidates.length >= MAX_TOOL_NUMERIC_CANDIDATES) break;
  }
  return candidates;
}

function collectNumericCandidatesFromValue(
  value: unknown,
  candidates: ToolNumericCandidate[],
  depth: number,
  key: string | undefined,
  symbol: string | undefined,
): void {
  if (candidates.length >= MAX_TOOL_NUMERIC_CANDIDATES || depth > MAX_COLLECT_DEPTH) return;

  if (typeof value === 'string' || typeof value === 'number') {
    if (key != null && TOOL_NUMERIC_VALUE_KEY_PATTERN.test(key)) {
      const candidateValue = String(value).trim();
      if (isUsableNumericCandidate(candidateValue)) {
        candidates.push({
          value: candidateValue,
          key,
          symbol,
          sourceIndex: candidates.length,
        });
      }
    }
    return;
  }

  if (value == null || typeof value === 'boolean') return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNumericCandidatesFromValue(entry, candidates, depth + 1, key, symbol);
      if (candidates.length >= MAX_TOOL_NUMERIC_CANDIDATES) return;
    }
    return;
  }

  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const localSymbol = readSymbol(record) ?? symbol;
  for (const [entryKey, entryValue] of Object.entries(record)) {
    collectNumericCandidatesFromValue(
      entryValue,
      candidates,
      depth + 1,
      entryKey,
      localSymbol,
    );
    if (candidates.length >= MAX_TOOL_NUMERIC_CANDIDATES) return;
  }
}

function readSymbol(record: Record<string, unknown>): string | undefined {
  const raw = record.tokenSymbol ?? record.symbol;
  if (typeof raw !== 'string') return undefined;
  const symbol = raw.trim();
  return symbol.length > 0 ? symbol : undefined;
}

function isUsableNumericCandidate(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 80 &&
    /\d/.test(value) &&
    !value.includes('[') &&
    !value.includes(']')
  );
}

function takeContextualCandidate(
  pools: readonly ToolNumericCandidate[][],
  used: Set<number>,
  context: string,
  requireToolNumericContext: boolean,
): ToolNumericCandidate | undefined {
  for (const pool of pools) {
    const symbolMatch = pool.find(
      (candidate) =>
        !used.has(candidate.sourceIndex) &&
        candidate.symbol != null &&
        context.includes(candidate.symbol.toLowerCase()),
    );
    if (symbolMatch != null) {
      used.add(symbolMatch.sourceIndex);
      return symbolMatch;
    }

    if (requireToolNumericContext && !TOOL_NUMERIC_CONTEXT_PATTERN.test(context)) {
      return undefined;
    }

    const next = pool.find((candidate) => !used.has(candidate.sourceIndex));
    if (next != null) {
      used.add(next.sourceIndex);
      return next;
    }
  }

  return undefined;
}
