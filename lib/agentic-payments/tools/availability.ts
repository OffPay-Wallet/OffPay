import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import type { AgentToolSchema } from '@/lib/agentic-payments/types';
import type { CapabilitiesResponse, OffpayNetwork } from '@/types/offpay-api';

import { AGENTIC_MODEL_TOOL_DEFINITIONS } from './registry';
import { buildModelFacingToolSchema } from './tool-metadata';
import type { AgenticToolName } from './types';

export type AgenticChatCtaId =
  | 'balance'
  | 'activity'
  | 'send'
  | 'private-send'
  | 'swap'
  | 'payroll'
  | 'umbra-vault'
  | 'umbra-deposit'
  | 'umbra-withdraw'
  | 'umbra-claims'
  | 'flash';

export interface AgenticToolAvailabilityParams {
  network: OffpayNetwork | null;
  walletAddress?: string | null;
  walletId?: string | null;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  canUseUmbraWallet?: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
}

const WALLET_BALANCE_TOOL_NAMES = new Set<AgenticToolName>([
  'get_wallet_balance',
  'list_wallet_tokens',
  'get_sol_balance',
  'analyze_wallet',
]);

const WALLET_ACTIVITY_TOOL_NAMES = new Set<AgenticToolName>(['get_wallet_history']);

const CONTACT_TOOL_NAMES = new Set<AgenticToolName>(['list_local_contacts']);

const NORMAL_SEND_TOOL_NAMES = new Set<AgenticToolName>([
  'resolve_recipient',
  'get_normal_transfer_fee',
  'draft_normal_send',
]);

const PRIVATE_SEND_TOOL_NAMES = new Set<AgenticToolName>(['draft_private_send']);

const PRIVATE_READINESS_TOOL_NAMES = new Set<AgenticToolName>(['check_private_send_ready']);

const UMBRA_VAULT_ACTION_TOOL_NAMES = new Set<AgenticToolName>(['draft_umbra_vault_action']);
const UMBRA_VAULT_TOOL_NAMES = new Set<AgenticToolName>(['get_umbra_balances']);
const UMBRA_CLAIM_TOOL_NAMES = new Set<AgenticToolName>(['scan_umbra_claims']);

const SWAP_TOOL_NAMES = new Set<AgenticToolName>([
  'get_swap_tokens',
  'get_swap_price',
  'prepare_swap_quote',
]);

const FLASH_TOOL_NAMES = new Set<AgenticToolName>([
  'flash_get_markets',
  'flash_get_positions',
  'flash_get_prices',
  'flash_get_orders',
  'flash_open_position',
  'flash_close_position',
  'flash_add_collateral',
  'flash_remove_collateral',
  'flash_place_trigger_order',
  'flash_edit_trigger_order',
  'flash_cancel_trigger_order',
  'flash_cancel_all_trigger_orders',
  'flash_reverse_position',
]);

export function getAvailableAgenticChatCtaIds(
  params: AgenticToolAvailabilityParams,
): AgenticChatCtaId[] {
  const ctas: AgenticChatCtaId[] = [];
  if (canUseWalletBalanceTools(params)) ctas.push('balance');
  if (canUseWalletActivityTools(params)) ctas.push('activity');
  if (canUseNormalSendTools(params)) ctas.push('send');
  if (canUseUmbraVaultActionTools(params)) ctas.push('private-send');
  if (canUseSwapTools(params)) ctas.push('swap');
  if (canUsePayrollTools(params)) ctas.push('payroll');
  if (canUseUmbraVaultTools(params)) ctas.push('umbra-vault');
  if (canUseUmbraVaultActionTools(params)) ctas.push('umbra-deposit', 'umbra-withdraw');
  if (canUseUmbraClaimTools(params)) ctas.push('umbra-claims');
  if (canUseFlashTools(params)) ctas.push('flash');
  return ctas;
}

export function getAvailableAgenticModelToolSchemas(
  params: AgenticToolAvailabilityParams,
): AgentToolSchema[] {
  return AGENTIC_MODEL_TOOL_DEFINITIONS.filter((definition) =>
    isModelToolAvailable(definition.name, params),
  ).map(buildModelFacingToolSchema);
}

