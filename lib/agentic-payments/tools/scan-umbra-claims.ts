import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { scanUmbraPrivateP2PClaims } from '@/lib/umbra/umbra-execution';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { walletHasLocalSigningMaterial } from '@/lib/wallet/wallet-capabilities';

import {
  errorCodeFromUnknown,
  isExplicitUmbraClaimScanRequest,
  isNetworkReady,
  readCappedInteger,
  readStringArg,
  requireWalletAndNetwork,
} from './helpers';
import type { AgenticToolDefinition } from './types';

export const scanUmbraClaimsTool: AgenticToolDefinition = {
  name: 'scan_umbra_claims',
  schema: {
    name: 'scan_umbra_claims',
    description:
      'Explicit Umbra-only read. Scans for pending Umbra private P2P claims and returns counts/status only. Does not claim; claims are manual in the app.',
    parameters: {
      type: 'object',
      properties: {
        scanMode: {
          type: 'string',
          enum: ['recent', 'range'],
          description: 'Use recent unless user asks for a specific range.',
        },
        startInsertionIndex: { type: 'number' },
        endInsertionIndex: { type: 'number' },
        recentLeafLimit: { type: 'number', description: 'Recent leaf limit, capped at 200.' },
      },
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isExplicitUmbraClaimScanRequest(context.userText)) {
      return { error: { code: 'requires_explicit_umbra_scan_request' } };
    }
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.walletId == null) return { error: { code: 'wallet_locked' } };
    if (!walletHasLocalSigningMaterial(context.walletImportMethod)) {
      return { error: { code: 'wallet_cannot_sign' } };
    }
    if (!isUmbraNetworkSupported(scope.network)) return { error: { code: 'feature_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (
      !isOffpayFeatureAvailable(context.capabilities, 'umbra.execution') ||
      !isOffpayFeatureAvailable(context.capabilities, 'payment.umbraPrivateP2p')
    ) {
      return { error: { code: 'feature_unavailable' } };
    }

    const requestedScanMode = readStringArg(call, 'scanMode');
    const scanMode = requestedScanMode === 'range' ? 'range' : 'recent';
    const recentLeafLimit = readCappedInteger({
      call,
      key: 'recentLeafLimit',
      fallback: 80,
      min: 1,
      max: 200,
    });
    const startInsertionIndex = readCappedInteger({
      call,
      key: 'startInsertionIndex',
      fallback: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    const endInsertionIndex = readCappedInteger({
      call,
      key: 'endInsertionIndex',
      fallback: startInsertionIndex,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    if (scanMode === 'range' && endInsertionIndex < startInsertionIndex) {
      return { error: { code: 'invalid_scan_range' } };
    }
    if (scanMode === 'range' && endInsertionIndex - startInsertionIndex > 500) {
      return { error: { code: 'scan_range_too_large' } };
    }

    try {
      const result = await scanUmbraPrivateP2PClaims({
        walletAddress: scope.walletAddress,
        walletId: context.walletId,
        network: scope.network,
        scanMode,
        recentLeafLimit,
        pageLimit: 2,
        ...(scanMode === 'range' ? { startInsertionIndex, endInsertionIndex } : {}),
        signal: context.signal,
      });
      return {
        result: {
          status: 'ok',
          pendingClaimCount: result.pendingClaimCount ?? 0,
          pendingClaimUtxoCount: result.pendingClaimUtxoInsertionIndices?.length ?? 0,
          nextScanStartIndex: result.nextScanStartIndex ?? null,
          vaultState: result.vaultState ?? null,
          vaultRegistered: result.vaultRegistered ?? null,
          vaultCanShield: result.vaultCanShield ?? null,
          mixerRegistered: result.mixerRegistered ?? null,
          claimExecution: 'manual_only',
          claimToolAvailable: false,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'umbra_claim_scan_failed') } };
    }
  },
};
