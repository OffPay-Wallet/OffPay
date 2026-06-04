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
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';
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
import {
  buildPayrollTokenContexts,
  resolveKnownPayrollTokenContext,
  resolvePayrollTokenContext,
  resolvePayrollTokenContextByIdentifier,
  walletCanSignPayroll,
} from '@/lib/payroll/payroll-wallet-eligibility';
import { stagePayroll } from '@/lib/payroll/payroll-staging';
import { inferPayrollTokenIdentifier } from '@/lib/payroll/payroll-token-inference';
import { isAbortError } from '@/lib/perf/abort';
import { usePayrollStore } from '@/store/payrollStore';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollColumnMapping } from '@/lib/payroll/parsing/payroll-column-mapping';
import type { PayrollRecipientFacts } from '@/lib/payroll/payroll-route-readiness';
import type { PayrollRoutePolicy, PayrollRow, PayrollRun } from '@/lib/payroll/payroll-types';
import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';
import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type {
  CapabilitiesResponse,
  OffpayNetwork,
  WalletBalanceResponse,
} from '@/types/offpay-api';

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

export type PayrollStageOutcome =
  | { status: 'staged'; runId: string; summary: PayrollConfirmationSummary }
  | { status: 'mapping_required' }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string };

export interface UsePayrollChatIntakeResult {
  activeRunId: string | null;
  summary: PayrollConfirmationSummary | null;
  busy: boolean;
  error: string | null;
  /** Set when the file parsed but columns need manual mapping. */
  mappingRequest: PayrollMappingRequest | null;
  pickFile: () => Promise<PayrollStageOutcome | null>;
  stageFromText: (fileName: string, text: string) => Promise<PayrollStageOutcome>;
  /** Re-stage the pending mapping-request file with a user-chosen mapping. */
  stageWithMapping: (mapping: PayrollColumnMapping) => Promise<PayrollStageOutcome>;
  cancelMapping: () => void;
  updateRoutePolicy: (policy: PayrollRoutePolicy) => Promise<void>;
  refreshRoutes: () => Promise<void>;
  reset: () => void;
}

function restoreRouteBlockedRows(rows: readonly PayrollRow[]): PayrollRow[] {
  return rows.map((row) =>
    row.status === 'invalid' && isRouteBlockValidationError(row.validationError)
      ? { ...row, status: 'ready', validationError: null, route: null }
      : row,
  );
}

function isRouteBlockValidationError(message: string | null): boolean {
  if (message == null) return false;
  if (message === PAYROLL_ROUTE_UNAVAILABLE_MESSAGE) return true;
  return !(
    message === 'Recipient is not a valid Solana wallet address.' ||
    message === 'Self-payment is not allowed in payroll.' ||
    message === 'Missing amount.' ||
    message === 'Amount must be greater than zero.' ||
    message === 'Duplicate recipient — remove or merge this row.' ||
    message.startsWith('Row token "') ||
    message.startsWith('Amount has more than ')
  );
}

function resolveTokenContextForRun(
  balance: WalletBalanceResponse | null | undefined,
  run: PayrollRun,
): PayrollTokenContext | null {
  if (run.tokenMint == null || run.tokenSymbol == null || run.tokenDecimals == null) return null;
  const token = balance?.tokens.find((entry) => entry.mint === run.tokenMint && !entry.spam);
  if (token == null) return null;
  const umbraToken = getUmbraTokenByMint(run.network, run.tokenMint);
  return {
    mint: run.tokenMint,
    symbol: run.tokenSymbol,
    aliases:
      umbraToken == null ? [] : [...new Set([umbraToken.symbol, ...(umbraToken.aliases ?? [])])],
    decimals: run.tokenDecimals,
    balanceAtomic: decimalInputToAtomicAmount(token.balance ?? '0', run.tokenDecimals),
  };
}

function readyRowsFitBalance(rows: readonly PayrollRow[], token: PayrollTokenContext): boolean {
  if (token.balanceAtomic == null || !/^\d+$/.test(token.balanceAtomic)) return false;
  let total = 0n;
  for (const row of rows) {
    if (row.status === 'ready' && row.tokenMint === token.mint && /^\d+$/.test(row.amountAtomic)) {
      total += BigInt(row.amountAtomic);
    }
  }
  return total <= BigInt(token.balanceAtomic);
}

