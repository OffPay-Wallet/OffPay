import type { OffpayNetwork } from '@/constants/networks';

export type { OffpayNetwork };

type CapabilityReason =
  | 'available'
  | 'unsupported_network'
  | 'temporarily_unavailable'
  | 'not_implemented';

export interface CapabilityStatus {
  available: boolean;
  reason: CapabilityReason;
  message: string;
}

export interface OfflineSupportedStablecoin {
  symbol: 'USDC' | 'USDT';
  mint: string;
  decimals: number;
  enabled: boolean;
  name?: string;
  programId?: string;
}

export interface CapabilitiesResponse {
  network: OffpayNetwork;
  capabilities: {
    wallet: {
      balance: CapabilityStatus;
      transactions: CapabilityStatus;
    };
    stream: {
      walletActivity: CapabilityStatus;
    };
    swap: {
      tokens: CapabilityStatus;
      price: CapabilityStatus;
      normalSwap: CapabilityStatus;
      privacySwap: CapabilityStatus;
      triggerOrders: CapabilityStatus;
      recurringSwap: CapabilityStatus;
    };
    payment: {
      privateInitMint: CapabilityStatus;
      privateBalance: CapabilityStatus;
      privateSend: CapabilityStatus;
      umbraPrivateP2p?: CapabilityStatus;
      settle: CapabilityStatus;
      rpcBroadcast: CapabilityStatus;
    };
    umbra?: {
      execution?: CapabilityStatus;
    };
    offline?: {
      noncePool?: CapabilityStatus;
      nonceCreate?: CapabilityStatus;
      nonceAdvance?: CapabilityStatus;
      nonceStatus?: CapabilityStatus;
      tokenContext?: CapabilityStatus;
      rentEstimate?: CapabilityStatus;
      supportedStablecoins?: OfflineSupportedStablecoin[];
    };
  };
}

export interface BootstrapNonceResponse {
  nonce: string;
  expiresAt: number;
}

interface BootstrapProvisionCore {
  walletAddress: string;
  nonce: string;
  platform: 'ios' | 'android';
  inviteCode?: string;
  email?: string;
}

interface BootstrapProvisionAuthFields {
  walletSignature: string;
  appVersion: string;
  deviceId: string;
}

export interface BootstrapProvisionAttestedInput extends BootstrapProvisionCore {
  attestationToken: string;
  attestationKeyId?: string;
}

export interface BootstrapProvisionPrototypeBypassInput extends BootstrapProvisionCore {
  platform: 'android';
  attestationToken?: never;
  attestationKeyId?: never;
}

export type BootstrapProvisionInput =
  | BootstrapProvisionAttestedInput
  | BootstrapProvisionPrototypeBypassInput;

export type BootstrapProvisionAttestedBody = BootstrapProvisionAttestedInput &
  BootstrapProvisionAuthFields;

export type BootstrapProvisionPrototypeBypassBody = BootstrapProvisionPrototypeBypassInput &
  BootstrapProvisionAuthFields;

export type BootstrapProvisionBody =
  | BootstrapProvisionAttestedBody
  | BootstrapProvisionPrototypeBypassBody;

export interface BootstrapProvisionResponse {
  secret: string;
  issuedAt: number;
  bootstrapVersion: number;
}

export interface InviteVerifyResponse {
  verified: true;
  segment: string | null;
  gate: 'disabled' | 'required';
  email: string;
}

export interface WalletBalanceResponse {
  address: string;
  network: OffpayNetwork;
  solBalance: number;
  nativeSolUsdPrice?: number | null;
  tokens: Array<{
    mint: string;
    name: string;
    symbol: string;
    logo: string | null;
    balance: string;
    decimals: number;
    usdPrice?: number | null;
    verified: boolean;
    spam: boolean;
  }>;
  fetchedAt: number;
}

export interface WalletTransactionView {
  id: string;
  type: 'send' | 'receive' | 'swap';
  title: string;
  subtitle: string;
  sourceLabel: string | null;
  amountLabel: string | null;
  secondaryAmountLabel: string | null;
  amountTone: 'positive' | 'negative' | 'neutral' | 'failed';
  tokenMint: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenLogo: string | null;
  status: 'confirmed' | 'pending' | 'failed';
  detailTimestampMs: number | null;
  detailNetwork: OffpayNetwork | null;
  detailSignature: string | null;
  detailAccountLabel: string | null;
  detailAccountAddress: string | null;
}

