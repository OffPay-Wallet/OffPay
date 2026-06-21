/**
 * Solana network cluster definitions.
 *
 * Usage: import { SOLANA_NETWORKS, type SolanaNetwork } from '@/constants/networks';
 */

/** Solana cluster identifier exposed by OffPay UI. */
export type SolanaNetworkId = 'mainnet-beta' | 'devnet';

/** Network values accepted by the OffPay API and client provider contracts. */
export type OffpayNetwork = 'mainnet' | 'devnet';

export interface SolanaNetwork {
  /** Cluster identifier (matches @solana/web3.js) */
  id: SolanaNetworkId;
  /** Human-readable label */
  label: string;
  /** Short description for the UI */
  description: string;
  /** True when the public client can select this network. */
  selectable: boolean;
  /** Internal-only networks remain visible but disabled in user-facing UI. */
  adminOnly?: boolean;
  /** Disabled-state copy shown in the selector. */
  unavailableDescription?: string;
}

/**
 * Client-side mainnet kill switch.
 *
 * Keep this false for public builds. Flip only in an internal/admin build;
 * it is intentionally not user-configurable from the app UI. Client code is
 * not a secure secret boundary, so backend authorization must still enforce
 * any real mainnet access controls.
 */
const ENABLE_MAINNET_IN_CLIENT = false;

/** Provider endpoints are loaded from Expo `EXPO_PUBLIC_*` env vars and protected at the provider level. */
export const SOLANA_NETWORKS: readonly SolanaNetwork[] = [
  {
    id: 'mainnet-beta',
    label: 'Mainnet',
    description: 'Real SOL and tokens',
    selectable: ENABLE_MAINNET_IN_CLIENT,
    adminOnly: true,
    unavailableDescription: 'Unavailable',
  },
  {
    id: 'devnet',
    label: 'Devnet',
    description: 'Free test SOL',
    selectable: true,
  },
] as const;

/** Default network */
export const DEFAULT_NETWORK: SolanaNetworkId = 'devnet';

export function isSolanaNetworkSelectable(network: SolanaNetworkId): boolean {
  return SOLANA_NETWORKS.some((entry) => entry.id === network && entry.selectable);
}

export function resolveSelectableSolanaNetwork(network: unknown): SolanaNetworkId {
  if ((network === 'mainnet-beta' || network === 'devnet') && isSolanaNetworkSelectable(network)) {
    return network;
  }

  return DEFAULT_NETWORK;
}

/** Convert the UI/Solana cluster id into the shared OffPay network value. */
export function toOffpayNetwork(network: SolanaNetworkId): OffpayNetwork {
  const selectableNetwork = resolveSelectableSolanaNetwork(network);
  if (selectableNetwork === 'mainnet-beta') return 'mainnet';
  return 'devnet';
}
