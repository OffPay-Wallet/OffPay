import type {
  OfflineSupportedStablecoin,
  OffpayNetwork,
  WalletActivityEvent,
  WalletBalanceResponse,
  WalletTransactionView,
  WalletTransactionsResponse,
} from '@/types/offpay-api';
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';

const LAMPORTS_PER_SOL = 1_000_000_000;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const LEGACY_NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
const NATIVE_SOL_SENTINEL_MINT = 'native-sol';
const NATIVE_SOL_NAME = 'Solana';
const NATIVE_SOL_SYMBOL = 'SOL';

export type OffpayDisplayTransactionType = 'send' | 'receive' | 'swap';
export type OffpayDisplayTone = 'positive' | 'negative' | 'neutral' | 'failed';
export type OffpayUmbraWalletActivityType =
  | 'setup'
  | 'shield'
  | 'withdraw'
  | 'claim'
  | 'private-p2p'
  | 'repair';

export interface OffpayTokenHoldingView {
  mint: string;
  priceMint: string;
  priceSymbol: string;
  symbol: string;
  name: string;
  balance: string;
  balanceValue: number;
  logo: string | null;
  usdPrice: number | null;
  verified: boolean;
  spam: boolean;
  priceChange: string | null;
}

export interface TokenLogoLookup {
  byMint?: ReadonlyMap<string, string>;
  bySymbol?: ReadonlyMap<string, string>;
}

export interface TokenMetadataView {
  name?: string;
  symbol?: string;
  decimals?: number;
  logo?: string | null;
  verified?: boolean;
}

export interface TokenMetadataLookup {
  byMint?: ReadonlyMap<string, TokenMetadataView>;
}

export interface OffpayRecentActivityView {
  id: string;
  type: OffpayDisplayTransactionType;
  title: string;
  subtitle: string;
  sourceLabel: string | null;
  amountLabel: string | null;
  secondaryAmountLabel: string | null;
  amountTone: OffpayDisplayTone;
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

export type OffpayHistoryTransactionView = OffpayRecentActivityView;

export interface OffpayHistoryTransactionGroup {
  title: string;
  data: OffpayHistoryTransactionView[];
}

export interface OffpayLocalReceiptViewInput {
  id: string;
  type?: OffpayDisplayTransactionType;
  direction?: 'send' | 'receive';
  status?: 'queued' | 'received' | 'settling' | 'settled' | 'failed';
  title: string;
  subtitle: string;
  amountLabel?: string | null;
  secondaryAmountLabel?: string | null;
  rawAmount?: string | null;
  tokenMint?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenLogo?: string | null;
  tokenDecimals?: number | null;
  createdAt: number;
  signature?: string | null;
  sender?: string | null;
  recipient?: string | null;
  network?: OffpayNetwork | null;
  routeLabel?: string | null;
  privacyLabel?: string | null;
  programLabel?: string | null;
  errorMessage?: string | null;
}

export function isOffpayOfflineP2pReceipt(
  receipt: Pick<OffpayLocalReceiptViewInput, 'id'>,
): boolean {
  const id = receipt.id.trim().toLowerCase();
  return id.startsWith('offline-send-') || id.startsWith('offline-receive-');
}

export function isOffpayLocalHistoryReceipt(
  receipt: Pick<OffpayLocalReceiptViewInput, 'id' | 'routeLabel'>,
): boolean {
  const id = receipt.id.trim().toLowerCase();
  return (
    isOffpayOfflineP2pReceipt(receipt) ||
    id.startsWith('online-send-') ||
    id.startsWith('online-receive-') ||
    id.startsWith('private-send-') ||
    id.startsWith('agentic-private-send-') ||
    id.startsWith('swap-')
  );
}

export function shortenWalletAddress(address: string, visibleChars = 4): string {
  if (address.length <= visibleChars * 2 + 3) return address;
  return `${address.slice(0, visibleChars)}...${address.slice(-visibleChars)}`;
}

export function formatLamportsAsSol(lamports: number, maxFractionDigits = 6): string {
  const sol = lamports / LAMPORTS_PER_SOL;

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: sol === 0 ? 2 : 0,
  }).format(sol);
}

export function formatTokenBalance(balance: string, maxFractionDigits = 6): string {
  const parsed = Number(balance);
  if (!Number.isFinite(parsed)) return balance;

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: parsed === 0 ? 2 : 0,
  }).format(parsed);
}