export interface WalletTransactionGroup {
  title: string;
  data: WalletTransactionView[];
}

export interface WalletTransactionsResponse {
  address: string;
  network: OffpayNetwork;
  transactions: Array<{
    signature: string;
    timestamp: number;
    type: string;
    description: string | null;
    amount?: string | null;
    rawAmount?: string | null;
    tokenMint?: string | null;
    tokenSymbol?: string | null;
    tokenName?: string | null;
    tokenLogo?: string | null;
    tokenDecimals?: number | null;
    fee: number;
    status: 'success' | 'failed';
    direction?: 'send' | 'receive' | null;
    sender?: string | null;
    recipient?: string | null;
    counterparties: Array<{
      address: string;
      role: string;
    }>;
    display?: WalletTransactionView | null;
  }>;
  displayTransactions?: WalletTransactionView[];
  historyGroups?: WalletTransactionGroup[];
  cursor: string | null;
  fetchedAt: number;
}

export interface WalletDashboardResponse {
  network: OffpayNetwork;
  address: string;
  capabilities: CapabilitiesResponse;
  streamCapabilities: StreamCapabilitiesResponse;
  balance: WalletBalanceResponse;
  transactions: WalletTransactionsResponse;
  fetchedAt: number;
}

export interface StreamCapabilitiesResponse {
  network: OffpayNetwork;
  capabilities: {
    walletActivity: boolean;
  };
}

export interface WalletActivityEvent {
  type: string;
  signature: string;
  description: string | null;
  timestamp: number;
  amount?: string | null;
  rawAmount?: string | null;
  tokenMint?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenLogo?: string | null;
  tokenDecimals?: number | null;
  fee?: number | null;
  status?: 'success' | 'failed' | null;
  direction?: 'send' | 'receive' | null;
  sender?: string | null;
  recipient?: string | null;
  counterparties?: Array<{
    address: string;
    role: string;
  }> | null;
}

export interface WalletActivityPingEvent {
  timestamp: number;
}

export interface WalletActivityErrorEvent {
  code: 'STREAM_ERROR';
  retryable: true;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PendingBackupUploadBody {
  txId: string;
  ciphertext: string;
  nonce: string;
  createdAt: number;
}

export interface PendingBackupListResponse {
  backups: Array<{
    txId: string;
    ciphertext: string;
    nonce: string;
    createdAt: number;
  }>;
}

export interface SwapTokensResponse {
  tokens: Array<{
    mint: string;
    name: string;
    symbol: string;
    logo: string | null;
    decimals: number;
    verified: true;
  }>;
}

export interface SwapPriceResponse {
  mint: string;
  price: number;
  currency: 'USD';
  fetchedAt: number;
}

export interface FxRateResponse {
  base: 'USD';
  currency: string;
  rate: number;
  fetchedAt: number;
  source: 'frankfurter' | 'currency-api';
}

export interface MarketTokenPriceBatchInput {
  mint: string;
  symbol: string;
  priceSymbol: string;
}

export interface MarketTokenPricesBatchRequest {
  network: OffpayNetwork;
  currency: string;
  tokens: MarketTokenPriceBatchInput[];
}

export interface MarketTokenPricesBatchResponse {
  network: OffpayNetwork;
  currency: string;
  rate: number;
  fetchedAt: number;
  unitUsdPrices: Record<string, number>;
  pricedCount: number;
  expectedCount: number;
}

export interface SwapQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  useManualSlippage?: boolean;
  receiverAddress?: string;
  network: OffpayNetwork;
}

export interface SwapQuoteResponse {
  quoteId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps?: number | null;
  slippageMode?: 'auto' | 'manual';
  priceImpactPct: number;
  fee: string;
  routeSummary: string;
  expiresAt: number;
  unsignedTransaction: string;
}

export interface SwapExecuteRequest {
  quoteId: string;
  signedTransaction: string;
  network: OffpayNetwork;
}

