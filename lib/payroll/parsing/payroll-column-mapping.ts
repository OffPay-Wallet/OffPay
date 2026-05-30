import type { PayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';

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
  recipient: ['recipient', 'wallet', 'address', 'pubkey', 'public_key', 'account', 'to', 'destination', 'payee'],
  amount: ['amount', 'value', 'qty', 'quantity', 'pay', 'salary', 'total', 'sum'],
  token: ['token', 'mint', 'currency', 'asset', 'symbol', 'coin'],
  label: ['name', 'employee', 'label', 'id', 'employee_id', 'note', 'memo', 'description'],
};

function scoreHeader(header: string, role: PayrollColumnRole): number {
  const hints = HEADER_HINTS[role];
  for (const hint of hints) {
    if (header === hint) return 2;
    if (header.includes(hint)) return 1;
  }
  return 0;
}

/**
 * Infers column roles from headers alone. Deterministic and local — never
 * sends data anywhere. The AI-assisted path is a separate, opt-in layer
 * that only refines low-confidence results from redacted samples.
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
      const score = scoreHeader(header, role);
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