function isModelToolAvailable(
  name: AgenticToolName,
  params: AgenticToolAvailabilityParams,
): boolean {
  if (name === 'get_client_capabilities') return true;
  if (CONTACT_TOOL_NAMES.has(name)) return true;
  if (WALLET_BALANCE_TOOL_NAMES.has(name)) return canUseWalletBalanceTools(params);
  if (WALLET_ACTIVITY_TOOL_NAMES.has(name)) return canUseWalletActivityTools(params);
  if (PRIVATE_READINESS_TOOL_NAMES.has(name)) return hasWalletNetworkScope(params);
  if (NORMAL_SEND_TOOL_NAMES.has(name)) return canUseNormalSendTools(params);
  if (PRIVATE_SEND_TOOL_NAMES.has(name)) return canUsePrivateSendTools(params);
  if (UMBRA_VAULT_ACTION_TOOL_NAMES.has(name)) return canUseUmbraVaultActionTools(params);
  if (UMBRA_VAULT_TOOL_NAMES.has(name)) return canUseUmbraVaultTools(params);
  if (UMBRA_CLAIM_TOOL_NAMES.has(name)) return canUseUmbraClaimTools(params);
  if (name === 'stage_payroll') return canUsePayrollTools(params);
  if (SWAP_TOOL_NAMES.has(name)) return canUseSwapTools(params);
  if (FLASH_TOOL_NAMES.has(name)) return canUseFlashTools(params);
  return false;
}

function hasWalletNetworkScope(params: AgenticToolAvailabilityParams): boolean {
  return hasActiveWallet(params) && params.network != null;
}

function hasActiveWallet(params: AgenticToolAvailabilityParams): boolean {
  return typeof params.walletAddress === 'string' && params.walletAddress.length > 0;
}

function isOnlineNetworkReady(params: AgenticToolAvailabilityParams): boolean {
  return params.walletMode === 'online' && params.canUseNetwork && params.network != null;
}

function canUseWalletBalanceTools(params: AgenticToolAvailabilityParams): boolean {
  if (!hasWalletNetworkScope(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return isOffpayFeatureAvailable(capabilities, 'wallet.balance');
}

function canUseWalletActivityTools(params: AgenticToolAvailabilityParams): boolean {
  if (!hasActiveWallet(params) || !isOnlineNetworkReady(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return isOffpayFeatureAvailable(capabilities, 'wallet.transactions');
}

function canUseNormalSendTools(params: AgenticToolAvailabilityParams): boolean {
  if (!hasActiveWallet(params) || !isOnlineNetworkReady(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return isOffpayFeatureAvailable(capabilities, 'wallet.balance');
}

function canUsePrivateSendTools(params: AgenticToolAvailabilityParams): boolean {
  if (!hasActiveWallet(params) || !isOnlineNetworkReady(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return hasPrivateSendCapabilities(capabilities) || canUseUmbraClaimTools(params);
}

function canUsePayrollTools(params: AgenticToolAvailabilityParams): boolean {
  if (!hasActiveWallet(params) || !isOnlineNetworkReady(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return (
    isOffpayFeatureAvailable(capabilities, 'wallet.balance') ||
    hasPrivateSendCapabilities(capabilities) ||
    hasUmbraSendCapabilities(capabilities)
  );
}

function canUseUmbraVaultTools(params: AgenticToolAvailabilityParams): boolean {
  if (
    !hasActiveWallet(params) ||
    !hasUnlockedUmbraWallet(params) ||
    !isOnlineNetworkReady(params)
  ) {
    return false;
  }
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return isOffpayFeatureAvailable(capabilities, 'umbra.execution');
}

function canUseUmbraVaultActionTools(params: AgenticToolAvailabilityParams): boolean {
  if (!canUseUmbraVaultTools(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return isOffpayFeatureAvailable(capabilities, 'umbra.execution');
}

function canUseUmbraClaimTools(params: AgenticToolAvailabilityParams): boolean {
  if (!canUseUmbraVaultTools(params)) return false;
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return hasUmbraSendCapabilities(capabilities);
}

function canUseSwapTools(params: AgenticToolAvailabilityParams): boolean {
  if (!hasActiveWallet(params) || !isOnlineNetworkReady(params) || params.network !== 'mainnet') {
    return false;
  }
  const capabilities = params.capabilities ?? null;
  if (capabilities == null) return true;
  return (
    isOffpayFeatureAvailable(capabilities, 'swap.tokens') &&
    isOffpayFeatureAvailable(capabilities, 'swap.normalSwap')
  );
}

function canUseFlashTools(params: AgenticToolAvailabilityParams): boolean {
  return hasActiveWallet(params) && isOnlineNetworkReady(params) && params.network === 'mainnet';
}

function hasUnlockedUmbraWallet(params: AgenticToolAvailabilityParams): boolean {
  return params.walletId != null && params.canUseUmbraWallet !== false;
}

function hasPrivateSendCapabilities(capabilities: CapabilitiesResponse['capabilities']): boolean {
  return (
    isOffpayFeatureAvailable(capabilities, 'payment.privateInitMint') &&
    isOffpayFeatureAvailable(capabilities, 'payment.privateSend') &&
    isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast')
  );
}

function hasUmbraSendCapabilities(capabilities: CapabilitiesResponse['capabilities']): boolean {
  return (
    isOffpayFeatureAvailable(capabilities, 'umbra.execution') &&
    isOffpayFeatureAvailable(capabilities, 'payment.umbraPrivateP2p') &&
    isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast')
  );
}