export interface SwapExecuteResponse {
  signature: string;
}

export interface SwapTriggerChallengeRequest {
  action: 'auth_challenge';
  challengeType?: 'message' | 'transaction';
  network: OffpayNetwork;
}

export interface SwapTriggerChallengeResponse {
  challengeType: 'message' | 'transaction';
  challenge: string | null;
  unsignedChallengeTransaction: string | null;
}

export type SwapTriggerVerifyRequest =
  | {
      action: 'auth_verify';
      challengeType: 'message';
      signature: string;
      network: OffpayNetwork;
    }
  | {
      action: 'auth_verify';
      challengeType: 'transaction';
      signedChallengeTransaction: string;
      network: OffpayNetwork;
    };

export interface SwapTriggerVerifyResponse {
  authenticated: true;
  expiresAt: number;
}

export interface SwapTriggerPrepareRequest {
  action: 'prepare';
  inputMint: string;
  outputMint: string;
  amount: string;
  network: OffpayNetwork;
}

export interface SwapTriggerPrepareResponse {
  depositRequestId: string;
  unsignedTransaction: string;
  receiverAddress: string | null;
  mint: string;
  amount: string;
  tokenDecimals: number | null;
  vault: {
    walletAddress: string;
    vaultAddress: string;
    privyVaultId: string;
    privyUserId: string | null;
  };
}

export type SwapTriggerOrderType = 'single' | 'oco' | 'otoco';
export type SwapTriggerCondition = 'above' | 'below';

export interface SwapTriggerCreateRequest {
  action: 'create';
  orderType: SwapTriggerOrderType;
  depositRequestId: string;
  depositSignedTransaction: string;
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  expiresAt: number;
  triggerCondition?: SwapTriggerCondition;
  triggerPriceUsd?: number;
  slippageBps?: number;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
  network: OffpayNetwork;
}

export interface SwapTriggerCreateResponse {
  triggerId: string;
  status: 'open';
  depositSignature: string;
}

export interface SwapRecurringCreateRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  frequency: string;
  network: OffpayNetwork;
}

export interface SwapRecurringCreateResponse {
  recurringId: string;
  status: 'requires_signature';
  unsignedTransaction: string;
}

export interface SwapRecurringExecuteRequest {
  recurringId: string;
  signedTransaction: string;
  network: OffpayNetwork;
}

export interface SwapRecurringExecuteResponse {
  recurringId: string;
  status: 'Success' | 'Failed';
  signature: string;
}

export interface PrivacySwapPrepareRequest {
  executorWallet: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  fundingMemo?: string;
  network: OffpayNetwork;
}

export interface PrivacySwapPrepareResponse {
  sessionId: string;
  validator: string;
  initializationTransactions: Array<{
    mint: string;
    role: 'funding' | 'settlement';
    transaction: PreparedTransaction;
  }>;
  fundingTransaction: PreparedTransaction;
  swapQuote: SwapQuoteResponse | null;
}

export interface PrivacySwapRefreshQuoteRequest {
  sessionId: string;
  network: OffpayNetwork;
}

export interface PrivacySwapRefreshQuoteResponse {
  sessionId: string;
  validator: string;
  swapQuote: SwapQuoteResponse;
}

export interface PrivacySwapFinalizeRequest {
  sessionId: string;
  signedTransaction: string;
  settlementMemo?: string;
  network: OffpayNetwork;
}

export interface PrivacySwapFinalizeResponse {
  sessionId: string;
  validator: string;
  outputMint: string;
  settledAmount: string;
  swapSignature: string;
  settlementTransaction: PreparedTransaction;
}

export interface PrivateInitMintRequest {
  walletAddress: string;
  mintAddress: string;
  network: OffpayNetwork;
}

export interface PrivateInitMintResponse {
  queueId: string;
  validator: string;
  status: 'initialized' | 'requires_signature';
  unsignedTransaction?: string;
  transaction?: PreparedTransaction;
}

export interface PrivateBalanceResponse {
  address: string;
  baseBalance: string;
  privateBalance: string;
  mint: string;
  symbol?: 'USDC' | 'USDT';
  decimals?: number;
}