function parseNumericBalance(balance: string): number {
  const parsed = Number(balance.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function lookupTokenLogo(params: {
  mint: string;
  symbol: string;
  fallback?: string | null;
  aliases?: readonly string[];
  logos?: TokenLogoLookup;
}): string | null {
  const mintLogo = params.logos?.byMint?.get(params.mint)?.trim();
  if (mintLogo) return mintLogo;

  const symbolLogo = params.logos?.bySymbol?.get(normalizeTokenSymbol(params.symbol))?.trim();
  if (symbolLogo) return symbolLogo;

  for (const alias of params.aliases ?? []) {
    const aliasLogo = params.logos?.bySymbol?.get(normalizeTokenSymbol(alias))?.trim();
    if (aliasLogo) return aliasLogo;
  }

  const fallback = params.fallback?.trim();
  if (fallback) return fallback;

  return null;
}

function lookupTokenMetadata(
  metadata: TokenMetadataLookup | undefined,
  mint: string,
): TokenMetadataView | null {
  return metadata?.byMint?.get(mint) ?? null;
}

export function buildStablecoinMetadataLookup(
  stablecoins: readonly OfflineSupportedStablecoin[] | null | undefined,
): TokenMetadataLookup {
  if (!stablecoins || stablecoins.length === 0) {
    return { byMint: new Map<string, TokenMetadataView>() };
  }

  const byMint = new Map<string, TokenMetadataView>();
  for (const stablecoin of stablecoins) {
    if (!stablecoin.enabled || stablecoin.mint.trim().length === 0) {
      continue;
    }

    byMint.set(stablecoin.mint, {
      name: stablecoin.name ?? stablecoin.symbol,
      symbol: stablecoin.symbol,
      decimals: stablecoin.decimals,
      verified: true,
    });
  }

  return { byMint };
}

export function buildVisibleTokenHoldings(
  balance: WalletBalanceResponse,
  logos?: TokenLogoLookup,
  metadata?: TokenMetadataLookup,
): OffpayTokenHoldingView[] {
  const solHolding: OffpayTokenHoldingView = {
    mint: 'native-sol',
    priceMint: NATIVE_SOL_MINT,
    priceSymbol: 'SOL',
    symbol: 'SOL',
    name: 'Solana',
    balance: formatLamportsAsSol(balance.solBalance, 5),
    balanceValue: balance.solBalance / LAMPORTS_PER_SOL,
    logo: lookupTokenLogo({ mint: NATIVE_SOL_MINT, symbol: 'SOL', logos }),
    usdPrice:
      typeof balance.nativeSolUsdPrice === 'number' &&
      Number.isFinite(balance.nativeSolUsdPrice) &&
      balance.nativeSolUsdPrice > 0
        ? balance.nativeSolUsdPrice
        : null,
    verified: true,
    spam: false,
    priceChange: null,
  };

  const tokenHoldings = balance.tokens
    .map((token) => {
      const tokenMetadata = lookupTokenMetadata(metadata, token.mint);
      const umbraToken = getUmbraTokenByMint(balance.network, token.mint);
      const displaySymbol = tokenMetadata?.symbol ?? umbraToken?.symbol ?? token.symbol;

      return {
        token,
        metadata: tokenMetadata,
        umbraToken,
        displaySymbol,
        displayName: umbraToken?.name ?? tokenMetadata?.name ?? token.name,
        priceSymbol: tokenMetadata?.symbol ?? umbraToken?.aliases?.[0] ?? displaySymbol,
      };
    })
    .filter(
      ({ token, metadata: tokenMetadata, umbraToken }) =>
        tokenMetadata != null || umbraToken != null || !token.spam,
    )
    .sort((left, right) => {
      const leftVerified =
        left.token.verified || left.metadata?.verified === true || left.umbraToken != null;
      const rightVerified =
        right.token.verified || right.metadata?.verified === true || right.umbraToken != null;
      if (leftVerified !== rightVerified) return leftVerified ? -1 : 1;
      return left.displaySymbol.localeCompare(right.displaySymbol);
    })
    .map(
      ({
        token,
        metadata: tokenMetadata,
        umbraToken,
        displaySymbol,
        displayName,
        priceSymbol,
      }) => ({
        mint: token.mint,
        priceMint: token.mint,
        priceSymbol,
        symbol: displaySymbol,
        name: displayName,
        balance: formatTokenBalance(token.balance, 5),
        balanceValue: parseNumericBalance(token.balance),
        logo: lookupTokenLogo({
          mint: token.mint,
          symbol: displaySymbol,
          fallback: tokenMetadata?.logo ?? token.logo,
          aliases: umbraToken?.aliases,
          logos,
        }),
        usdPrice:
          typeof token.usdPrice === 'number' &&
          Number.isFinite(token.usdPrice) &&
          token.usdPrice > 0
            ? token.usdPrice
            : null,
        verified: token.verified || tokenMetadata?.verified === true || umbraToken != null,
        spam: tokenMetadata == null && umbraToken == null && token.spam,
        priceChange: null,
      }),
    );

  return [solHolding, ...tokenHoldings];
}

export function countSpamTokens(balance: WalletBalanceResponse | null | undefined): number {
  return balance?.tokens.filter((token) => token.spam).length ?? 0;
}

const GENERIC_COUNTERPARTY_ROLES = new Set([
  'account',
  'authority',
  'counterparty',
  'destination',
  'from',
  'owner',
  'payer',
  'receiver',
  'recipient',
  'sender',
  'source',
  'to',
  'unknown',
  'wallet',
]);
const SEND_COUNTERPARTY_ROLE_PATTERN = /\b(recipient|receiver|destination|to)\b/;
const RECEIVE_COUNTERPARTY_ROLE_PATTERN = /\b(sender|source|from|payer)\b/;
const ROUTE_COUNTERPARTY_ROLE_PATTERN = /\b(route|program|protocol|provider)\b/;
const SWAP_SIGNAL_PATTERN =
  /(?:^|[^a-z0-9])(swap|swapped|jupiter|raydium|orca|meteora|phoenix|openbook)(?:$|[^a-z0-9])/i;

type CounterpartySignal = {
  role: string;
  address?: string | null;
};

function normalizeCounterpartyRole(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function roleMatchesCounterparty(role: string, pattern: RegExp): boolean {
  return pattern.test(normalizeCounterpartyRole(role));
}

function isGenericCounterpartyRole(role: string): boolean {
  const normalizedRole = normalizeCounterpartyRole(role);
  return (
    GENERIC_COUNTERPARTY_ROLES.has(normalizedRole) ||
    roleMatchesCounterparty(role, SEND_COUNTERPARTY_ROLE_PATTERN) ||
    roleMatchesCounterparty(role, RECEIVE_COUNTERPARTY_ROLE_PATTERN)
  );
}

function hasSwapSignal(
  type: string,
  description: string | null | undefined,
  counterparties: readonly CounterpartySignal[] = [],
): boolean {
  const counterpartySignal = counterparties
    .map((counterparty) => `${counterparty.role} ${counterparty.address ?? ''}`)
    .join(' ');

  return SWAP_SIGNAL_PATTERN.test(`${type} ${description ?? ''} ${counterpartySignal}`);
}

function getExplicitTransferDirection(
  direction: 'send' | 'receive' | null | undefined,
): OffpayDisplayTransactionType | null {
  return direction === 'send' || direction === 'receive' ? direction : null;
}

function normalizeTransactionType(
  type: string,
  description: string | null | undefined,
  amounts: readonly ParsedTokenAmount[],
  counterparties: readonly CounterpartySignal[] = [],
): OffpayDisplayTransactionType {
  if (hasSwapSignal(type, description, counterparties)) {
    return 'swap';
  }

  const normalized = `${type} ${description ?? ''}`.toLowerCase();

  if (amounts.length >= 2 && /\bto\b|\bfor\b/.test(description ?? '')) {
    return 'swap';
  }

  if (
    normalized.includes('receive') ||
    normalized.includes('deposit') ||
    normalized.includes('inbound')
  ) {
    return 'receive';
  }

  const firstRawAmount = amounts[0]?.rawAmount;
  if (firstRawAmount?.startsWith('+')) return 'receive';

  const hasSenderCounterparty = counterparties.some((counterparty) =>
    roleMatchesCounterparty(counterparty.role, RECEIVE_COUNTERPARTY_ROLE_PATTERN),
  );
  const hasRecipientCounterparty = counterparties.some((counterparty) =>
    roleMatchesCounterparty(counterparty.role, SEND_COUNTERPARTY_ROLE_PATTERN),
  );

  if (hasSenderCounterparty !== hasRecipientCounterparty) {
    return hasSenderCounterparty ? 'receive' : 'send';
  }

  return 'send';
}

function normalizeWalletTransactionDisplayType(
  transaction: WalletTransactionsResponse['transactions'][number],
  amounts: readonly ParsedTokenAmount[],
  counterparties: WalletTransactionsResponse['transactions'][number]['counterparties'],
): OffpayDisplayTransactionType {
  const inferred = normalizeTransactionType(
    transaction.type,
    transaction.description,
    amounts,
    counterparties,
  );
  if (inferred === 'swap') return 'swap';

  return getExplicitTransferDirection(transaction.direction) ?? inferred;
}

function normalizeWalletActivityDisplayType(
  event: WalletActivityEvent,
  amounts: readonly ParsedTokenAmount[],
): OffpayDisplayTransactionType {
  const inferred = normalizeTransactionType(
    event.type,
    event.description,
    amounts,
    getWalletActivityCounterparties(event),
  );
  if (inferred === 'swap') return 'swap';

  return getExplicitTransferDirection(event.direction) ?? inferred;
}

function getTransactionTitle(
  type: OffpayDisplayTransactionType,
  status: 'success' | 'failed',
): string {
  if (status === 'failed') return 'Failed';
  if (type === 'receive') return 'Received';
  if (type === 'swap') return 'Swapped';
  return 'Sent';
}

function prettifyTransactionType(type: string): string {
  return type
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

interface ParsedTokenAmount {
  rawAmount: string;
  amount: string;
  symbol: string;
}

interface TransactionTokenMetadata {
  mint: string | null;
  symbol: string | null;
  name: string | null;
  logo: string | null;
}

export interface WalletTransactionTokenFilter {
  mint: string | null | undefined;
  symbol: string | null | undefined;
}

const TOKEN_AMOUNT_PATTERN = /([+-]?\d[\d,]*(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9]{1,15})/g;

function normalizeTokenSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isNativeSolMint(mint: string | null | undefined): boolean {
  const normalized = mint?.trim();
  return (
    normalized === NATIVE_SOL_MINT ||
    normalized === LEGACY_NATIVE_SOL_MINT ||
    normalized === NATIVE_SOL_SENTINEL_MINT
  );
}

function normalizeTransactionTokenMint(mint: string | null | undefined): string | null {
  const trimmed = mint?.trim();
  if (trimmed == null || trimmed.length === 0) return null;
  return isNativeSolMint(trimmed) ? NATIVE_SOL_MINT : trimmed;
}

function getKnownTransactionTokenMetadata(
  network: OffpayNetwork | null | undefined,
  mint: string | null | undefined,
): Pick<TransactionTokenMetadata, 'symbol' | 'name'> | null {
  const normalizedMint = normalizeTransactionTokenMint(mint);
  if (normalizedMint == null) return null;
  if (normalizedMint === NATIVE_SOL_MINT)
    return { symbol: NATIVE_SOL_SYMBOL, name: NATIVE_SOL_NAME };
  if (network == null) return null;

  const umbraToken = getUmbraTokenByMint(network, normalizedMint);
  if (umbraToken == null) return null;

  return {
    symbol: umbraToken.symbol,
    name: umbraToken.name,
  };
}

function resolveTransactionTokenSymbol(
  symbol: string | null | undefined,
  mint: string | null | undefined,
  fallback: string | null = null,
  network?: OffpayNetwork | null,
): string | null {
  const knownToken = getKnownTransactionTokenMetadata(network, mint);
  if (knownToken?.symbol != null) return knownToken.symbol;

  const trimmedSymbol = symbol?.trim();
  if (trimmedSymbol != null && trimmedSymbol.length > 0) {
    return normalizeTokenSymbol(trimmedSymbol);
  }
  if (isNativeSolMint(mint)) return NATIVE_SOL_SYMBOL;
  return fallback;
}

function resolveTransactionTokenName(
  name: string | null | undefined,
  symbol: string | null,
  mint?: string | null,
  network?: OffpayNetwork | null,
): string | null {
  const knownToken = getKnownTransactionTokenMetadata(network, mint);
  if (knownToken?.name != null) return knownToken.name;

  const trimmedName = name?.trim();
  if (trimmedName != null && trimmedName.length > 0) return trimmedName;
  if (symbol === NATIVE_SOL_SYMBOL) return NATIVE_SOL_NAME;
  return symbol;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTrailingTokenLabel(
  label: string | null,
  nextSymbol: string,
  previousLabels: readonly string[],
): string | null {
  if (label == null) return null;

  for (const previousLabel of previousLabels) {
    const previous = previousLabel.trim();
    if (previous.length === 0 || previous.toUpperCase() === nextSymbol.toUpperCase()) {
      continue;
    }

    const replaced: string = label.replace(
      new RegExp(`\\s${escapeRegExp(previous)}$`, 'i'),
      ` ${nextSymbol}`,
    );
    if (replaced !== label) return replaced;
  }

  return label;
}

function applyKnownTokenMetadataToDisplayView(
  view: OffpayRecentActivityView,
  network?: OffpayNetwork | null,
): OffpayRecentActivityView {
  const knownToken = getKnownTransactionTokenMetadata(network, view.tokenMint);
  if (knownToken == null || knownToken.symbol == null) return view;

  const shortenedMint = view.tokenMint == null ? null : shortenWalletAddress(view.tokenMint);
  const previousLabels = [
    view.tokenSymbol,
    view.tokenName,
    shortenedMint,
    shortenedMint?.toUpperCase(),
  ].flatMap((value) => {
    const trimmed = value?.trim();
    return trimmed == null || trimmed.length === 0 ? [] : [trimmed];
  });

  return {
    ...view,
    amountLabel: replaceTrailingTokenLabel(view.amountLabel, knownToken.symbol, previousLabels),
    secondaryAmountLabel: replaceTrailingTokenLabel(
      view.secondaryAmountLabel,
      knownToken.symbol,
      previousLabels,
    ),
    tokenSymbol: knownToken.symbol,
    tokenName: knownToken.name,
  };
}

function hasRawWalletTransactionAmountSignal(
  transaction: WalletTransactionsResponse['transactions'][number],
): boolean {
  return Boolean(transaction.amount?.trim() || transaction.rawAmount?.trim());
}

function isNativeSolTransferDescription(description: string | null | undefined): boolean {
  return description?.trim().toLowerCase() === 'native token transfer';
}

function isFeeOnlyDescription(description: string | null | undefined): boolean {
  const normalized = description?.trim().toLowerCase();
  if (normalized == null || !/\bfee\b/.test(normalized)) return false;
  return !/\b(?:send|sent|receive|received|transfer|transferred|native)\b/.test(normalized);
}

export function walletTransactionMatchesTokenFilter(
  transaction: WalletTransactionsResponse['transactions'][number],
  filter: WalletTransactionTokenFilter,
): boolean {
  const transactionMint = normalizeTransactionTokenMint(transaction.tokenMint);
  const transactionSymbol = resolveTransactionTokenSymbol(
    transaction.tokenSymbol,
    transaction.tokenMint,
  );
  const filterMint = normalizeTransactionTokenMint(filter.mint);
  const filterSymbol = normalizeTokenSymbol(filter.symbol ?? '');
  const filterIsNativeSol = isNativeSolMint(filter.mint) || filterSymbol === NATIVE_SOL_SYMBOL;

  if (filterIsNativeSol) {
    if (transactionMint === NATIVE_SOL_MINT) return true;
    if (transactionSymbol === NATIVE_SOL_SYMBOL) return true;
    if (transactionMint != null || transactionSymbol != null) return false;

    const descriptionAmounts = parseTokenAmounts(transaction.description);
    if (descriptionAmounts.some((amount) => amount.symbol === NATIVE_SOL_SYMBOL)) {
      return !isFeeOnlyDescription(transaction.description);
    }
    if (descriptionAmounts.length > 0) return false;

    if (isNativeSolTransferDescription(transaction.description)) return true;

    return hasRawWalletTransactionAmountSignal(transaction);
  }

  return (
    (filterMint != null && transactionMint === filterMint) ||
    (filterSymbol.length > 0 && transactionSymbol === filterSymbol)
  );
}

function getHistoryTransactionAmountSymbols(
  transaction: Pick<OffpayHistoryTransactionView, 'amountLabel' | 'secondaryAmountLabel'>,
): Set<string> {
  const symbols = new Set<string>();
  for (const label of [transaction.amountLabel, transaction.secondaryAmountLabel]) {
    for (const amount of parseTokenAmounts(label)) {
      symbols.add(amount.symbol);
    }
  }
  return symbols;
}

export function walletHistoryTransactionMatchesTokenFilter(
  transaction: Pick<
    OffpayHistoryTransactionView,
    'amountLabel' | 'secondaryAmountLabel' | 'tokenMint' | 'tokenSymbol'
  >,
  filter: WalletTransactionTokenFilter,
): boolean {
  const transactionMint = normalizeTransactionTokenMint(transaction.tokenMint);
  const transactionSymbol = resolveTransactionTokenSymbol(
    transaction.tokenSymbol,
    transaction.tokenMint,
  );
  const filterMint = normalizeTransactionTokenMint(filter.mint);
  const filterSymbol = normalizeTokenSymbol(filter.symbol ?? '');
  const filterIsNativeSol = isNativeSolMint(filter.mint) || filterSymbol === NATIVE_SOL_SYMBOL;
  const amountSymbols = getHistoryTransactionAmountSymbols(transaction);

  if (filterIsNativeSol) {
    return (
      transactionMint === NATIVE_SOL_MINT ||
      transactionSymbol === NATIVE_SOL_SYMBOL ||
      amountSymbols.has(NATIVE_SOL_SYMBOL)
    );
  }

  return (
    (filterMint != null && transactionMint === filterMint) ||
    (filterSymbol.length > 0 &&
      (transactionSymbol === filterSymbol || amountSymbols.has(filterSymbol)))
  );
}

function normalizeTransactionTypeLabel(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isInternalWalletTransactionType(type: string): boolean {
  const normalized = normalizeTransactionTypeLabel(type);
  const compact = normalized.replace(/_/g, '');

  return compact.includes('commitstate');
}

function isUmbraSetupTransactionType(type: string): boolean {
  const normalized = normalizeTransactionTypeLabel(type);
  return (
    normalized === 'umbra_setup' ||
    normalized === 'umbra_registration' ||
    normalized === 'umbra_private_account_setup' ||
    normalized === 'umbra_vault_setup' ||
    normalized === 'vault_setup' ||
    (normalized.includes('umbra') && normalized.includes('registration'))
  );
}

function normalizedTextHasSegment(text: string, segments: readonly string[]): boolean {
  const parts = text.split('_').filter(Boolean);
  return segments.some((segment) => parts.includes(segment));
}

function normalizedTextHasAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function getUmbraWalletActivityType(
  activity: Pick<WalletActivityEvent, 'type' | 'description'>,
): OffpayUmbraWalletActivityType | null {
  const normalizedType = normalizeTransactionTypeLabel(activity.type);
  const normalizedDescription = normalizeTransactionTypeLabel(activity.description ?? '');
  const normalizedText = [normalizedType, normalizedDescription].filter(Boolean).join('_');
  const compactText = normalizedText.replace(/_/g, '');
  const hasUmbraSignal =
    normalizedTextHasAny(normalizedText, [
      'umbra',
      'arcium',
      'shield',
      'vault',
      'encrypted_balance',
      'stealth',
      'utxo',
      'nullifier',
      'claimable',
    ]) ||
    (normalizedText.includes('private') &&
      normalizedTextHasSegment(normalizedText, ['claim', 'claimed', 'claims']));

  if (!hasUmbraSignal) return null;

  if (
    isUmbraSetupTransactionType(activity.type) ||
    (normalizedTextHasAny(normalizedText, ['account_setup', 'vault_setup', 'registration']) &&
      normalizedTextHasAny(normalizedText, ['umbra', 'vault']))
  ) {
    return 'setup';
  }

  if (
    normalizedTextHasAny(normalizedText, [
      'key_repair',
      'key_rotation',
      'mint_encryption_key',
      'rotate_key',
    ]) ||
    normalizedTextHasSegment(normalizedText, ['repair', 'repaired'])
  ) {
    return 'repair';
  }

  if (
    normalizedTextHasAny(normalizedText, [
      'receiver_claimable_utxo_creator',
      'claimable_utxo_creator',
      'create_receiver_claimable',
      'create_claimable',
      'private_p2p',
      'p2p_send',
    ]) ||
    (normalizedTextHasSegment(normalizedText, ['creator', 'create', 'created']) &&
      normalizedText.includes('claimable'))
  ) {
    return 'private-p2p';
  }

  if (
    normalizedTextHasAny(normalizedText, [
      'to_encrypted_balance_claimer',
      'claimable_utxo_to_encrypted',
      'claim_private_payment',
      'pending_claim',
    ]) ||
    normalizedTextHasSegment(normalizedText, [
      'claim',
      'claimed',
      'claims',
      'claimer',
      'burner',
      'nullifier',
    ])
  ) {
    return 'claim';
  }

  if (
    normalizedTextHasAny(normalizedText, [
      'encrypted_balance_to_public',
      'private_to_public',
      'eta_into_ata',
    ]) ||
    compactText.includes('encryptedbalancetopublic') ||
    compactText.includes('etaintoata') ||
    normalizedTextHasSegment(normalizedText, ['withdraw', 'withdrew', 'withdrawal', 'unshield'])
  ) {
    return 'withdraw';
  }

  if (
    normalizedTextHasAny(normalizedText, [
      'public_balance_to_encrypted',
      'public_to_private',
      'ata_into_eta',
    ]) ||
    compactText.includes('publicbalancetoencrypted') ||
    compactText.includes('ataintoeta') ||
    normalizedTextHasSegment(normalizedText, [
      'shield',
      'shielded',
      'deposit',
      'deposited',
      'depositor',
    ])
  ) {
    return 'shield';
  }

  return null;
}

function parseTokenAmounts(description: string | null): ParsedTokenAmount[] {
  if (description == null) return [];

  const matches: ParsedTokenAmount[] = [];
  for (const match of description.matchAll(TOKEN_AMOUNT_PATTERN)) {
    const rawAmount = match[1]?.replace(/,/g, '') ?? '';
    const symbol = normalizeTokenSymbol(match[2] ?? '');
    const parsed = Number(rawAmount);

    if (!Number.isFinite(parsed) || symbol.length === 0) continue;

    matches.push({
      rawAmount,
      amount: formatTokenAmount(String(Math.abs(parsed))),
      symbol,
    });
  }

  return matches;
}

function parseWalletActivityAmounts(event: WalletActivityEvent): ParsedTokenAmount[] {
  const descriptionAmounts = parseTokenAmounts(event.description);
  if (descriptionAmounts.length > 0) return descriptionAmounts;

  const rawAmount =
    event.amount?.trim() || formatRawTokenAmount(event.rawAmount, event.tokenDecimals) || null;
  const symbol = resolveTransactionTokenSymbol(event.tokenSymbol, event.tokenMint);
  if (rawAmount == null || rawAmount.length === 0 || symbol == null || symbol.length === 0) {
    return [];
  }

  const parsed = Number(rawAmount.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return [];

  return [
    {
      rawAmount: event.direction === 'receive' ? `+${Math.abs(parsed)}` : `-${Math.abs(parsed)}`,
      amount: formatTokenAmount(String(Math.abs(parsed))),
      symbol,
    },
  ];
}

function formatRawTokenAmount(
  rawAmount: string | null | undefined,
  decimals: number | null | undefined,
): string | null {
  const trimmed = rawAmount?.trim();
  if (trimmed == null || !/^-?\d+$/.test(trimmed)) return null;
  const normalizedDecimals =
    typeof decimals === 'number' && Number.isFinite(decimals) && decimals > 0
      ? Math.trunc(decimals)
      : 0;
  const atomic = BigInt(trimmed);
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const scale = 10n ** BigInt(normalizedDecimals);
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const sign = negative ? '-' : '';

  if (normalizedDecimals === 0 || fraction === 0n) return `${sign}${whole.toString()}`;

  return `${sign}${whole.toString()}.${fraction
    .toString()
    .padStart(normalizedDecimals, '0')
    .replace(/0+$/, '')}`;
}

function parseWalletTransactionAmounts(
  transaction: WalletTransactionsResponse['transactions'][number],
  network?: OffpayNetwork | null,
): ParsedTokenAmount[] {
  const descriptionAmounts = parseTokenAmounts(transaction.description);
  if (descriptionAmounts.length > 0) return descriptionAmounts;

  const rawAmount =
    transaction.amount?.trim() ||
    formatRawTokenAmount(transaction.rawAmount, transaction.tokenDecimals) ||
    null;
  const symbol = resolveTransactionTokenSymbol(
    transaction.tokenSymbol,
    transaction.tokenMint,
    null,
    network,
  );
  if (rawAmount == null || rawAmount.length === 0 || symbol == null || symbol.length === 0) {
    return [];
  }

  const parsed = Number(rawAmount.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return [];

  const direction = transaction.direction === 'receive' ? 'receive' : 'send';
  return [
    {
      rawAmount: direction === 'receive' ? `+${Math.abs(parsed)}` : `-${Math.abs(parsed)}`,
      amount: formatTokenAmount(String(Math.abs(parsed))),
      symbol,
    },
  ];
}

function formatTokenAmount(rawAmount: string): string {
  const parsed = Number(rawAmount);
  if (!Number.isFinite(parsed)) return rawAmount;

  const normalized = Object.is(parsed, -0) ? 0 : parsed;
  if (normalized !== 0 && Math.abs(normalized) < 0.000001) {
    return '<0.000001';
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  }).format(normalized);
}

function formatDateTitle(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function buildCounterpartyName(
  counterparty: WalletTransactionsResponse['transactions'][number]['counterparties'][number],
): string {
  const address = shortenWalletAddress(counterparty.address);
  const role = counterparty.role.trim();

  if (role.length > 0 && !isGenericCounterpartyRole(role)) {
    return `${role} (${address})`;
  }

  return address;
}

function findCounterpartyForSubtitle(
  type: OffpayDisplayTransactionType,
  counterparties: WalletTransactionsResponse['transactions'][number]['counterparties'],
): WalletTransactionsResponse['transactions'][number]['counterparties'][number] | null {
  const directionalPattern =
    type === 'send'
      ? SEND_COUNTERPARTY_ROLE_PATTERN
      : type === 'receive'
        ? RECEIVE_COUNTERPARTY_ROLE_PATTERN
        : null;

  if (directionalPattern != null) {
    const directionalCounterparty = counterparties.find((counterparty) =>
      roleMatchesCounterparty(counterparty.role, directionalPattern),
    );
    if (directionalCounterparty != null) return directionalCounterparty;
  }

  return (
    counterparties.find(
      (counterparty) =>
        !roleMatchesCounterparty(counterparty.role, ROUTE_COUNTERPARTY_ROLE_PATTERN),
    ) ??
    counterparties[0] ??
    null
  );
}

function buildCounterpartySubtitle(
  type: OffpayDisplayTransactionType,
  counterparties: WalletTransactionsResponse['transactions'][number]['counterparties'],
  signature: string,
  description: string | null,
): string {
  const counterparty = findCounterpartyForSubtitle(type, counterparties);
  const direction = type === 'receive' ? 'From' : type === 'send' ? 'To' : 'With';

  if (counterparty != null) {
    return `${direction} ${buildCounterpartyName(counterparty)}`;
  }

  if (description != null && /multiple accounts/i.test(description)) {
    return `${direction} multiple accounts`;
  }

  return `Tx ${shortenWalletAddress(signature, 4)}`;
}

function getDetailAccountLabel(type: OffpayDisplayTransactionType): string {
  if (type === 'receive') return 'From';
  if (type === 'send') return 'To';
  return 'With';
}

function getReceiptDetailAccountAddress(
  receipt: OffpayLocalReceiptViewInput,
  type: OffpayDisplayTransactionType,
): string | null {
  const address = type === 'receive' ? receipt.sender : receipt.recipient;
  return address?.trim() || null;
}

function getLocalReceiptDisplayType(
  receipt: OffpayLocalReceiptViewInput,
): OffpayDisplayTransactionType {
  if (receipt.type === 'send' || receipt.type === 'receive' || receipt.type === 'swap') {
    return receipt.type;
  }

  return receipt.direction === 'send' ? 'send' : 'receive';
}

function getLocalReceiptDisplayDirection(
  receipt: OffpayLocalReceiptViewInput,
  type: OffpayDisplayTransactionType,
): 'send' | 'receive' {
  if (receipt.direction === 'send' || receipt.direction === 'receive') {
    return receipt.direction;
  }

  return type === 'receive' ? 'receive' : 'send';
}

function getLocalReceiptTokenMetadata(
  receipt: OffpayLocalReceiptViewInput,
): TransactionTokenMetadata {
  const mint = normalizeTransactionTokenMint(receipt.tokenMint);
  const symbol = resolveTransactionTokenSymbol(receipt.tokenSymbol, mint, null, receipt.network);
  const name = resolveTransactionTokenName(receipt.tokenName, symbol, mint, receipt.network);
  const logo = receipt.tokenLogo?.trim() || null;

  return {
    mint,
    symbol,
    name,
    logo,
  };
}

function formatLocalReceiptAmountLabel(
  receipt: OffpayLocalReceiptViewInput,
  type: OffpayDisplayTransactionType,
): string | null {
  const explicitLabel = receipt.amountLabel?.trim();
  if (explicitLabel) return explicitLabel;

  const token = getLocalReceiptTokenMetadata(receipt);
  if (token.symbol == null) return null;

  const amount = formatRawTokenAmount(receipt.rawAmount, receipt.tokenDecimals);
  if (amount == null) return null;

  const parsed = Number(amount.replace(/,/g, ''));
  const absoluteAmount = Number.isFinite(parsed)
    ? formatTokenAmount(String(Math.abs(parsed)))
    : amount.replace(/^[+-]/, '');
  const direction = getLocalReceiptDisplayDirection(receipt, type);
  const sign = type === 'swap' ? '+' : direction === 'receive' ? '+' : '-';

  return `${sign}${absoluteAmount} ${token.symbol}`;
}

function getTransactionDetailAccountAddress(
  type: OffpayDisplayTransactionType,
  counterparties: WalletTransactionsResponse['transactions'][number]['counterparties'],
): string | null {
  const counterparty = findCounterpartyForSubtitle(type, counterparties);
  return counterparty?.address?.trim() || null;
}

function getWalletTransactionCounterparties(
  transaction: WalletTransactionsResponse['transactions'][number],
): WalletTransactionsResponse['transactions'][number]['counterparties'] {
  const counterparties = [...transaction.counterparties];
  const addCounterparty = (address: string | null | undefined, role: string): void => {
    const trimmed = address?.trim();
    if (trimmed == null || trimmed.length === 0) return;
    if (counterparties.some((counterparty) => counterparty.address === trimmed)) return;
    counterparties.push({ address: trimmed, role });
  };

  addCounterparty(transaction.sender, 'sender');
  addCounterparty(transaction.recipient, 'recipient');

  return counterparties;
}

function buildSwapSubtitle(amounts: ParsedTokenAmount[]): string | null {
  const [input, output] = amounts;
  if (input == null || output == null) return null;

  return `${input.amount} ${input.symbol} to ${output.amount} ${output.symbol}`;
}

function buildAmountDisplay(
  type: OffpayDisplayTransactionType,
  status: 'success' | 'failed',
  amounts: ParsedTokenAmount[],
  tokenMetadata?: TransactionTokenMetadata,
): Pick<
  OffpayHistoryTransactionView,
  | 'amountLabel'
  | 'secondaryAmountLabel'
  | 'amountTone'
  | 'tokenMint'
  | 'tokenSymbol'
  | 'tokenName'
  | 'tokenLogo'
> {
  const primarySymbol = tokenMetadata?.symbol ?? amounts[0]?.symbol ?? null;
  const primaryName = tokenMetadata?.name ?? primarySymbol;

  if (status === 'failed') {
    return {
      amountLabel: 'Failed',
      secondaryAmountLabel: null,
      amountTone: 'failed',
      tokenMint: tokenMetadata?.mint ?? null,
      tokenSymbol: primarySymbol,
      tokenName: primaryName,
      tokenLogo: tokenMetadata?.logo ?? null,
    };
  }

  if (type === 'swap') {
    const [input, output] = amounts;
    if (input != null && output != null) {
      const outputMetadataMatches = tokenMetadata?.symbol === output.symbol;
      return {
        amountLabel: `+${output.amount} ${output.symbol}`,
        secondaryAmountLabel: `-${input.amount} ${input.symbol}`,
        amountTone: 'positive',
        tokenMint: outputMetadataMatches ? (tokenMetadata.mint ?? null) : null,
        tokenSymbol: output.symbol,
        tokenName: outputMetadataMatches ? (tokenMetadata.name ?? output.symbol) : output.symbol,
        tokenLogo: outputMetadataMatches ? (tokenMetadata.logo ?? null) : null,
      };
    }

    if (input != null) {
      const sign = input.rawAmount.startsWith('+')
        ? '+'
        : input.rawAmount.startsWith('-')
          ? '-'
          : '';
      return {
        amountLabel: `${sign}${input.amount} ${input.symbol}`,
        secondaryAmountLabel: null,
        amountTone: sign === '+' ? 'positive' : sign === '-' ? 'negative' : 'neutral',
        tokenMint: tokenMetadata?.mint ?? null,
        tokenSymbol: input.symbol,
        tokenName: tokenMetadata?.name ?? input.symbol,
        tokenLogo: tokenMetadata?.logo ?? null,
      };
    }
  }

  const amount = amounts[0];
  if (amount == null) {
    return {
      amountLabel: null,
      secondaryAmountLabel: null,
      amountTone: 'neutral',
      tokenMint: tokenMetadata?.mint ?? null,
      tokenSymbol: primarySymbol,
      tokenName: primaryName,
      tokenLogo: tokenMetadata?.logo ?? null,
    };
  }

  const sign = type === 'receive' ? '+' : '-';
  return {
    amountLabel: `${sign}${amount.amount} ${amount.symbol}`,
    secondaryAmountLabel: null,
    amountTone: type === 'receive' ? 'positive' : 'negative',
    tokenMint: tokenMetadata?.mint ?? null,
    tokenSymbol: primarySymbol ?? amount.symbol,
    tokenName: primaryName ?? amount.symbol,
    tokenLogo: tokenMetadata?.logo ?? null,
  };
}

function getWalletTransactionTokenMetadata(
  transaction: WalletTransactionsResponse['transactions'][number],
  amounts: ParsedTokenAmount[],
  network?: OffpayNetwork | null,
): TransactionTokenMetadata {
  const fallbackSymbol = amounts[0]?.symbol ?? null;
  const tokenSymbol = resolveTransactionTokenSymbol(
    transaction.tokenSymbol,
    transaction.tokenMint,
    fallbackSymbol,
    network,
  );
  const tokenName = resolveTransactionTokenName(
    transaction.tokenName,
    tokenSymbol,
    transaction.tokenMint,
    network,
  );
  const tokenMint =
    normalizeTransactionTokenMint(transaction.tokenMint) ??
    (tokenSymbol === NATIVE_SOL_SYMBOL ? NATIVE_SOL_MINT : null);
  const tokenLogo = transaction.tokenLogo?.trim() || null;

  return {
    mint: tokenMint,
    symbol: tokenSymbol,
    name: tokenName ?? null,
    logo: tokenLogo,
  };
}

function getWalletActivityTokenMetadata(
  event: WalletActivityEvent,
  amounts: ParsedTokenAmount[],
): TransactionTokenMetadata {
  const fallbackSymbol = amounts[0]?.symbol ?? null;
  const tokenSymbol = resolveTransactionTokenSymbol(
    event.tokenSymbol,
    event.tokenMint,
    fallbackSymbol,
  );
  const tokenName = resolveTransactionTokenName(event.tokenName, tokenSymbol);
  const tokenMint =
    normalizeTransactionTokenMint(event.tokenMint) ??
    (tokenSymbol === NATIVE_SOL_SYMBOL ? NATIVE_SOL_MINT : null);
  const tokenLogo = event.tokenLogo?.trim() || null;

  return {
    mint: tokenMint,
    symbol: tokenSymbol,
    name: tokenName ?? null,
    logo: tokenLogo,
  };
}

function getWalletActivityCounterparties(event: WalletActivityEvent): readonly { role: string }[] {
  if (event.counterparties != null && event.counterparties.length > 0) {
    return event.counterparties;
  }

  if (event.direction === 'receive') return [{ role: 'sender' }];
  if (event.direction === 'send') return [{ role: 'recipient' }];
  return [];
}

function isGenericTransactionSubtitle(subtitle: string): boolean {
  return /^Tx\s+\S+\.\.\.\S+$/i.test(subtitle);
}

function mergeLocalReceiptData<T extends OffpayRecentActivityView | OffpayHistoryTransactionView>(
  view: T,
  receipt: OffpayLocalReceiptViewInput | null | undefined,
): T {
  if (receipt == null) return view;

  const receiptAmountLabel = formatLocalReceiptAmountLabel(receipt, view.type);
  const receiptToken = getLocalReceiptTokenMetadata(receipt);
  const receiptDisplayType = getLocalReceiptDisplayType(receipt);
  const receiptDirection = getLocalReceiptDisplayDirection(receipt, receiptDisplayType);
  const receiptSecondaryAmountLabel = receipt.secondaryAmountLabel?.trim() || null;
  const shouldUseReceiptTone =
    view.amountLabel == null && (receipt.direction != null || receipt.type != null);
  const privateRouteReceipt = receipt.privacyLabel?.trim().toLowerCase() === 'private route';
  const receiptAccountAddress = getReceiptDetailAccountAddress(receipt, view.type);
  const shouldUseReceiptSubtitle =
    !privateRouteReceipt && view.amountLabel == null && isGenericTransactionSubtitle(view.subtitle);
  const receiptSourceLabel =
    receipt.routeLabel?.trim() || (isOffpayOfflineP2pReceipt(receipt) ? 'Offline P2P' : null);

  return {
    ...view,
    subtitle: shouldUseReceiptSubtitle ? receipt.subtitle : view.subtitle,
    sourceLabel: view.sourceLabel ?? receiptSourceLabel,
    amountLabel: view.amountLabel ?? receiptAmountLabel,
    secondaryAmountLabel: view.secondaryAmountLabel ?? receiptSecondaryAmountLabel,
    amountTone: shouldUseReceiptTone
      ? receiptDisplayType === 'swap'
        ? 'positive'
        : receiptDirection === 'receive'
          ? 'positive'
          : 'negative'
      : view.amountTone,
    tokenMint: view.tokenMint ?? receiptToken.mint,
    tokenSymbol: view.tokenSymbol ?? receiptToken.symbol,
    tokenName: view.tokenName ?? receiptToken.name,
    tokenLogo: view.tokenLogo ?? receiptToken.logo,
    detailTimestampMs: view.detailTimestampMs ?? receipt.createdAt,
    detailNetwork: view.detailNetwork ?? receipt.network ?? null,
    detailSignature: view.detailSignature ?? receipt.signature?.trim() ?? null,
    detailAccountLabel: view.detailAccountLabel ?? getDetailAccountLabel(view.type),
    detailAccountAddress: view.detailAccountAddress ?? receiptAccountAddress,
  };
}

const UNENRICHED_TRANSACTION_TYPE = 'unknown';

function isUnenrichedWalletTransaction(
  transaction: WalletTransactionsResponse['transactions'][number],
): boolean {
  return normalizeTransactionTypeLabel(transaction.type) === UNENRICHED_TRANSACTION_TYPE;
}

function isUnenrichedWalletActivityEvent(event: WalletActivityEvent): boolean {
  return normalizeTransactionTypeLabel(event.type) === UNENRICHED_TRANSACTION_TYPE;
}

function getBackendWalletTransactionDisplayView(
  transaction: WalletTransactionsResponse['transactions'][number],
  network?: OffpayNetwork | null,
): OffpayRecentActivityView | null {
  const display: WalletTransactionView | null | undefined = transaction.display;
  if (display == null) return null;
  const normalizedDisplay = applyKnownTokenMetadataToDisplayView(display, network);

  return {
    ...normalizedDisplay,
    detailTimestampMs: normalizedDisplay.detailTimestampMs ?? transaction.timestamp * 1000,
    detailNetwork: normalizedDisplay.detailNetwork ?? network ?? null,
    detailSignature: normalizedDisplay.detailSignature ?? transaction.signature,
  };
}

export function mapWalletTransactionForRecentActivity(
  transaction: WalletTransactionsResponse['transactions'][number],
  localReceipt?: OffpayLocalReceiptViewInput | null,
  network?: OffpayNetwork | null,
): OffpayRecentActivityView {
  const backendView = getBackendWalletTransactionDisplayView(transaction, network);
  if (backendView != null) {
    return mergeLocalReceiptData(backendView, localReceipt);
  }

  const amounts = parseWalletTransactionAmounts(transaction, network);
  const counterparties = getWalletTransactionCounterparties(transaction);
  const type = normalizeWalletTransactionDisplayType(transaction, amounts, counterparties);
  const amountDisplay = buildAmountDisplay(
    type,
    transaction.status,
    amounts,
    getWalletTransactionTokenMetadata(transaction, amounts, network),
  );
  const swapSubtitle = type === 'swap' ? buildSwapSubtitle(amounts) : null;

  return mergeLocalReceiptData(
    {
      id: transaction.signature,
      type,
      title: getTransactionTitle(type, transaction.status),
      subtitle:
        swapSubtitle ??
        buildCounterpartySubtitle(
          type,
          counterparties,
          transaction.signature,
          transaction.description,
        ),
      sourceLabel: null,
      ...amountDisplay,
      status: transaction.status === 'failed' ? 'failed' : 'confirmed',
      detailTimestampMs: transaction.timestamp * 1000,
      detailNetwork: network ?? localReceipt?.network ?? null,
      detailSignature: transaction.signature,
      detailAccountLabel: getDetailAccountLabel(type),
      detailAccountAddress: getTransactionDetailAccountAddress(type, counterparties),
    },
    localReceipt,
  );
}

export function mapWalletActivityEventForRecentActivity(
  event: WalletActivityEvent,
): OffpayRecentActivityView {
  const amounts = parseWalletActivityAmounts(event);
  const type = normalizeWalletActivityDisplayType(event, amounts);
  const amountDisplay = buildAmountDisplay(
    type,
    'success',
    amounts,
    getWalletActivityTokenMetadata(event, amounts),
  );
  const swapSubtitle = type === 'swap' ? buildSwapSubtitle(amounts) : null;

  return {
    id: event.signature,
    type,
    title: getTransactionTitle(type, 'success'),
    subtitle: swapSubtitle ?? prettifyTransactionType(event.type),
    sourceLabel: null,
    ...amountDisplay,
    status: 'pending',
    detailTimestampMs: event.timestamp * 1000,
    detailNetwork: null,
    detailSignature: event.signature,
    detailAccountLabel: getDetailAccountLabel(type),
    detailAccountAddress: null,
  };
}

export function isWalletTransactionIncomingP2pTransfer(
  transaction: WalletTransactionsResponse['transactions'][number],
): boolean {
  if (!isDisplayableWalletPaymentTransaction(transaction)) return false;

  const amounts = parseWalletTransactionAmounts(transaction);
  const type = normalizeWalletTransactionDisplayType(
    transaction,
    amounts,
    getWalletTransactionCounterparties(transaction),
  );
  return transaction.status !== 'failed' && type === 'receive';
}

export function isWalletActivityIncomingP2pTransfer(event: WalletActivityEvent): boolean {
  if (!isDisplayableWalletActivityEvent(event)) return false;

  const amounts = parseWalletActivityAmounts(event);
  return normalizeWalletActivityDisplayType(event, amounts) === 'receive';
}

export function isDisplayableWalletActivityEvent(event: WalletActivityEvent): boolean {
  if (isUmbraSetupTransactionType(event.type)) return false;

  const amounts = parseWalletActivityAmounts(event);
  const rawType = normalizeTransactionTypeLabel(event.type);
  const hasAmountSignal = Boolean(
    amounts.length > 0 || event.amount?.trim() || event.rawAmount?.trim(),
  );
  const hasPaymentSignal = Boolean(
    hasAmountSignal ||
    rawType.includes('swap') ||
    rawType.includes('transfer') ||
    rawType.includes('receive') ||
    rawType.includes('send') ||
    rawType.includes('payment'),
  );

  if (!hasPaymentSignal) {
    return !isUnenrichedWalletActivityEvent(event) && !isInternalWalletTransactionType(event.type);
  }
  if (!hasAmountSignal) return false;
  if (isInternalWalletTransactionType(event.type) && amounts.length === 0) return false;

  const type = normalizeWalletActivityDisplayType(event, amounts);
  return type === 'send' || type === 'receive' || type === 'swap';
}

export function isDisplayableWalletPaymentTransaction(
  transaction: WalletTransactionsResponse['transactions'][number],
): boolean {
  if (transaction.display != null) return true;
  if (isUmbraSetupTransactionType(transaction.type)) return false;

  const amounts = parseWalletTransactionAmounts(transaction);
  const rawType = normalizeTransactionTypeLabel(transaction.type);
  const hasAmountSignal = Boolean(
    amounts.length > 0 || transaction.amount?.trim() || transaction.rawAmount?.trim(),
  );
  const hasPaymentSignal = Boolean(
    hasAmountSignal ||
    rawType.includes('swap') ||
    rawType.includes('transfer') ||
    rawType.includes('receive') ||
    rawType.includes('send') ||
    rawType.includes('payment'),
  );

  if (!hasPaymentSignal) {
    return (
      !isUnenrichedWalletTransaction(transaction) &&
      !isInternalWalletTransactionType(transaction.type)
    );
  }
  if (!hasAmountSignal) return false;
  if (isInternalWalletTransactionType(transaction.type) && amounts.length === 0) return false;

  const type = normalizeWalletTransactionDisplayType(
    transaction,
    amounts,
    getWalletTransactionCounterparties(transaction),
  );

  if (type === 'send' || type === 'receive' || type === 'swap') return true;

  return !isInternalWalletTransactionType(transaction.type);
}

export function mapLocalReceiptForRecentActivity(
  receipt: OffpayLocalReceiptViewInput,
): OffpayRecentActivityView {
  const type = getLocalReceiptDisplayType(receipt);
  const direction = getLocalReceiptDisplayDirection(receipt, type);
  const status = receipt.status ?? 'received';
  const failed = status === 'failed';
  const settled = status === 'settled';
  const detailAccountAddress = getReceiptDetailAccountAddress(receipt, type);
  const token = getLocalReceiptTokenMetadata(receipt);
  const amountLabel = formatLocalReceiptAmountLabel(receipt, type);
  const pendingLabel =
    status === 'queued'
      ? 'Queued offline'
      : status === 'settling'
        ? 'Settling on-chain'
        : status === 'received'
          ? 'Received offline'
          : failed
            ? (receipt.errorMessage ?? 'Settlement failed')
            : receipt.signature != null
              ? `Tx ${shortenWalletAddress(receipt.signature, 4)}`
              : 'Settled on-chain';

  return {
    id: receipt.id,
    type,
    title: failed ? 'Failed' : type === 'swap' ? 'Swapped' : type === 'send' ? 'Sent' : 'Received',
    subtitle: receipt.subtitle,
    sourceLabel:
      receipt.routeLabel?.trim() || (isOffpayOfflineP2pReceipt(receipt) ? 'Offline P2P' : null),
    amountLabel,
    secondaryAmountLabel: receipt.secondaryAmountLabel?.trim() || (settled ? null : pendingLabel),
    amountTone: failed
      ? 'failed'
      : type === 'swap'
        ? 'positive'
        : direction === 'send'
          ? 'negative'
          : 'positive',
    tokenMint: token.mint,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    tokenLogo: token.logo,
    status: failed ? 'failed' : settled ? 'confirmed' : 'pending',
    detailTimestampMs: receipt.createdAt,
    detailNetwork: receipt.network ?? null,
    detailSignature: receipt.signature?.trim() || null,
    detailAccountLabel: getDetailAccountLabel(type),
    detailAccountAddress,
  };
}

export function mapWalletTransactionForHistory(
  transaction: WalletTransactionsResponse['transactions'][number],
  localReceipt?: OffpayLocalReceiptViewInput | null,
  network?: OffpayNetwork | null,
): OffpayHistoryTransactionView {
  const backendView = getBackendWalletTransactionDisplayView(transaction, network);
  if (backendView != null) {
    return mergeLocalReceiptData(backendView, localReceipt);
  }

  const amounts = parseWalletTransactionAmounts(transaction, network);
  const counterparties = getWalletTransactionCounterparties(transaction);
  const type = normalizeWalletTransactionDisplayType(transaction, amounts, counterparties);
  const amountDisplay = buildAmountDisplay(
    type,
    transaction.status,
    amounts,
    getWalletTransactionTokenMetadata(transaction, amounts, network),
  );
  const swapSubtitle = type === 'swap' ? buildSwapSubtitle(amounts) : null;

  return mergeLocalReceiptData(
    {
      id: transaction.signature,
      type,
      title: getTransactionTitle(type, transaction.status),
      subtitle:
        swapSubtitle ??
        buildCounterpartySubtitle(
          type,
          counterparties,
          transaction.signature,
          transaction.description,
        ),
      sourceLabel: null,
      ...amountDisplay,
      status: transaction.status === 'failed' ? 'failed' : 'confirmed',
      detailTimestampMs: transaction.timestamp * 1000,
      detailNetwork: network ?? localReceipt?.network ?? null,
      detailSignature: transaction.signature,
      detailAccountLabel: getDetailAccountLabel(type),
      detailAccountAddress: getTransactionDetailAccountAddress(type, counterparties),
    },
    localReceipt,
  );
}

function sortTransactionsMostRecent(
  transactions: WalletTransactionsResponse['transactions'],
): WalletTransactionsResponse['transactions'] {
  return [...transactions].sort((left, right) => {
    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.signature.localeCompare(right.signature);
  });
}

function sortReceiptsMostRecent(
  receipts: readonly OffpayLocalReceiptViewInput[],
): OffpayLocalReceiptViewInput[] {
  return [...receipts].sort((left, right) => {
    const createdAtDiff = right.createdAt - left.createdAt;
    if (createdAtDiff !== 0) return createdAtDiff;
    return left.id.localeCompare(right.id);
  });
}

const ONLINE_RECEIPT_SIGNATURE_PATTERN =
  /^online-(?:send|receive)-(?:devnet|mainnet)-([1-9A-HJ-NP-Za-km-z]{32,88})$/;

export function getOffpayLocalReceiptSignature(
  receipt: Pick<OffpayLocalReceiptViewInput, 'id' | 'signature'>,
): string | null {
  const explicitSignature = receipt.signature?.trim();
  if (explicitSignature) return explicitSignature;

  return receipt.id.trim().match(ONLINE_RECEIPT_SIGNATURE_PATTERN)?.[1] ?? null;
}

function buildReceiptsBySignature(
  receipts: readonly OffpayLocalReceiptViewInput[],
): Map<string, OffpayLocalReceiptViewInput[]> {
  const receiptsBySignature = new Map<string, OffpayLocalReceiptViewInput[]>();

  for (const receipt of sortReceiptsMostRecent(receipts)) {
    const signature = getOffpayLocalReceiptSignature(receipt);
    if (signature == null) continue;

    const signatureReceipts = receiptsBySignature.get(signature) ?? [];
    signatureReceipts.push(receipt);
    receiptsBySignature.set(signature, signatureReceipts);
  }

  return receiptsBySignature;
}

export function selectOffpayLocalReceiptForWalletTransaction<
  TReceipt extends OffpayLocalReceiptViewInput,
>(
  transaction: WalletTransactionsResponse['transactions'][number],
  receipts: readonly TReceipt[] | null | undefined,
): TReceipt | null {
  if (receipts == null || receipts.length === 0) return null;

  const amounts = parseWalletTransactionAmounts(transaction);
  const type = normalizeWalletTransactionDisplayType(
    transaction,
    amounts,
    getWalletTransactionCounterparties(transaction),
  );

  return (
    receipts.find((receipt) => getLocalReceiptDisplayType(receipt) === type) ??
    receipts.find((receipt) => receipt.direction === type) ??
    receipts.find((receipt) => receipt.direction == null) ??
    receipts[0] ??
    null
  );
}

function getDisplayableWalletTransactions(
  transactions: WalletTransactionsResponse['transactions'],
  receiptsBySignature?: ReadonlyMap<string, unknown>,
): WalletTransactionsResponse['transactions'] {
  return sortTransactionsMostRecent(transactions).filter(
    (transaction) =>
      isDisplayableWalletPaymentTransaction(transaction) ||
      (!isInternalWalletTransactionType(transaction.type) &&
        receiptsBySignature?.has(transaction.signature) === true),
  );
}

function getVisibleLocalReceipts(
  receipts: readonly OffpayLocalReceiptViewInput[],
  displayableTransactions: WalletTransactionsResponse['transactions'],
): OffpayLocalReceiptViewInput[] {
  const displayableSignatures = new Set(
    displayableTransactions.map((transaction) => transaction.signature),
  );

  return getVisibleLocalReceiptsBySignature(receipts, displayableSignatures);
}

function getVisibleLocalReceiptsBySignature(
  receipts: readonly OffpayLocalReceiptViewInput[],
  displayableSignatures: ReadonlySet<string>,
): OffpayLocalReceiptViewInput[] {
  return sortReceiptsMostRecent(
    receipts.filter((receipt) => {
      const signature = getOffpayLocalReceiptSignature(receipt);
      return signature == null || !displayableSignatures.has(signature);
    }),
  );
}

function getTransactionViewTimestamp(view: Pick<OffpayRecentActivityView, 'detailTimestampMs'>) {
  return view.detailTimestampMs ?? 0;
}

function sortTransactionViewsMostRecent<T extends OffpayRecentActivityView>(
  views: readonly T[],
): T[] {
  return [...views].sort((left, right) => {
    const timestampDiff = getTransactionViewTimestamp(right) - getTransactionViewTimestamp(left);
    if (timestampDiff !== 0) return timestampDiff;
    return left.id.localeCompare(right.id);
  });
}

function getTransactionViewSignature(
  view: Pick<OffpayRecentActivityView, 'id' | 'detailSignature'>,
): string {
  return view.detailSignature?.trim() || view.id;
}

function buildBackendViewSignatureSet(
  views: readonly Pick<OffpayRecentActivityView, 'id' | 'detailSignature'>[],
): Set<string> {
  const signatures = new Set<string>();

  for (const view of views) {
    signatures.add(view.id);
    signatures.add(getTransactionViewSignature(view));
  }

  return signatures;
}

export function selectOffpayLocalReceiptForTransactionView<
  TReceipt extends OffpayLocalReceiptViewInput,
>(
  view: OffpayRecentActivityView,
  receipts: readonly TReceipt[] | null | undefined,
): TReceipt | null {
  if (receipts == null || receipts.length === 0) return null;

  return (
    receipts.find((receipt) => getLocalReceiptDisplayType(receipt) === view.type) ??
    receipts.find((receipt) => receipt.direction === view.type) ??
    receipts.find((receipt) => receipt.direction == null) ??
    receipts[0] ??
    null
  );
}

function getReceiptsForTransactionView<TReceipt extends OffpayLocalReceiptViewInput>(
  view: OffpayRecentActivityView,
  receiptsBySignature: ReadonlyMap<string, TReceipt[]>,
): TReceipt[] | undefined {
  const detailSignature = getTransactionViewSignature(view);
  return receiptsBySignature.get(detailSignature) ?? receiptsBySignature.get(view.id);
}

export function buildWalletRecentActivityItems(params: {
  transactions: WalletTransactionsResponse['transactions'];
  transactionViews?: readonly OffpayRecentActivityView[];
  localReceipts?: readonly OffpayLocalReceiptViewInput[];
  includeUnmatchedLocalReceipts?: boolean;
  network?: OffpayNetwork | null;
}): OffpayRecentActivityView[] {
  const localReceipts = (params.localReceipts ?? []).filter(isOffpayLocalHistoryReceipt);
  const includeUnmatchedLocalReceipts = params.includeUnmatchedLocalReceipts ?? true;
  const receiptsBySignature = buildReceiptsBySignature(localReceipts);
  const backendViews = sortTransactionViewsMostRecent(
    (params.transactionViews ?? []).map((view) =>
      applyKnownTokenMetadataToDisplayView(view, params.network),
    ),
  );
  const backendViewSignatures = buildBackendViewSignatureSet(backendViews);
  const displayableTransactions = getDisplayableWalletTransactions(
    params.transactions,
    receiptsBySignature,
  ).filter((transaction) => !backendViewSignatures.has(transaction.signature));
  const displayableSignatures = new Set([
    ...backendViewSignatures,
    ...displayableTransactions.map((transaction) => transaction.signature),
  ]);
  const visibleLocalReceipts = getVisibleLocalReceiptsBySignature(
    localReceipts,
    displayableSignatures,
  );
  const mappedReceipts = includeUnmatchedLocalReceipts
    ? visibleLocalReceipts.map((receipt) => ({
        timestamp: receipt.createdAt,
        view: mapLocalReceiptForRecentActivity(receipt),
      }))
    : [];
  const mappedBackendViews = backendViews.map((view) => ({
    timestamp: getTransactionViewTimestamp(view),
    view: mergeLocalReceiptData(
      view,
      selectOffpayLocalReceiptForTransactionView(
        view,
        getReceiptsForTransactionView(view, receiptsBySignature),
      ),
    ),
  }));
  const mappedTransactions = displayableTransactions.map((transaction) => ({
    timestamp: transaction.timestamp * 1000,
    view: mapWalletTransactionForRecentActivity(
      transaction,
      selectOffpayLocalReceiptForWalletTransaction(
        transaction,
        receiptsBySignature.get(transaction.signature),
      ),
      params.network ?? null,
    ),
  }));

  return [...mappedReceipts, ...mappedBackendViews, ...mappedTransactions]
    .sort((left, right) => {
      const timestampDiff = right.timestamp - left.timestamp;
      if (timestampDiff !== 0) return timestampDiff;
      return left.view.id.localeCompare(right.view.id);
    })
    .map((item) => item.view);
}

function getLocalReceiptHistoryTitle(receipt: OffpayLocalReceiptViewInput): string {
  const status = receipt.status ?? 'received';
  return status === 'queued' || status === 'settling' || status === 'failed'
    ? 'Queued'
    : formatDateTitle(Math.floor(receipt.createdAt / 1000));
}

export function buildWalletHistoryGroups(params: {
  transactions: WalletTransactionsResponse['transactions'];
  transactionViews?: readonly OffpayHistoryTransactionView[];
  localReceipts?: readonly OffpayLocalReceiptViewInput[];
  includeUnmatchedLocalReceipts?: boolean;
  network?: OffpayNetwork | null;
}): OffpayHistoryTransactionGroup[] {
  const localReceipts = (params.localReceipts ?? []).filter(isOffpayLocalHistoryReceipt);
  const includeUnmatchedLocalReceipts = params.includeUnmatchedLocalReceipts ?? true;
  const receiptsBySignature = buildReceiptsBySignature(localReceipts);
  const backendViews = sortTransactionViewsMostRecent(
    (params.transactionViews ?? []).map((view) =>
      applyKnownTokenMetadataToDisplayView(view, params.network),
    ),
  );
  const backendViewSignatures = buildBackendViewSignatureSet(backendViews);
  const displayableTransactions = getDisplayableWalletTransactions(
    params.transactions,
    receiptsBySignature,
  ).filter((transaction) => !backendViewSignatures.has(transaction.signature));
  const displayableSignatures = new Set([
    ...backendViewSignatures,
    ...displayableTransactions.map((transaction) => transaction.signature),
  ]);
  const visibleLocalReceipts = getVisibleLocalReceiptsBySignature(
    localReceipts,
    displayableSignatures,
  );
  const entries = [
    ...(includeUnmatchedLocalReceipts
      ? visibleLocalReceipts.map((receipt) => ({
          title: getLocalReceiptHistoryTitle(receipt),
          timestamp: receipt.createdAt,
          view: mapLocalReceiptForRecentActivity(receipt),
        }))
      : []),
    ...backendViews.map((view) => ({
      title:
        view.detailTimestampMs == null
          ? 'Activity'
          : formatDateTitle(Math.floor(view.detailTimestampMs / 1000)),
      timestamp: getTransactionViewTimestamp(view),
      view: mergeLocalReceiptData(
        view,
        selectOffpayLocalReceiptForTransactionView(
          view,
          getReceiptsForTransactionView(view, receiptsBySignature),
        ),
      ),
    })),
    ...displayableTransactions.map((transaction) => ({
      title: formatDateTitle(transaction.timestamp),
      timestamp: transaction.timestamp * 1000,
      view: mapWalletTransactionForHistory(
        transaction,
        selectOffpayLocalReceiptForWalletTransaction(
          transaction,
          receiptsBySignature.get(transaction.signature),
        ),
        params.network ?? null,
      ),
    })),
  ].sort((left, right) => {
    const leftQueued = left.title === 'Queued';
    const rightQueued = right.title === 'Queued';
    if (leftQueued !== rightQueued) return leftQueued ? -1 : 1;

    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.view.id.localeCompare(right.view.id);
  });
  const groups = new Map<string, OffpayHistoryTransactionView[]>();

  for (const entry of entries) {
    const group = groups.get(entry.title) ?? [];
    group.push(entry.view);
    groups.set(entry.title, group);
  }

  return Array.from(groups, ([title, data]) => ({ title, data }));
}

export function groupWalletTransactionsByDate(
  transactions: WalletTransactionsResponse['transactions'],
  localReceiptsBySignature?: ReadonlyMap<
    string,
    OffpayLocalReceiptViewInput | readonly OffpayLocalReceiptViewInput[]
  >,
  network?: OffpayNetwork | null,
): OffpayHistoryTransactionGroup[] {
  const groups = new Map<string, OffpayHistoryTransactionView[]>();

  for (const transaction of getDisplayableWalletTransactions(
    transactions,
    localReceiptsBySignature,
  )) {
    const title = formatDateTitle(transaction.timestamp);
    const group = groups.get(title) ?? [];
    const matchingReceipts = localReceiptsBySignature?.get(transaction.signature);
    const localReceipt = Array.isArray(matchingReceipts)
      ? selectOffpayLocalReceiptForWalletTransaction(transaction, matchingReceipts)
      : (matchingReceipts ?? null);

    group.push(mapWalletTransactionForHistory(transaction, localReceipt, network));
    groups.set(title, group);
  }

  return Array.from(groups, ([title, data]) => ({ title, data }));
}

export function groupLocalReceiptsByDate(
  receipts: OffpayLocalReceiptViewInput[],
): OffpayHistoryTransactionGroup[] {
  const groups = new Map<string, OffpayHistoryTransactionView[]>();

  for (const receipt of sortReceiptsMostRecent(receipts)) {
    const status = receipt.status ?? 'received';
    const title =
      status === 'queued' || status === 'settling' || status === 'failed'
        ? 'Queued'
        : formatDateTitle(Math.floor(receipt.createdAt / 1000));
    const group = groups.get(title) ?? [];
    group.push(mapLocalReceiptForRecentActivity(receipt));
    groups.set(title, group);
  }

  return Array.from(groups, ([title, data]) => ({ title, data }));
}
