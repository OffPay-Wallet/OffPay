import type { PayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';
import { getStablecoinPolicyEntries } from '@/lib/policy/stablecoin-policy';
import { getUmbraSupportedTokens } from '@/lib/umbra/umbra-supported-tokens';

export type PayrollColumnRole = 'recipient' | 'amount' | 'token' | 'label';

export interface PayrollColumnMapping {
  recipient: string | null;
  amount: string | null;
  token: string | null;
  label: string | null;
}

export interface PayrollColumnInference {
  mapping: PayrollColumnMapping;
  /** 0..1 confidence that recipient + amount were located. */
  confidence: number;
  /** True when the caller should open manual mapping. */
  needsManualMapping: boolean;
}

const HEADER_HINTS: Record<PayrollColumnRole, string[]> = {
  recipient: [
    'recipient',
    'wallet',
    'address',
    'pubkey',
    'public_key',
    'account',
    'to',
    'destination',
    'payee',
  ],
  amount: ['amount', 'value', 'qty', 'quantity', 'pay', 'salary', 'total', 'sum'],
  token: ['token', 'mint', 'currency', 'asset', 'symbol', 'coin'],
  label: ['name', 'employee', 'label', 'id', 'employee_id', 'note', 'memo', 'description'],
};

const MAX_VALUE_SCAN_ROWS = 50;
const KNOWN_PAYROLL_TOKEN_MINTS = new Set([
  ...getStablecoinPolicyEntries('mainnet').map((token) => token.mint),
  ...getStablecoinPolicyEntries('devnet').map((token) => token.mint),
  ...getUmbraSupportedTokens('mainnet').map((token) => token.mint),
  ...getUmbraSupportedTokens('devnet').map((token) => token.mint),
]);

function scoreHeader(header: string, role: PayrollColumnRole): number {
  const hints = HEADER_HINTS[role];
  for (const hint of hints) {
    if (header === hint) return 2;
    if (header.includes(hint)) return 1;
  }
  return 0;
}

function looksLikeAmount(value: string): boolean {
  const normalized = sanitizeDecimalInput(value, 18);
  const atomic = decimalInputToAtomicAmount(normalized, 18);
  return atomic != null && /^\d+$/.test(atomic) && BigInt(atomic) > 0n;
}

function looksLikeToken(value: string): boolean {
  const normalized = value.trim();
  return /^(d?usdc|d?usdt)$/i.test(normalized) || KNOWN_PAYROLL_TOKEN_MINTS.has(normalized);
}

function looksLikeRecipient(value: string): boolean {
  const normalized = value.trim();
  return isValidSolanaAddress(normalized) && !looksLikeToken(normalized);
}

function scoreValues(table: PayrollTable, header: string, role: PayrollColumnRole): number {
  const records = table.records.slice(0, MAX_VALUE_SCAN_ROWS);
  if (records.length === 0) return 0;

  let score = 0;
  for (const record of records) {
    const value = (record[header] ?? '').trim();
    if (value.length === 0) continue;

    if (role === 'recipient') {
      if (looksLikeRecipient(value)) score += 3;
    } else if (role === 'amount') {
      if (looksLikeAmount(value) && !isValidSolanaAddress(value)) score += 2;
    } else if (role === 'token') {
      if (looksLikeToken(value)) score += 1;
    } else if (!isValidSolanaAddress(value) && !looksLikeAmount(value)) {
      score += 0.25;
    }
  }

  return score;
}

function scoreColumn(table: PayrollTable, header: string, role: PayrollColumnRole): number {
  return scoreHeader(header, role) * 4 + scoreValues(table, header, role);
}

/**
 * Infers column roles from headers plus local value heuristics. Deterministic
 * and local — never sends payroll rows anywhere.
 */
export function inferPayrollColumns(table: PayrollTable): PayrollColumnInference {
  const mapping: PayrollColumnMapping = {
    recipient: null,
    amount: null,
    token: null,
    label: null,
  };

  const taken = new Set<string>();
  const roles: PayrollColumnRole[] = ['recipient', 'amount', 'token', 'label'];

  for (const role of roles) {
    let bestHeader: string | null = null;
    let bestScore = 0;
    for (const header of table.headers) {
      if (taken.has(header)) continue;
      const score = scoreColumn(table, header, role);
      if (score > bestScore) {
        bestScore = score;
        bestHeader = header;
      }
    }
    if (bestHeader != null && bestScore > 0) {
      mapping[role] = bestHeader;
      taken.add(bestHeader);
    }
  }

  const located = (mapping.recipient != null ? 1 : 0) + (mapping.amount != null ? 1 : 0);
  const confidence = located / 2;
  const needsManualMapping = mapping.recipient == null || mapping.amount == null;

  return { mapping, confidence, needsManualMapping };
}