export interface PrivateSendRequest {
  walletAddress: string;
  recipient: string;
  amount: string;
  mint: string;
  network: OffpayNetwork;
}

export interface PrivateSendResponse {
  unsignedTransaction: string;
  transaction?: PreparedTransaction;
}

export interface PaymentSettleRequest {
  signedBlobs: string[];
  network: OffpayNetwork;
}

export interface PaymentSettleResponse {
  batchId: string;
  results: Array<{
    txId: string;
    signature: string | null;
    status: 'confirmed' | 'failed';
  }>;
}

export interface RpcBroadcastRequest {
  rawTransaction: string;
  network: OffpayNetwork;
  skipPreflight?: boolean;
  maxRetries?: number;
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
}

export type RpcOfflineSlotBroadcastPurpose = 'nonce-create' | 'nonce-advance' | 'nonce-close';

export interface RpcOfflineSlotBroadcastRequest extends RpcBroadcastRequest {
  purpose: RpcOfflineSlotBroadcastPurpose;
}

export interface RpcBroadcastResponse {
  signature: string;
}

export interface DevnetAirdropRequest {
  walletAddress: string;
  network: 'devnet';
}

export interface DevnetAirdropResponse {
  network: 'devnet';
  walletAddress: string;
  treasuryAddress: string;
  signature: string;
  lamports: string;
  sol: number;
  tokens: Array<{
    symbol: 'dUSDC' | 'dUSDT' | 'USDC';
    name: string;
    mint: string;
    decimals: number;
    rawAmount: string;
    amount: number;
    capRawAmount: string;
    capAmount: number;
    recipientTokenAccount: string;
  }>;
  nextEligibleAt: number;
}