function readyRowsFitBalances(
  rows: readonly PayrollRow[],
  tokensByMint: ReadonlyMap<string, PayrollTokenContext>,
): boolean {
  const totalsByMint = new Map<string, bigint>();
  for (const row of rows) {
    if (row.status !== 'ready' || !/^\d+$/.test(row.amountAtomic)) continue;
    totalsByMint.set(
      row.tokenMint,
      (totalsByMint.get(row.tokenMint) ?? 0n) + BigInt(row.amountAtomic),
    );
  }

  for (const [mint, total] of totalsByMint) {
    const token = tokensByMint.get(mint);
    if (token?.balanceAtomic == null || !/^\d+$/.test(token.balanceAtomic)) return false;
    if (total > BigInt(token.balanceAtomic)) return false;
  }
  return true;
}

function fallbackTokenContextFromRow(row: PayrollRow): PayrollTokenContext {
  return {
    mint: row.tokenMint,
    symbol: row.tokenSymbol,
    aliases: [],
    decimals: row.tokenDecimals,
    balanceAtomic: null,
  };
}

async function resolvePayrollTokenForInput(params: {
  balance: WalletBalanceResponse | null | undefined;
  network: OffpayNetwork | null;
  preferredSymbol: string;
  fileName: string;
  mimeType: string | null;
  text: string;
  mappingOverride?: PayrollColumnMapping;
}): Promise<PayrollTokenContext | null> {
  const inferredIdentifier = await inferPayrollTokenIdentifier({
    fileName: params.fileName,
    mimeType: params.mimeType,
    text: params.text,
    mappingOverride: params.mappingOverride,
  });

  if (inferredIdentifier != null) {
    const inferredToken =
      resolvePayrollTokenContextByIdentifier(params.balance, inferredIdentifier, params.network) ??
      resolveKnownPayrollTokenContext(inferredIdentifier, params.network);
    if (inferredToken != null) return inferredToken;
  }

  const preferredToken =
    resolvePayrollTokenContext(params.balance, params.preferredSymbol) ??
    resolvePayrollTokenContextByIdentifier(params.balance, params.preferredSymbol, params.network) ??
    resolveKnownPayrollTokenContext(params.preferredSymbol, params.network);
  if (preferredToken != null) return preferredToken;

  const availableTokens = buildPayrollTokenContexts(params.balance);
  return availableTokens.length === 1 ? availableTokens[0] : null;
}

