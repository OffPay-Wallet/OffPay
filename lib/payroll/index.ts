/**
 * Private batch payroll — client-only feature. Barrel export for the
 * payroll logic layer. UI and agentic tools import from here.
 *
 * Layering (each file is small and single-purpose):
 *  - payroll-types            row/run status model + double-pay guards
 *  - parsing/                 format detection, lazy table parser, column map
 *  - payroll-validation       chunked row validation/normalization
 *  - payroll-route-readiness  pure route gating from gathered facts
 *  - payroll-route-assignment per-row route + run-level split
 *  - payroll-confirmation     confirmation summary + typed-confirm gate
 *  - payroll-executor         sequential, cancellable batch runner
 *  - payroll-row-submitter    bridge to Umbra / MagicBlock send paths
 */
export * from '@/lib/payroll/payroll-types';
export * from '@/lib/payroll/payroll-validation';
export * from '@/lib/payroll/payroll-route-readiness';
export * from '@/lib/payroll/payroll-readiness-facts';
export * from '@/lib/payroll/payroll-route-assignment';
export * from '@/lib/payroll/payroll-confirmation';
export * from '@/lib/payroll/payroll-wallet-eligibility';
export * from '@/lib/payroll/payroll-run-readiness';
export * from '@/lib/payroll/payroll-recipient-registration';
export * from '@/lib/payroll/payroll-run-status';
export * from '@/lib/payroll/payroll-resume';
export * from '@/lib/payroll/payroll-executor';
export * from '@/lib/payroll/payroll-row-submitter';
export * from '@/lib/payroll/payroll-staging';

export * from '@/lib/payroll/parsing/payroll-formats';
export * from '@/lib/payroll/parsing/payroll-column-mapping';
export {
  parsePayrollTable,
  type PayrollTable,
  type PayrollTableResult,
  type ParsePayrollTableParams,
} from '@/lib/payroll/parsing/payroll-table-parser';
