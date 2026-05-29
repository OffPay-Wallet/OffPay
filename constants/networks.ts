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
}

/** Provider endpoints are loaded from Expo `EXPO_PUBLIC_*` env vars and protected at the provider level. */
export const SOLANA_NETWORKS: readonly SolanaNetwork[] = [
  {
    id: 'mainnet-beta',
    label: 'Mainnet',
    description: 'Real SOL and tokens',
  },
  {
    id: 'devnet',
    label: 'Devnet',
    description: 'Free test SOL',
  },
] as const;

/** Default network */
export const DEFAULT_NETWORK: SolanaNetworkId = 'mainnet-beta';

/** Convert the UI/Solana cluster id into the shared OffPay network value. */
export function toOffpayNetwork(network: SolanaNetworkId): OffpayNetwork {
  if (network === 'mainnet-beta') return 'mainnet';
  return 'devnet';
}
