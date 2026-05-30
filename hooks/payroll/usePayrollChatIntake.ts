/**
 * Chat-side payroll intake. Encapsulates the staging pipeline so `ChatScreen`
 * only needs to render a card for the returned `activeRunId`:
 *
 *   pickFile()/stageText() -> stagePayroll -> persist run+rows ->
 *   assign routes from readiness facts -> build confirmation summary
 *
 * Heavy parsing/validation happens in `@/lib/payroll` (chunked + yielding).
 * This hook is the thin React adapter; it holds no row-level state itself
 * (that lives in `usePayrollStore`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';
import {
  applyRouteAssignment,
  assignPayrollRoutes,
  PAYROLL_ROUTE_UNAVAILABLE_MESSAGE,
} from '@/lib/payroll/payroll-route-assignment';
import { buildPayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import { buildPayrollRouteFacts } from '@/lib/payroll/payroll-readiness-facts';
import { gatherPayrollRunReadiness } from '@/lib/payroll/payroll-run-readiness';
import { pickPayrollFile } from '@/lib/payroll/payroll-file-intake';
import { probeRecipientRegistration } from '@/lib/payroll/payroll-recipient-registration';
import { umbraBlockedOnlyBySenderSetup } from '@/lib/payroll/payroll-route-readiness';
import { resolvePayrollTokenContext, walletCanSignPayroll } from '@/lib/payroll/payroll-wallet-eligibility';
import { stagePayroll } from '@/lib/payroll/payroll-staging';
import { isAbortError } from '@/lib/perf/abort';
import { usePayrollStore } from '@/store/payrollStore';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollColumnMapping } from '@/lib/payroll/parsing/payroll-column-mapping';
import type { PayrollRecipientFacts } from '@/lib/payroll/payroll-route-readiness';
import type { PayrollRoutePolicy, PayrollRow, PayrollRun } from '@/lib/payroll/payroll-types';
import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';
import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type { CapabilitiesResponse, OffpayNetwork, WalletBalanceResponse } from '@/types/offpay-api';

export interface UsePayrollChatIntakeParams {
  walletAddress: string | null;
  walletId: string | null;
  network: OffpayNetwork | null;
  importMethod: WalletImportMethod | null;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  canUseNetwork: boolean;
  /** Default token symbol for the run (e.g. the wallet's primary stablecoin). */
  tokenSymbol?: string;
  routePolicy?: PayrollRoutePolicy;
}

export interface PayrollMappingRequest {
  fileName: string;
  mimeType: string | null;
  text: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  suggestedMapping: PayrollColumnMapping;
}

export interface UsePayrollChatIntakeResult {
  activeRunId: string | null;
  summary: PayrollConfirmationSummary | null;
  busy: boolean;
  error: string | null;
  /** Set when the file parsed but columns need manual mapping. */
  mappingRequest: PayrollMappingRequest | null;
  pickFile: () => Promise<void>;
  stageFromText: (fileName: string, text: string) => Promise<void>;
  /** Re-stage the pending mapping-request file with a user-chosen mapping. */
  stageWithMapping: (mapping: PayrollColumnMapping) => Promise<void>;
  cancelMapping: () => void;
  refreshRoutes: () => Promise<void>;
  reset: () => void;
}

function restoreRouteBlockedRows(rows: readonly PayrollRow[]): PayrollRow[] {
  return rows.map((row) =>
    row.status === 'invalid' && row.validationError === PAYROLL_ROUTE_UNAVAILABLE_MESSAGE
      ? { ...row, status: 'ready', validationError: null, route: null }
      : row,
  );
}

function resolveTokenContextForRun(
  balance: WalletBalanceResponse | null | undefined,
  run: PayrollRun,
): PayrollTokenContext | null {
  if (run.tokenMint == null || run.tokenSymbol == null || run.tokenDecimals == null) return null;
  const token = balance?.tokens.find((entry) => entry.mint === run.tokenMint && !entry.spam);
  if (token == null) return null;
  return {
    mint: run.tokenMint,
    symbol: run.tokenSymbol,
    decimals: run.tokenDecimals,
    balanceAtomic: decimalInputToAtomicAmount(token.balance ?? '0', run.tokenDecimals),
  };
}

function readyRowsFitBalance(rows: readonly PayrollRow[], token: PayrollTokenContext): boolean {
  if (token.balanceAtomic == null || !/^\d+$/.test(token.balanceAtomic)) return false;
  let total = 0n;
  for (const row of rows) {
    if (row.status === 'ready' && /^\d+$/.test(row.amountAtomic)) {
      total += BigInt(row.amountAtomic);
    }
  }
  return total <= BigInt(token.balanceAtomic);
}

