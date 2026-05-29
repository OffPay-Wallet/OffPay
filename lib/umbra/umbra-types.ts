import type { OffpayNetwork } from '@/types/offpay-api';
import type { UmbraTokenSymbol } from '@/lib/umbra/umbra-supported-tokens';

export type UmbraExecutionAction =
  | 'register'
  | 'shield'
  | 'unshield'
  | 'balance'
  | 'private-p2p'
  | 'claim'
  | 'repair';

export interface UmbraWalletExecutionParams {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
}

export interface UmbraTokenExecutionParams extends UmbraWalletExecutionParams {
  token: string;
  tokenMint?: string | null;
  amount: string;
  recipient?: string | null;
}

export interface UmbraUnshieldParams extends UmbraTokenExecutionParams {
  recipient?: string | null;
}

export interface UmbraVaultKeyRepairParams extends UmbraWalletExecutionParams {
  tokens: string[];
}

export interface UmbraPrivateP2PParams extends UmbraTokenExecutionParams {
  recipient: string;
  autoSetupSender?: boolean;
}

export type UmbraPrivateP2PFromEncryptedBalanceParams = UmbraPrivateP2PParams;

export interface UmbraEncryptedBalanceSummary {
  mint: string;
  symbol: UmbraTokenSymbol;
  name: string;
  decimals: number;
  logoUri?: string | null;
  state: string;
  rawBalance: string | null;
  displayBalance: string | null;
  unreadableReason?: 'invalid_u64' | 'key_mismatch' | 'unknown' | null;
  encryptionKeyStatus?:
    | 'matched'
    | 'mismatched'
    | 'missing_user_account'
    | 'missing_token_account'
    | 'not_shared_balance'
    | 'unknown';
  encryptedUserAccount?: string | null;
  encryptedTokenAccount?: string | null;
}

/**
 * Public-facing per-UTXO metadata for pending Umbra private P2P claims.
 *
 * The Umbra indexer returns a much richer object (raw H1 components,
 * H1/H2 hashes, AES-encrypted blobs, X25519 keys, etc.) but most of
 * that is internal to the SDK. The receive flow surfaces only the
 * fields a user can reason about — when the deposit happened, the
 * mint, who sent it, and the on-chain commitment hash that uniquely
 * identifies it.
 */
export interface UmbraPendingClaimUtxo {
  /** Stable identifier — `${treeIndex}:${insertionIndex}`. */
  id: string;
  /** Whether the UTXO targets the wallet directly or routes via self. */
  kind: 'receiver' | 'self';
  /** Insertion index inside the Umbra Merkle tree. */
  insertionIndex: number;
  /** Merkle tree index. */
  treeIndex: number;
  /** Final commitment as a hex string (handy for explorers). */
  finalCommitmentHex: string;
  /** Token mint base58 address, or null if it could not be resolved. */
  mintBase58: string | null;
  /** Sender wallet base58 address, or null if it could not be resolved. */
  senderBase58: string | null;
  /** UTC unix-ms timestamp from the indexer's H1 timestamp components. */
  depositTimestampMs: number | null;
}

export interface UmbraExecutionResult {
  action: UmbraExecutionAction;
  walletAddress: string;
  network: OffpayNetwork;
  title: string;
  subtitle: string;
  signatures: string[];
  primarySignature?: string;
  mint?: string;
  tokenSymbol?: UmbraTokenSymbol;
  amountAtomic?: string;
  amountDisplay?: string;
  recipient?: string;
  vaultState?: 'exists' | 'non_existent' | 'unknown';
  vaultRegistered?: boolean;
  vaultCanShield?: boolean;
  mixerRegistered?: boolean;
  p2pSource?: 'public-balance' | 'encrypted-balance';
  pendingClaimCount?: number;
  claimedUtxoCount?: number;
  // Insertion indices of UTXOs that were just claimed in this run. The Receive
  // flow uses this to populate the on-device "already-claimed" filter so the
  // Claim card stops counting them while the indexer's nullifier propagation
  // catches up.
  claimedUtxoInsertionIndices?: number[];
  // Insertion indices of UTXOs that the *scan* surfaced as still
  // pending. The receive flow uses this as a fallback set to persist
  // when a claim fails with an "already claimed" error after the SDK
  // has already thrown — the indices are the only way to stop the
  // pending UTXOs reappearing while the indexer's nullifier
  // propagation catches up.
  pendingClaimUtxoInsertionIndices?: number[];
  // Per-UTXO metadata for the pending claims surfaced by the scan.
  // The pending-claims detail screen renders one row per entry so the
  // user can review and claim individual UTXOs.
  pendingClaimUtxoDetails?: UmbraPendingClaimUtxo[];
  nextScanStartIndex?: string;
  balances?: UmbraEncryptedBalanceSummary[];
}

export type UmbraVaultRegistrationStatus = {
  vaultState: 'exists' | 'non_existent';
  vaultRegistered: boolean;
  vaultCanShield: boolean;
  mixerRegistered: boolean;
};
