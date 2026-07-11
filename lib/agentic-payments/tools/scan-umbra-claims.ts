import { Platform } from 'react-native';

import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { buildAgenticUmbraClaimCandidate } from '@/lib/agentic-payments/umbra-claim-action';
import { scanUmbraPrivateP2PClaims } from '@/lib/umbra/umbra-execution';
import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { walletCanSignWithApp } from '@/lib/wallet/wallet-capabilities';

import {
  errorCodeFromUnknown,
  isExplicitUmbraClaimExecutionRequest,
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
      'Scans pending Umbra private P2P claims. With action=claim, creates an exact on-device confirmation draft; it never signs without user confirmation. Results expose counts/status only.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['scan', 'claim'],
          description: 'Use claim only for an explicit request to claim Umbra funds.',
        },
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
    const requestedAction = readStringArg(call, 'action')?.toLowerCase();
    if (requestedAction != null && requestedAction !== 'scan' && requestedAction !== 'claim') {
      return { error: { code: 'invalid_umbra_claim_action' } };
    }
    const action = requestedAction === 'claim' ? 'claim' : 'scan';
    if (
      action === 'claim'
        ? !isExplicitUmbraClaimExecutionRequest(context.userText)
        : !isExplicitUmbraClaimScanRequest(context.userText)
    ) {
      return {
        error: {
          code:
            action === 'claim'
              ? 'requires_explicit_umbra_claim_request'
              : 'requires_explicit_umbra_scan_request',
        },
      };
    }
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.walletId == null) return { error: { code: 'wallet_locked' } };
    if (
      !walletCanSignWithApp({
        importMethod: context.walletImportMethod,
        walletAddress: scope.walletAddress,
      })
    ) {
      return { error: { code: 'wallet_cannot_sign' } };
    }
    if (!isUmbraNetworkSupported(scope.network)) return { error: { code: 'feature_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (
      !isOffpayFeatureAvailable(context.capabilities, 'umbra.execution') ||
      !isOffpayFeatureAvailable(context.capabilities, 'payment.umbraPrivateP2p') ||
      (action === 'claim' &&
        !isOffpayFeatureAvailable(context.capabilities, 'payment.rpcBroadcast'))
    ) {
      return { error: { code: 'feature_unavailable' } };
    }
    if (action === 'claim' && (Platform.OS === 'web' || !isRnZkProverNativeModuleAvailable())) {
      return { error: { code: 'native_umbra_required' } };
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
        ...(scanMode === 'range' ? { startInsertionIndex, endInsertionIndex } : {}),
        signal: context.signal,
        pageLimit: 48,
      });
      const candidate = buildAgenticUmbraClaimCandidate(result);
      if (action === 'claim') {
        if (!candidate.ok) {
          if (candidate.code === 'no_pending_umbra_claims') {
            return {
              result: {
                status: 'ok',
                pendingClaimCount: 0,
                pendingClaimUtxoCount: 0,
                claimExecution: 'nothing_to_claim',
                claimToolAvailable: false,
              },
            };
          }
          return { error: { code: candidate.code } };
        }

        return {
          result: {
            status: 'drafted',
            pendingClaimCount: candidate.claimCount,
            pendingClaimUtxoCount: candidate.claimCount,
            vaultState: result.vaultState ?? null,
            vaultRegistered: result.vaultRegistered ?? null,
            vaultCanShield: result.vaultCanShield ?? null,
            mixerRegistered: result.mixerRegistered ?? null,
            claimExecution: 'confirmation_required',
            claimToolAvailable: true,
            destination: 'umbra_encrypted_balance',
          },
          draft: {
            kind: 'umbra_claim',
            draft: {
              walletAddress: scope.walletAddress,
              network: scope.network,
              utxoInsertionIndices: candidate.utxoInsertionIndices,
              claimCount: candidate.claimCount,
              destination: 'umbra_encrypted_balance',
            },
          },
        };
      }

      const nativeClaimAvailable =
        Platform.OS !== 'web' && isRnZkProverNativeModuleAvailable() && candidate.ok;
      return {
        result: {
          status: 'ok',
          pendingClaimCount: result.pendingClaimCount ?? 0,
          pendingClaimUtxoCount: result.pendingClaimUtxoInsertionIndices?.length ?? 0,
          vaultState: result.vaultState ?? null,
          vaultRegistered: result.vaultRegistered ?? null,
          vaultCanShield: result.vaultCanShield ?? null,
          mixerRegistered: result.mixerRegistered ?? null,
          claimExecution: nativeClaimAvailable
            ? 'confirmation_required'
            : candidate.ok
              ? 'native_app_required'
              : candidate.code === 'no_pending_umbra_claims'
                ? 'nothing_to_claim'
                : candidate.code === 'umbra_claim_setup_required'
                  ? 'setup_required'
                  : candidate.code === 'umbra_claim_batch_too_large'
                    ? 'smaller_range_required'
                    : 'unavailable',
          claimToolAvailable: nativeClaimAvailable,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'umbra_claim_scan_failed') } };
    }
  },
};