export function usePayrollChatIntake(
  params: UsePayrollChatIntakeParams,
): UsePayrollChatIntakeResult {
  const createRun = usePayrollStore((state) => state.createRun);
  const replaceRows = usePayrollStore((state) => state.replaceRows);
  const setRunRoutesDirty = usePayrollStore((state) => state.setRunRoutesDirty);
  const getRun = usePayrollStore((state) => state.getRun);
  const getRows = usePayrollStore((state) => state.getRows);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PayrollConfirmationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mappingRequest, setMappingRequest] = useState<PayrollMappingRequest | null>(null);
  // Reused across stagings so re-probing the same recipients is cheap.
  const registrationCacheRef = useRef<Map<string, boolean>>(new Map());

  const tokenSymbol = params.tokenSymbol ?? 'USDC';
  const routePolicy = params.routePolicy ?? 'private_auto';
  const walletId = params.walletId;
  const scopeKey = `${params.walletAddress ?? 'no-wallet'}:${walletId ?? 'no-wallet-id'}:${
    params.network ?? 'no-network'
  }`;
  const previousScopeKeyRef = useRef(scopeKey);

  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    previousScopeKeyRef.current = scopeKey;
    setActiveRunId(null);
    setSummary(null);
    setError(null);
    setMappingRequest(null);
    registrationCacheRef.current.clear();
  }, [scopeKey]);

  const routeRows = useCallback(
    async (run: PayrollRun, rows: readonly PayrollRow[], token: PayrollTokenContext) => {
      const rowsForRouting = restoreRouteBlockedRows(rows);

      // Determine Umbra eligibility before paying for network probes. When
      // Umbra can't be used at all (no prover, capability off, unsupported
      // mint/network), skip the sender/recipient Umbra probes entirely.
      const umbraProverAvailable = Platform.OS !== 'web' && isRnZkProverNativeModuleAvailable();
      const umbraCapabilityAvailable =
        isOffpayFeatureAvailable(params.capabilities ?? null, 'umbra.execution') &&
        isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.umbraPrivateP2p') &&
        isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast');
      const umbraEligible =
        run.routePolicy !== 'magicblock_only' && umbraProverAvailable && umbraCapabilityAvailable;

      // Gather REAL run-level readiness: sender mixer registration, vault
      // fee account readiness, and SOL fee buffer (replaces placeholders).
      const runReadiness = await gatherPayrollRunReadiness({
        walletAddress: run.walletAddress,
        walletId,
        network: run.network,
        mint: token.mint,
        solLamports: params.balance?.solBalance ?? 0,
        umbraEligible,
      });

      const facts = buildPayrollRouteFacts({
        network: run.network,
        mint: token.mint,
        capabilities: params.capabilities ?? null,
        walletCanSign: walletCanSignPayroll(params.importMethod),
        online: params.canUseNetwork,
        rpcReady: params.canUseNetwork,
        hasTokenBalanceForRun: readyRowsFitBalance(rowsForRouting, token),
        hasFeeSol: runReadiness.hasFeeSol,
        umbraNativeProverAvailable: umbraProverAvailable,
        umbraVaultFeeReady: runReadiness.umbraVaultFeeReady,
        umbraSenderMixerRegistered: runReadiness.umbraSenderMixerRegistered,
      });

      // Probe REAL per-recipient Umbra registration (batched, capped,
      // cached) so `private_auto` can actually choose Umbra. Skipped when
      // Umbra is ineligible — every recipient then routes via MagicBlock.
      const recipientFactsByAddress: Record<string, PayrollRecipientFacts> = {};
      const sendableRecipients = rowsForRouting
        .filter((row) => row.status === 'ready')
        .map((row) => row.recipient);

      let registeredByAddress: Record<string, boolean> = {};
      let unprobedRecipientCount = 0;
      if (umbraEligible) {
        const probe = await probeRecipientRegistration({
          recipients: sendableRecipients,
          network: run.network,
          signerWalletAddress: run.walletAddress,
          walletId,
          skip: new Set([run.walletAddress]),
          cache: registrationCacheRef.current,
        });
        registeredByAddress = probe.registeredByAddress;
        unprobedRecipientCount = probe.unprobed.length;
      }

      for (const row of rowsForRouting) {
        const isSelf = row.recipient === run.walletAddress;
        recipientFactsByAddress[row.recipient] = {
          isSelf,
          umbraRecipientRegistered: isSelf || registeredByAddress[row.recipient] === true,
        };
      }

      const assignment = assignPayrollRoutes({
        rows: rowsForRouting,
        policy: run.routePolicy,
        facts,
        mint: token.mint,
        recipientFactsByAddress,
      });
      const routedRows = applyRouteAssignment(rowsForRouting, assignment, recipientFactsByAddress);

      // Mainnet preflight: detect when Umbra would be usable for at least
      // one recipient IF the sender completed one-time mixer setup. This is
      // computed independently of the assignment so an unregistered sender
      // does NOT silently fall back to MagicBlock under `private_auto` — we
      // surface the setup step first. Only applies when sender setup is the
      // SOLE blocker (prover/vault/token/recipient all pass).
      const requiresUmbraSetup =
        run.network === 'mainnet' &&
        umbraEligible &&
        !runReadiness.umbraSenderMixerRegistered &&
        rowsForRouting.some(
          (row) =>
            row.status === 'ready' &&
            umbraBlockedOnlyBySenderSetup(facts, recipientFactsByAddress[row.recipient]),
        );

      const summary = buildPayrollConfirmationSummary({
        walletAddress: run.walletAddress,
        network: run.network,
        tokenSymbol: token.symbol,
        tokenMint: token.mint,
        tokenDecimals: token.decimals,
        rows: routedRows,
        routePolicy: run.routePolicy,
        split: assignment.split,
        requiresUmbraSetup,
        unprobedRecipientCount,
      });

      return { rows: routedRows, summary };
    },
    [
      params.balance,
      params.capabilities,
      params.canUseNetwork,
      params.importMethod,
      walletId,
    ],
  );

  const stage = useCallback(
    async (
      fileName: string,
      mimeType: string | null,
      text: string,
      mappingOverride?: PayrollColumnMapping,
    ) => {
      setError(null);
      if (params.walletAddress == null || params.network == null) {
        setError('Connect a wallet before staging payroll.');
        return;
      }

      const token = resolvePayrollTokenContext(params.balance, tokenSymbol);
      if (token == null) {
        setError(`No ${tokenSymbol} balance found in the active wallet.`);
        return;
      }

      setBusy(true);
      try {
        const staged = await stagePayroll({
          fileName,
          mimeType,
          text,
          walletAddress: params.walletAddress,
          walletId,
          network: params.network,
          token,
          routePolicy,
          mappingOverride,
        });

        if (!staged.ok) {
          // Surface a manual-mapping prompt instead of a dead-end error when
          // the file parsed but columns could not be detected.
          if (staged.needsManualMapping === true) {
            setMappingRequest({
              fileName,
              mimeType,
              text,
              headers: staged.headers,
              sampleRows: staged.sampleRows,
              suggestedMapping: staged.suggestedMapping,
            });
            return;
          }
          setError(staged.message);
          return;
        }

        setMappingRequest(null);
        const routed = await routeRows(staged.run, staged.rows, token);

        createRun(staged.run, routed.rows);
        replaceRows(staged.run.id, routed.rows);
        setActiveRunId(staged.run.id);
        setSummary(routed.summary);
      } catch (caught) {
        if (isAbortError(caught)) return;
        setError(caught instanceof Error ? caught.message : 'Failed to stage payroll.');
      } finally {
        setBusy(false);
      }
    },
    [
      params.walletAddress,
      params.network,
      params.balance,
      tokenSymbol,
      routePolicy,
      walletId,
      createRun,
      replaceRows,
      routeRows,
    ],
  );

  const pickFile = useCallback(async () => {
    setError(null);
    const picked = await pickPayrollFile();
    if (!picked.ok) {
      setError(picked.message);
      return;
    }
    if (picked.cancelled) return;
    await stage(picked.file.fileName, picked.file.mimeType, picked.file.text);
  }, [stage]);

  const stageFromText = useCallback(
    async (fileName: string, text: string) => {
      await stage(fileName, null, text);
    },
    [stage],
  );

  const stageWithMapping = useCallback(
    async (mapping: PayrollColumnMapping) => {
      const request = mappingRequest;
      if (request == null) return;
      await stage(request.fileName, request.mimeType, request.text, mapping);
    },
    [mappingRequest, stage],
  );

  const cancelMapping = useCallback(() => {
    setMappingRequest(null);
  }, []);

  const refreshRoutes = useCallback(async () => {
    setError(null);
    if (activeRunId == null) return;
    const run = getRun(activeRunId);
    if (run == null) return;
    const token = resolveTokenContextForRun(params.balance, run);
    if (token == null) {
      setError('Payroll token balance is no longer available. Refresh the wallet and try again.');
      return;
    }

    setBusy(true);
    try {
      const routed = await routeRows(run, getRows(activeRunId), token);
      replaceRows(activeRunId, routed.rows);
      setRunRoutesDirty(activeRunId, false);
      setSummary(routed.summary);
    } catch (caught) {
      if (isAbortError(caught)) return;
      setError(caught instanceof Error ? caught.message : 'Failed to refresh payroll routes.');
    } finally {
      setBusy(false);
    }
  }, [activeRunId, getRun, getRows, params.balance, replaceRows, routeRows, setRunRoutesDirty]);

  const reset = useCallback(() => {
    setActiveRunId(null);
    setSummary(null);
    setError(null);
    setMappingRequest(null);
  }, []);

  return useMemo(
    () => ({
      activeRunId,
      summary,
      busy,
      error,
      mappingRequest,
      pickFile,
      stageFromText,
      stageWithMapping,
      cancelMapping,
      refreshRoutes,
      reset,
    }),
    [
      activeRunId,
      summary,
      busy,
      error,
      mappingRequest,
      pickFile,
      stageFromText,
      stageWithMapping,
      cancelMapping,
      refreshRoutes,
      reset,
    ],
  );
}