export interface RpcLatestBlockhashResponse {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface RpcAccountRecord {
  pubkey?: string;
  address?: string;
  data?: string | null;
  dataBase64?: string | null;
  owner: string | null;
  lamports: string | number | null;
  executable: boolean | null;
  rentEpoch: string | number | null;
  space?: string | number | null;
}

export interface RpcAccountsRequest {
  addresses: string[];
  network: OffpayNetwork;
}

export interface RpcAccountsResponse {
  network: OffpayNetwork;
  accounts: Array<RpcAccountRecord | null>;
}

export interface RpcTokenLargestAccountsRequest {
  mint: string;
  network: OffpayNetwork;
}

export interface RpcTokenLargestAccount {
  address: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string | null;
}

export interface RpcTokenLargestAccountsResponse {
  network: OffpayNetwork;
  mint: string;
  accounts: RpcTokenLargestAccount[];
  fetchedAt: number;
}

export interface RpcEpochInfoResponse {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
}

export interface RpcSlotResponse {
  slot: number;
}

export interface RpcSignatureStatusesRequest {
  signatures: string[];
  network: OffpayNetwork;
}

export interface RpcSignatureStatus {
  slot: number | null;
  confirmations: number | null;
  err: JsonValue | null;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
}

export interface RpcSignatureStatusesResponse {
  statuses: Array<RpcSignatureStatus | null>;
}

export interface RpcSignaturesForAddressRequest {
  address: string;
  limit?: number;
  before?: string;
  network: OffpayNetwork;
}

export interface RpcSignaturesForAddressResponse {
  signatures: Array<{
    signature: string;
    slot: number;
    blockTime: number | null;
    err: JsonValue | null;
    confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  }>;
}

export interface UmbraUtxosRequest {
  network: OffpayNetwork;
  start?: string;
  end?: string;
  limit?: string;
}

export interface UmbraUtxosResponse {
  network: OffpayNetwork;
  utxos: Array<Record<string, JsonValue>>;
  cursor: string | null;
  hasMore: boolean;
  totalCount: string;
  startIndex: string;
  endIndex: string | null;
  highestIndexedInsertionIndex: string | null;
  fetchedAt: string;
}

export interface UmbraTreeProofsRequest {
  network: OffpayNetwork;
  treeIndex: number;
  insertionIndexes: number[];
}

export interface UmbraTreeProofsResponse {
  network: OffpayNetwork;
  treeIndex: number;
  proofs: JsonValue[];
  root: string | null;
  fetchedAt: string;
}

export interface UmbraTreeSummariesResponse {
  network: OffpayNetwork;
  trees: Array<{
    treeIndex: string;
    numLeaves: string;
  }>;
  fetchedAt: string;
}

export interface UmbraRelayerInfoResponse {
  network: OffpayNetwork;
  relayer: Record<string, JsonValue> | null;
  fetchedAt: string;
}

export interface UmbraClaimRequest {
  network: OffpayNetwork;
  payload: Record<string, JsonValue>;
}

export interface UmbraClaimResponse {
  network: OffpayNetwork;
  claimId: string | null;
  status: string | null;
  result: Record<string, JsonValue> | null;
  fetchedAt: string;
}

export interface UmbraClaimStatusResponse {
  network: OffpayNetwork;
  id: string;
  status: string | null;
  result: Record<string, JsonValue> | null;
  fetchedAt: string;
}

export interface OfflineRentEstimateResponse {
  network: OffpayNetwork;
  slotCount: number;
  lamportsPerNonceAccount: string;
  totalLamports: string;
  estimatedSol: string;
  expiresAt: number;
}

export interface OfflineNoncePoolPrepareRequest {
  walletAddress: string;
  nonceAuthority: string;
  nonceAccounts: string[];
  network: OffpayNetwork;
}

export interface OfflineNoncePoolPrepareResponse {
  network: OffpayNetwork;
  unsignedTransactions: Array<{
    nonceAccount: string;
    transactionBase64: string;
  }>;
  rentLamports: string;
}

export interface OfflineNoncePoolAdvanceRequest {
  walletAddress: string;
  nonceAccount: string;
  network: OffpayNetwork;
}

export interface OfflineNoncePoolAdvanceResponse {
  network: OffpayNetwork;
  nonceAccount: string;
  transactionBase64: string;
}

export interface OfflineNoncePoolStatusResponse {
  network: OffpayNetwork;
  walletAddress: string;
  targetSlotCount: number;
  counts: {
    ready: number;
    locked: number;
    settling: number;
    stale: number;
    missing: number;
    needsRefill: number;
  };
  slots: Array<{
    nonceAccount: string;
    state: 'ready' | 'locked' | 'settling' | 'stale' | 'missing' | 'error';
    nonceValue: string | null;
    authority: string;
    lamports: string;
    rentExempt: boolean;
    checkedAt: number;
  }>;
  fetchedAt: number;
}

export interface OfflineTokenAccountContext {
  associatedTokenAddress: string;
  accountExists: boolean;
}

export interface OfflineTokenContextResponse {
  network: OffpayNetwork;
  sender: string;
  recipient: string;
  mint: string;
  symbol: 'USDC' | 'USDT';
  name: string;
  decimals: number;
  programId: string;
  senderTokenAccount: OfflineTokenAccountContext;
  recipientTokenAccount: OfflineTokenAccountContext;
  supportedStablecoins: OfflineSupportedStablecoin[];
  fetchedAt: number;
}

export interface PreparedTransaction {
  kind: string;
  version: string | null;
  transactionBase64: string;
  sendTo: string | null;
  recentBlockhash: string | null;
  lastValidBlockHeight: number | null;
  instructionCount: number | null;
  requiredSigners: string[];
  validator: string | null;
  transferQueue?: string | null;
  rentPda?: string | null;
}

export type BackendErrorCode =
  | 'SIGNATURE_INVALID'
  | 'HMAC_INVALID'
  | 'SECRET_ROTATED'
  | 'OUTDATED_APP'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'QUOTE_EXPIRED'
  | 'SETTLEMENT_TIMEOUT'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'
  | 'INVITE_ALREADY_USED'
  | 'INVITE_EXPIRED'
  | 'INVITE_REQUIRED'
  | 'INVITE_REVOKED'
  | 'INVALID_INVITE_CODE'
  | 'INVALID_NETWORK'
  | 'INVALID_REQUEST'
  | 'INVALID_NONCE'
  | 'ATTESTATION_FAILED';

export interface BackendErrorEnvelope {
  error: {
    code: BackendErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs: number;
  };
}

export type OffpayApiMethod = 'GET' | 'POST' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue>;