export function usePayrollChatIntake(
  params: UsePayrollChatIntakeParams,
): UsePayrollChatIntakeResult {
  const createRun = usePayrollStore((state) => state.createRun);
  const replaceRows = usePayrollStore((state) => state.replaceRows);
  const setRunPolicy = usePayrollStore((state) => state.setRunPolicy);
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
    async (run: PayrollRun, rows: readonly PayrollRow[], defaultToken?: PayrollTokenContext) => {
      const rowsForRouting = restoreRouteBlockedRows(rows);
      const tokenContextsByMint = new Map<string, PayrollTokenContext>();
      for (const token of buildPayrollTokenContexts(params.balance)) {
        tokenContextsByMint.set(token.mint, token);
      }
      if (defaultToken != null) tokenContextsByMint.set(defaultToken.mint, defaultToken);
      for (const row of rowsForRouting) {
        if (!tokenContextsByMint.has(row.tokenMint)) {
          tokenContextsByMint.set(row.tokenMint, fallbackTokenContextFromRow(row));
        }
      }

      // Determine Umbra eligibility before paying for network probes. When
      // Umbra can't be used at all (no prover, capability off, unsupported
      // mint/network), skip the sender/recipient Umbra probes entirely.
      const umbraProverAvailable = Platform.OS !== 'web' && isRnZkProverNativeModuleAvailable();
      const umbraCapabilityAvailable =
        isOffpayFeatureAvailable(params.capabilities ?? null, 'umbra.execution') &&
        isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.umbraPrivateP2p') &&
        isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast');

      // Probe REAL per-recipient Umbra registration (batched, capped,
      // cached) so `private_auto` can actually choose Umbra. Skipped when no
      // selected token can use Umbra — every recipient then routes via
      // MagicBlock or becomes route-blocked for that token.
      const recipientFactsByAddress: Record<string, PayrollRecipientFacts> = {};
      const readyRows = rowsForRouting.filter((row) => row.status === 'ready');
      const anyUmbraEligibleToken = readyRows.some((row) => {
        const token = tokenContextsByMint.get(row.tokenMint) ?? fallbackTokenContextFromRow(row);
        return (
          run.routePolicy !== 'magicblock_only' &&
          umbraProverAvailable &&
          umbraCapabilityAvailable &&
          getUmbraTokenByMint(run.network, token.mint) != null
        );
      });

      let registeredByAddress: Record<string, boolean> = {};
      let unprobedRecipientCount = 0;
      if (anyUmbraEligibleToken) {
        const probe = await probeRecipientRegistration({
          recipients: readyRows.map((row) => row.recipient),
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

      const assignment = {
        rows: [] as ReturnType<typeof assignPayrollRoutes>['rows'],
        split: { umbra: 0, magicblock: 0, blocked: 0, claimRequired: 0 },
        mintWouldChangeOnFallback: false,
      };
      let requiresUmbraSetup = false;

      const readyRowsByMint = new Map<string, PayrollRow[]>();
      for (const row of readyRows) {
        const list = readyRowsByMint.get(row.tokenMint) ?? [];
        list.push(row);
        readyRowsByMint.set(row.tokenMint, list);
      }

      for (const [mint, tokenRows] of readyRowsByMint) {
        const firstRow = tokenRows[0];
        if (firstRow == null) continue;
        const token = tokenContextsByMint.get(mint) ?? fallbackTokenContextFromRow(firstRow);
        const umbraEligible =
          run.routePolicy !== 'magicblock_only' &&
          umbraProverAvailable &&
          umbraCapabilityAvailable &&
          getUmbraTokenByMint(run.network, token.mint) != null;

        // Gather REAL run-level readiness per selected mint: sender mixer
        // registration, vault fee readiness, and SOL fee buffer.
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
          hasTokenBalanceForRun: readyRowsFitBalance(tokenRows, token),
          hasFeeSol: runReadiness.hasFeeSol,
          umbraNativeProverAvailable: umbraProverAvailable,
          umbraVaultFeeReady: runReadiness.umbraVaultFeeReady,
          umbraSenderMixerRegistered: runReadiness.umbraSenderMixerRegistered,
        });

        const tokenAssignment = assignPayrollRoutes({
          rows: tokenRows,
          policy: run.routePolicy,
          facts,
          mint: token.mint,
          recipientFactsByAddress,
        });
        assignment.rows.push(...tokenAssignment.rows);
        assignment.split.umbra += tokenAssignment.split.umbra;
        assignment.split.magicblock += tokenAssignment.split.magicblock;
        assignment.split.blocked += tokenAssignment.split.blocked;
        assignment.split.claimRequired += tokenAssignment.split.claimRequired;
        assignment.mintWouldChangeOnFallback ||= tokenAssignment.mintWouldChangeOnFallback;

        requiresUmbraSetup ||=
          run.network === 'mainnet' &&
          umbraEligible &&
          !runReadiness.umbraSenderMixerRegistered &&
          tokenRows.some((row) =>
            umbraBlockedOnlyBySenderSetup(facts, recipientFactsByAddress[row.recipient]),
          );
      }

      const routedRows = applyRouteAssignment(rowsForRouting, assignment, recipientFactsByAddress);
      const hasSufficientBalanceForRun = readyRowsFitBalances(routedRows, tokenContextsByMint);
      const summaryToken =
        defaultToken ??
        (run.tokenMint != null ? tokenContextsByMint.get(run.tokenMint) : undefined) ??
        tokenContextsByMint.get(readyRows[0]?.tokenMint ?? '');

      const summary = buildPayrollConfirmationSummary({
        walletAddress: run.walletAddress,
        network: run.network,
        tokenSymbol: summaryToken?.symbol ?? run.tokenSymbol ?? '',
        tokenMint: summaryToken?.mint ?? run.tokenMint ?? '',
        tokenDecimals: summaryToken?.decimals ?? run.tokenDecimals ?? 6,
        rows: routedRows,
        routePolicy: run.routePolicy,
        split: assignment.split,
        requiresUmbraSetup,
        hasSufficientBalanceForRun,
        unprobedRecipientCount,
      });

      return { rows: routedRows, summary };
    },
    [params.balance, params.capabilities, params.canUseNetwork, params.importMethod, walletId],
  );

  const stage = useCallback(
    async (
      fileName: string,
      mimeType: string | null,
      text: string,
      mappingOverride?: PayrollColumnMapping,
    ): Promise<PayrollStageOutcome> => {
      setError(null);
      if (params.walletAddress == null || params.network == null) {
        const message = 'Connect a wallet before staging payroll.';
        setError(message);
        return { status: 'error', message };
      }

      const token = await resolvePayrollTokenForInput({
        balance: params.balance,
        network: params.network,
        preferredSymbol: tokenSymbol,
        fileName,
        mimeType,
        text,
        mappingOverride,
      });
      if (token == null) {
        const message = 'No supported payroll token balance found in the active wallet.';
        setError(message);
        return { status: 'error', message };
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
            return { status: 'mapping_required' };
          }
          setError(staged.message);
          return { status: 'error', message: staged.message };
        }

        setMappingRequest(null);
        const routed = await routeRows(staged.run, staged.rows, token);
        if (staged.summary.validCount === 0) {
          const message =
            'No valid payroll rows found. Check the recipient and amount columns and try again.';
          setError(message);
          return { status: 'blocked', message };
        }

        createRun(staged.run, routed.rows);
        replaceRows(staged.run.id, routed.rows);
        setActiveRunId(staged.run.id);
        setSummary(routed.summary);
        return { status: 'staged', runId: staged.run.id, summary: routed.summary };
      } catch (caught) {
        if (isAbortError(caught)) {
          const message = 'Payroll staging was cancelled.';
          setError(message);
          return { status: 'error', message };
        }
        const message = caught instanceof Error ? caught.message : 'Failed to stage payroll.';
        setError(message);
        return { status: 'error', message };
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

  const pickFile = useCallback(async (): Promise<PayrollStageOutcome | null> => {
    setError(null);
    const picked = await pickPayrollFile();
    if (!picked.ok) {
      setError(picked.message);
      return { status: 'error', message: picked.message };
    }
    if (picked.cancelled) return null;
    return stage(picked.file.fileName, picked.file.mimeType, picked.file.text);
  }, [stage]);

  const stageFromText = useCallback(
    async (fileName: string, text: string) => {
      return stage(fileName, null, text);
    },
    [stage],
  );

  const stageWithMapping = useCallback(
    async (mapping: PayrollColumnMapping): Promise<PayrollStageOutcome> => {
      const request = mappingRequest;
      if (request == null) {
        return { status: 'error', message: 'No payroll file is waiting for column mapping.' };
      }
      return stage(request.fileName, request.mimeType, request.text, mapping);
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

    setBusy(true);
    try {
      const routed = await routeRows(run, getRows(activeRunId), token ?? undefined);
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

  const updateRoutePolicy = useCallback(
    async (policy: PayrollRoutePolicy) => {
      setError(null);
      if (activeRunId == null) return;
      const run = getRun(activeRunId);
      if (run == null || run.routePolicy === policy) return;
      if (run.status !== 'ready' && run.status !== 'draft') {
        setError('Payroll route can only be changed before confirming the batch.');
        return;
      }

      const token = resolveTokenContextForRun(params.balance, run);

      setBusy(true);
      try {
        const nextRun: PayrollRun = { ...run, routePolicy: policy, routesDirty: false };
        const routed = await routeRows(nextRun, getRows(activeRunId), token ?? undefined);
        setRunPolicy(activeRunId, policy);
        replaceRows(activeRunId, routed.rows);
        setRunRoutesDirty(activeRunId, false);
        setSummary(routed.summary);
      } catch (caught) {
        if (isAbortError(caught)) return;
        setError(caught instanceof Error ? caught.message : 'Failed to update payroll route.');
      } finally {
        setBusy(false);
      }
    },
    [
      activeRunId,
      getRun,
      getRows,
      params.balance,
      replaceRows,
      routeRows,
      setRunPolicy,
      setRunRoutesDirty,
    ],
  );

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
      updateRoutePolicy,
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
      updateRoutePolicy,
      refreshRoutes,
      reset,
    ],
  );
}
