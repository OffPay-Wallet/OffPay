import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { PuffyReceiveArrowIcon } from '@/components/ui/icons/PuffyReceiveArrowIcon';
import { PuffySendIcon } from '@/components/ui/icons/PuffySendIcon';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { Text } from '@/components/ui/Text';
import { StaggerRevealGroup, StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import {
  getOffpayLocalReceiptSignature,
  isOffpayOfflineP2pReceipt,
  mapLocalReceiptForRecentActivity,
  mapWalletTransactionForHistory,
  selectOffpayLocalReceiptForWalletTransaction,
  shortenWalletAddress,
} from '@/lib/api/offpay-wallet-data';
import { formatLamportsAsExactSolLabel } from '@/lib/crypto/solana-amounts';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';

import type {
  OffpayDisplayTone,
  OffpayDisplayTransactionType,
  OffpayHistoryTransactionView,
  TokenLogoLookup,
} from '@/lib/api/offpay-wallet-data';
import type { OfflinePaymentReceipt } from '@/store/offlinePaymentStore';
import type { PrivatePaymentReceipt } from '@/store/privatePaymentStore';
import type { UmbraPrivacyReceipt } from '@/store/umbraPrivacyStore';
import type { OffpayNetwork, WalletTransactionsResponse } from '@/types/offpay-api';

type WalletTransaction = WalletTransactionsResponse['transactions'][number];

interface ParticipantRowData {
  id: string;
  label: string;
  address: string;
  copyable: boolean;
}

interface TransactionProgramInfo {
  flowLabel: string;
  routeLabel: string;
  privacyLabel: string;
  programLabel: string;
}

const TRANSACTION_DETAIL_CONTENT_MAX_WIDTH = 430;
const DETAIL_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const DETAIL_PANEL_SHADOW =
  '0 2px 8px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)';
const DETAIL_CONTROL_SHADOW =
  '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)';
const ACTION_BADGE_SHADOW =
  '0 2px 5px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.82)';
const TOKEN_SYMBOL_PATTERN = /(?:^|[\s+-])(?:\d[\d,.]*\s+)?([A-Za-z][A-Za-z0-9]{1,15})$/;

const AMOUNT_COLORS: Record<OffpayDisplayTone, string> = {
  positive: colors.semantic.success,
  negative: colors.semantic.error,
  neutral: colors.text.secondary,
  failed: colors.semantic.error,
};

function getSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function extractSymbol(label: string | null): string | null {
  if (label == null) return null;
  const match = label.trim().match(TOKEN_SYMBOL_PATTERN);
  return match?.[1]?.toUpperCase() ?? null;
}

function prettifyType(type: string): string {
  return type
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function getNetworkLabel(network: OffpayNetwork | null | undefined): string {
  if (network === 'mainnet') return 'Solana Mainnet';
  if (network === 'devnet') return 'Solana Devnet';
  return 'Solana';
}

function buildExplorerUrl(signature: string, network: OffpayNetwork): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

function formatCompactDateTime(timestampMs: number | null): string {
  if (timestampMs == null) return '--';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestampMs));
}

function getReceiptStatusLabel(status: OfflinePaymentReceipt['status']): string {
  if (status === 'queued') return 'Queued offline';
  if (status === 'received') return 'Received offline';
  if (status === 'settling') return 'Settling';
  if (status === 'settled') return 'Confirmed';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function getDisplayStatusLabel(
  transaction: WalletTransaction | null,
  receipt: OfflinePaymentReceipt | null,
  view: OffpayHistoryTransactionView,
): string {
  if (transaction != null) return transaction.status === 'failed' ? 'Failed' : 'Confirmed';
  if (receipt != null) return getReceiptStatusLabel(receipt.status);
  if (view.status === 'confirmed') return 'Confirmed';
  if (view.status === 'failed') return 'Failed';
  return 'Pending';
}

function getStatusIconName(status: OffpayHistoryTransactionView['status']) {
  if (status === 'failed') return 'close-circle' as const;
  if (status === 'pending') return 'time' as const;
  return 'checkmark-circle' as const;
}

function isCopyableAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value);
}

function extractOnlineReceiptSignature(
  value: string | null | undefined,
  network?: OffpayNetwork | null,
): string | null {
  const match = value
    ?.trim()
    .match(/^online-(?:send|receive)-(devnet|mainnet)-([1-9A-HJ-NP-Za-km-z]{32,88})$/);
  if (match == null) return null;
  if (network != null && match[1] !== network) return null;
  return match[2] ?? null;
}

function extractAgenticPrivateReference(
  value: string | null | undefined,
  network?: OffpayNetwork | null,
): string | null {
  const trimmed = value?.trim();
  if (trimmed == null || trimmed.length === 0) return null;

  if (network != null) {
    const prefix = `agentic-private-send-${network}-`;
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
  }

  const match = trimmed.match(/^agentic-private-send-(?:devnet|mainnet)-(.+)$/);
  return match?.[1] ?? null;
}

function nonEmptyText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : null;
}

function buildSignalText(
  transaction: WalletTransaction | null,
  receipt: OfflinePaymentReceipt | null,
  privatePaymentReceipt: PrivatePaymentReceipt | null,
  umbraReceipt: UmbraPrivacyReceipt | null,
): string {
  return [
    transaction?.type,
    transaction?.description,
    ...(transaction?.counterparties ?? []).flatMap((counterparty) => [
      counterparty.role,
      counterparty.address,
    ]),
    receipt?.title,
    receipt?.subtitle,
    receipt?.errorMessage,
    receipt?.sender,
    receipt?.recipient,
    receipt?.routeLabel,
    receipt?.privacyLabel,
    receipt?.programLabel,
    privatePaymentReceipt?.message,
    privatePaymentReceipt?.recipient,
    umbraReceipt?.action,
    umbraReceipt?.title,
    umbraReceipt?.subtitle,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function getRouteCounterparty(transaction: WalletTransaction | null): string | null {
  const route = transaction?.counterparties.find((counterparty) =>
    /route|program|protocol|provider/i.test(counterparty.role),
  );

  return route?.address?.trim() || null;
}

function getTransactionProgramInfo(params: {
  transaction: WalletTransaction | null;
  receipt: OfflinePaymentReceipt | null;
  privatePaymentReceipt: PrivatePaymentReceipt | null;
  umbraReceipt: UmbraPrivacyReceipt | null;
  view: OffpayHistoryTransactionView;
}): TransactionProgramInfo {
  const signalText = buildSignalText(
    params.transaction,
    params.receipt,
    params.privatePaymentReceipt,
    params.umbraReceipt,
  );
  const explicitRouteLabel = nonEmptyText(params.receipt?.routeLabel);
  const explicitPrivacyLabel = nonEmptyText(params.receipt?.privacyLabel);
  const explicitProgramLabel = nonEmptyText(params.receipt?.programLabel);
  const explicitPrivateRoute = explicitPrivacyLabel?.toLowerCase() === 'private route';
  const privateReceiptRouteLabel =
    params.privatePaymentReceipt?.route === 'umbra' ? 'Umbra' : 'MagicBlock';
  const programs: string[] = [];
  const addProgram = (label: string): void => {
    if (!programs.includes(label)) programs.push(label);
  };

  if (params.privatePaymentReceipt != null || explicitPrivateRoute) {
    addProgram(explicitRouteLabel ?? privateReceiptRouteLabel);
  }
  if (/jupiter/i.test(signalText)) addProgram('Jupiter');
  if (/magic\s*block|magicblock|ephemeral/i.test(signalText)) addProgram('MagicBlock');
  if (/umbra|shield|unshield|encrypted|vault/i.test(signalText)) addProgram('Umbra');

  const routeCounterparty = getRouteCounterparty(params.transaction);
  if (routeCounterparty != null && !programs.some((label) => routeCounterparty.includes(label))) {
    addProgram(routeCounterparty);
  }

  const privateRoute =
    explicitPrivateRoute ||
    params.privatePaymentReceipt != null ||
    /private|privacy|magic\s*block|magicblock|umbra|shield|encrypted/i.test(signalText);
  const p2p =
    params.view.type !== 'swap' &&
    (params.privatePaymentReceipt != null ||
      params.receipt?.sender != null ||
      params.receipt?.recipient != null ||
      params.transaction?.counterparties.some((counterparty) =>
        /sender|source|from|recipient|receiver|destination|to/i.test(counterparty.role),
      ) === true);
  const routeLabel =
    explicitRouteLabel ??
    (params.privatePaymentReceipt != null ? privateReceiptRouteLabel : null) ??
    (programs.length > 0
      ? programs.join(' + ')
      : p2p
        ? 'Wallet transfer'
        : params.view.type === 'swap'
          ? 'Swap route'
          : 'Solana');
  const flowLabel =
    params.umbraReceipt != null
      ? `Umbra ${prettifyType(params.umbraReceipt.action)}`
      : params.view.type === 'swap' && privateRoute
        ? 'Private swap'
        : params.view.type === 'swap'
          ? 'Swap'
          : p2p
            ? `P2P ${params.view.type === 'receive' ? 'receive' : 'send'}`
            : prettifyType(params.transaction?.type ?? params.view.type);

  return {
    flowLabel,
    routeLabel,
    privacyLabel: explicitPrivacyLabel ?? (privateRoute ? 'Private route' : 'Public route'),
    programLabel:
      explicitProgramLabel ?? (p2p ? 'P2P' : programs.length > 0 ? programs.join(' + ') : 'Solana'),
  };
}

function mapUmbraReceiptForDetails(receipt: UmbraPrivacyReceipt): OffpayHistoryTransactionView {
  const type: OffpayDisplayTransactionType = receipt.action === 'unshield' ? 'receive' : 'send';

  return {
    id: receipt.id,
    type,
    title: receipt.title,
    subtitle: receipt.subtitle,
    sourceLabel: null,
    amountLabel: null,
    secondaryAmountLabel: prettifyType(receipt.action),
    amountTone: 'neutral',
    tokenMint: null,
    tokenSymbol: null,
    tokenName: null,
    tokenLogo: null,
    status: 'confirmed',
  };
}

function mapPrivatePaymentReceiptForDetails(
  receipt: PrivatePaymentReceipt,
): OffpayHistoryTransactionView {
  const decimals =
    typeof receipt.tokenDecimals === 'number' && Number.isFinite(receipt.tokenDecimals)
      ? receipt.tokenDecimals
      : 6;
  const symbol = receipt.tokenSymbol?.trim() || 'USDC';

  return {
    id: receipt.id,
    type: 'send',
    title: receipt.source === 'agentic' ? 'Yuga transfer' : 'Sent',
    subtitle: `To ${shortenWalletAddress(receipt.recipient)}`,
    sourceLabel: receipt.source === 'agentic' ? 'Yuga Transfer' : null,
    amountLabel: `-${formatAtomicAmount(receipt.amount, decimals)} ${symbol}`,
    secondaryAmountLabel: receipt.status === 'queued' ? 'Queued private send' : receipt.message,
    amountTone: 'negative',
    tokenMint: receipt.mint,
    tokenSymbol: symbol,
    tokenName: receipt.tokenName ?? symbol,
    tokenLogo: receipt.tokenLogo ?? null,
    status: receipt.status === 'queued' ? 'pending' : 'confirmed',
  };
}

function TransactionActionIcon({
  type,
  size,
}: {
  type: OffpayDisplayTransactionType;
  size: number;
}): React.JSX.Element {
  if (type === 'receive') {
    return <PuffyReceiveArrowIcon size={size} />;
  }

  if (type === 'swap') {
    return <PuffySwapIcon size={size} color={colors.brand.azureCyan} focused />;
  }

  return <PuffySendIcon size={size} />;
}

function HeaderIconButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.headerIconBtn, pressed ? styles.controlPressed : null]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <LinearGradient
        colors={[...DETAIL_GLASS_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerIconGlass}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

function TransactionTokenCluster({
  tx,
  size,
  tokenLogos,
}: {
  tx: OffpayHistoryTransactionView;
  size: number;
  tokenLogos: TokenLogoLookup;
}): React.JSX.Element {
  const primarySymbol = extractSymbol(tx.amountLabel) ?? tx.tokenSymbol;
  const secondarySymbol = extractSymbol(tx.secondaryAmountLabel);
  const hasSwapPair = tx.type === 'swap' && secondarySymbol != null;
  const actionBadgeSize = Math.max(28, Math.round(size * 0.4));
  const actionGlyphSize = Math.max(20, Math.round(actionBadgeSize * 0.7));
  const pairedAssetSize = Math.round(size * 0.72);
  const frameWidth = size + Math.round(actionBadgeSize * 0.45);
  const primaryLogo =
    tx.tokenLogo ??
    (tx.tokenMint == null ? null : (tokenLogos.byMint?.get(tx.tokenMint) ?? null)) ??
    (primarySymbol == null ? null : (tokenLogos.bySymbol?.get(primarySymbol) ?? null));
  const secondaryLogo =
    secondarySymbol == null ? null : (tokenLogos.bySymbol?.get(secondarySymbol) ?? null);
  const canRenderPrimaryAsset =
    primarySymbol != null || primaryLogo != null || tx.tokenMint != null || tx.tokenName != null;
  const primaryDisplaySymbol = primarySymbol ?? tx.tokenSymbol ?? 'Token';
  const primaryDisplayName = tx.tokenName ?? primarySymbol ?? tx.tokenMint ?? primaryDisplaySymbol;

  return (
    <View style={[styles.tokenCluster, { width: frameWidth, height: size }]}>
      {hasSwapPair ? (
        <>
          <View style={styles.clusterSecondaryIcon}>
            <TokenIcon
              symbol={secondarySymbol}
              name={secondarySymbol}
              logoUri={secondaryLogo}
              size={pairedAssetSize}
            />
          </View>
          <View style={[styles.clusterPrimaryIcon, { right: Math.round(actionBadgeSize * 0.3) }]}>
            <TokenIcon
              symbol={primarySymbol}
              name={primarySymbol}
              logoUri={primaryLogo}
              size={pairedAssetSize}
            />
          </View>
        </>
      ) : canRenderPrimaryAsset ? (
        <View style={styles.clusterSingleIcon}>
          <TokenIcon
            symbol={primaryDisplaySymbol}
            name={primaryDisplayName}
            logoUri={primaryLogo}
            size={size}
          />
        </View>
      ) : (
        <View style={[styles.clusterFallbackIcon, { width: size, height: size }]}>
          <TransactionActionIcon type={tx.type} size={Math.round(size * 0.72)} />
        </View>
      )}

      <View
        style={[
          styles.actionBadge,
          {
            width: actionBadgeSize,
            height: actionBadgeSize,
            borderRadius: actionBadgeSize / 2,
            right: -1,
            bottom: -1,
          },
        ]}
      >
        <TransactionActionIcon type={tx.type} size={actionGlyphSize} />
      </View>
    </View>
  );
}

function InfoTile({
  label,
  value,
  copyable,
  mono,
  wide,
  onCopy,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  mono?: boolean;
  wide?: boolean;
  onCopy?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.infoTile,
        wide ? styles.infoTileWide : null,
        copyable && pressed ? styles.infoTilePressed : null,
      ]}
      disabled={!copyable}
      onPress={onCopy}
      accessibilityRole={copyable ? 'button' : undefined}
      accessibilityLabel={copyable ? `Copy ${label}` : `${label}: ${value}`}
    >
      <Text
        variant="small"
        color={colors.text.secondary}
        style={styles.infoTileLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={1}
      >
        {label}
      </Text>
      <View style={styles.infoTileValueRow}>
        <Text
          variant={mono ? 'mono' : 'captionBold'}
          color={colors.text.primary}
          style={[styles.infoTileValue, mono && styles.infoTileMonoValue]}
          numberOfLines={1}
          ellipsizeMode="middle"
          selectable
          maxFontSizeMultiplier={1}
        >
          {value}
        </Text>
        {copyable ? (
          <Ionicons name="copy-outline" size={16} color={colors.brand.azureCyan} />
        ) : null}
      </View>
    </Pressable>
  );
}

function AccountPill({
  participant,
  onCopy,
}: {
  participant: ParticipantRowData;
  onCopy: (title: string, value: string) => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.accountPill,
        participant.copyable && pressed ? styles.infoTilePressed : null,
      ]}
      disabled={!participant.copyable}
      onPress={() => onCopy(`${participant.label} copied`, participant.address)}
      accessibilityRole={participant.copyable ? 'button' : undefined}
      accessibilityLabel={`${participant.label}: ${participant.address}`}
    >
      <Text
        variant="small"
        color={colors.text.secondary}
        style={styles.accountLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={1}
      >
        {participant.label}
      </Text>
      <Text
        variant="mono"
        color={colors.text.primary}
        style={styles.accountValue}
        numberOfLines={1}
        ellipsizeMode="middle"
        maxFontSizeMultiplier={1}
      >
        {participant.copyable ? shortenWalletAddress(participant.address, 4) : participant.address}
      </Text>
    </Pressable>
  );
}

function buildParticipantRows(
  transaction: WalletTransaction | null,
  receipt: OfflinePaymentReceipt | null,
): ParticipantRowData[] {
  const rows: ParticipantRowData[] = [];
  const addRow = (label: string, address: string | null | undefined): void => {
    const trimmed = address?.trim();
    if (trimmed == null || trimmed.length === 0) return;
    const id = `${label}:${trimmed}`;
    if (rows.some((row) => row.id === id)) return;
    rows.push({ id, label, address: trimmed, copyable: isCopyableAddress(trimmed) });
  };

  for (const counterparty of transaction?.counterparties ?? []) {
    addRow(prettifyType(counterparty.role || 'Account'), counterparty.address);
  }

  addRow('Sender', transaction?.sender);
  addRow('Recipient', transaction?.recipient);

  const hasTransactionSender =
    transaction?.sender != null ||
    transaction?.counterparties.some((counterparty) =>
      /sender|source|from|payer/i.test(counterparty.role),
    ) === true;
  const hasTransactionRecipient =
    transaction?.recipient != null ||
    transaction?.counterparties.some((counterparty) =>
      /recipient|receiver|destination|to/i.test(counterparty.role),
    ) === true;

  if (receipt != null) {
    if (!hasTransactionSender) addRow('Sender', receipt.sender);
    if (!hasTransactionRecipient) addRow('Recipient', receipt.recipient);
  }

  return rows.sort((left, right) => {
    const getRank = (label: string): number => {
      if (/sender|source|from|payer/i.test(label)) return 0;
      if (/recipient|receiver|destination|to/i.test(label)) return 1;
      return 2;
    };
    const rankDiff = getRank(left.label) - getRank(right.label);
    return rankDiff !== 0 ? rankDiff : left.id.localeCompare(right.id);
  });
}

export function TransactionDetailsScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string }>();
  const transactionId = getSearchParam(params.id);
  const { showToast } = useAppToast();
  const { network } = useOffpayNetwork();
  const transactionsQuery = useOffpayWalletTransactions({
    deferUntilAfterInteractions: true,
    autoFetchAllPages: true,
  });
  const offlineReceipts = useOfflinePaymentStore((state) => state.receipts);
  const privatePaymentReceipts = usePrivatePaymentStore((state) => state.receipts);
  const umbraReceipts = useUmbraPrivacyStore((state) => state.receipts);
  const tokenLogos = useOffpayTokenLogoMap();

  const localReceipts = useMemo(
    () =>
      offlineReceipts.filter(
        (receipt) =>
          (network == null || receipt.network === network) && isOffpayOfflineP2pReceipt(receipt),
      ),
    [network, offlineReceipts],
  );
  const transactionSignatureFromId = useMemo(
    () => extractOnlineReceiptSignature(transactionId, network),
    [network, transactionId],
  );
  const agenticPrivateReferenceFromId = useMemo(
    () => extractAgenticPrivateReference(transactionId, network),
    [network, transactionId],
  );
  const transaction = useMemo(
    () =>
      transactionId == null
        ? null
        : (transactionsQuery.transactions.find(
            (item) =>
              item.signature === transactionId || item.signature === transactionSignatureFromId,
          ) ?? null),
    [transactionId, transactionSignatureFromId, transactionsQuery.transactions],
  );
  const receipt = useMemo(() => {
    if (transactionId == null) return null;

    const matchingReceipts = localReceipts.filter((item) => {
      const receiptSignature = getOffpayLocalReceiptSignature(item);

      return (
        item.id === transactionId ||
        item.txId === transactionId ||
        item.signature === transactionId ||
        item.signature === transactionSignatureFromId ||
        receiptSignature === transactionId ||
        receiptSignature === transactionSignatureFromId ||
        (transaction?.signature != null && receiptSignature === transaction.signature)
      );
    });

    if (transaction != null) {
      return selectOffpayLocalReceiptForWalletTransaction(transaction, matchingReceipts);
    }

    return matchingReceipts[0] ?? null;
  }, [localReceipts, transaction, transactionId, transactionSignatureFromId]);
  const privatePaymentReceipt = useMemo(() => {
    if (transactionId == null) return null;
    const candidateSignature =
      transaction?.signature ??
      receipt?.signature ??
      transactionSignatureFromId ??
      (isCopyableAddress(transactionId) ? transactionId : null);

    return (
      privatePaymentReceipts.find(
        (item) =>
          (network == null || item.network === network) &&
          (item.id === transactionId ||
            item.signature === transactionId ||
            item.txId === transactionId ||
            item.initSignature === transactionId ||
            item.id === agenticPrivateReferenceFromId ||
            item.signature === agenticPrivateReferenceFromId ||
            item.txId === agenticPrivateReferenceFromId ||
            (candidateSignature != null &&
              (item.signature === candidateSignature ||
                item.txId === candidateSignature ||
                item.id === candidateSignature))),
      ) ?? null
    );
  }, [
    network,
    agenticPrivateReferenceFromId,
    privatePaymentReceipts,
    receipt?.signature,
    transaction?.signature,
    transactionId,
    transactionSignatureFromId,
  ]);
  const umbraReceipt = useMemo(() => {
    if (transactionId == null) return null;

    return (
      umbraReceipts.find(
        (item) =>
          (network == null || item.network === network) &&
          (item.id === transactionId ||
            item.signature === transactionId ||
            (transaction?.signature != null && item.signature === transaction.signature)),
      ) ?? null
    );
  }, [network, transaction?.signature, transactionId, umbraReceipts]);
  const view = useMemo(() => {
    const preferLocalReceiveView =
      receipt != null && receipt.direction === 'receive' && receipt.id === transactionId;
    if (preferLocalReceiveView) return mapLocalReceiptForRecentActivity(receipt);
    if (transaction != null) return mapWalletTransactionForHistory(transaction, receipt);
    if (receipt != null) return mapLocalReceiptForRecentActivity(receipt);
    if (privatePaymentReceipt != null) {
      return mapPrivatePaymentReceiptForDetails(privatePaymentReceipt);
    }
    if (umbraReceipt != null) return mapUmbraReceiptForDetails(umbraReceipt);
    return null;
  }, [privatePaymentReceipt, receipt, transaction, transactionId, umbraReceipt]);
  const participants = useMemo(
    () => buildParticipantRows(transaction, receipt),
    [receipt, transaction],
  );

  const compact = width < 380 || height < 760 || fontScale > 1.05;
  const dense = width < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const heroPadding = dense ? spacing.md : compact ? spacing.lg : spacing.xl;
  const iconSize = dense ? 48 : compact ? 52 : 58;
  const bottomPadding = Math.max(insets.bottom, spacing.md) + spacing.lg;
  const timestampMs =
    transaction != null
      ? transaction.timestamp * 1000
      : (receipt?.createdAt ?? privatePaymentReceipt?.createdAt ?? umbraReceipt?.createdAt ?? null);
  const activeNetwork =
    receipt?.network ??
    privatePaymentReceipt?.network ??
    umbraReceipt?.network ??
    transactionsQuery.network ??
    network;
  const signature =
    transaction?.signature ??
    receipt?.signature ??
    privatePaymentReceipt?.signature ??
    umbraReceipt?.signature ??
    transactionSignatureFromId ??
    null;
  const statusLabel = view == null ? null : getDisplayStatusLabel(transaction, receipt, view);
  const programInfo =
    view == null
      ? null
      : getTransactionProgramInfo({
          transaction,
          receipt,
          privatePaymentReceipt,
          umbraReceipt,
          view,
        });
  const detailType =
    programInfo != null
      ? programInfo.flowLabel
      : transaction != null
        ? prettifyType(transaction.type)
        : view != null
          ? prettifyType(view.type)
          : '--';
  const description =
    transaction?.description?.trim() ||
    receipt?.errorMessage?.trim() ||
    privatePaymentReceipt?.message?.trim() ||
    umbraReceipt?.subtitle?.trim() ||
    receipt?.subtitle?.trim() ||
    view?.subtitle?.trim() ||
    null;
  const visibleParticipants = participants.slice(0, 2);
  const hiddenParticipantCount = Math.max(0, participants.length - visibleParticipants.length);
  const showLoading =
    view == null &&
    transactionId != null &&
    (transactionsQuery.isLoading ||
      transactionsQuery.isFetching ||
      transactionsQuery.isCapabilitiesPending);

  const copyValue = useCallback(
    (title: string, value: string) => {
      void Clipboard.setStringAsync(value);
      showToast({
        title,
        message: shortenWalletAddress(value, 6),
        variant: 'success',
      });
    },
    [showToast],
  );

  const handleOpenExplorer = useCallback(() => {
    if (signature == null || activeNetwork == null) return;
    void Linking.openURL(buildExplorerUrl(signature, activeNetwork));
  }, [activeNetwork, signature]);

  const infoTiles =
    view == null
      ? []
      : [
          { label: 'Type', value: detailType },
          { label: 'Date', value: formatCompactDateTime(timestampMs) },
          {
            label: signature != null ? 'Hash' : 'Receipt',
            value:
              signature != null
                ? shortenWalletAddress(signature, 6)
                : receipt?.id != null
                  ? shortenWalletAddress(receipt.id, 6)
                  : umbraReceipt?.id != null
                    ? shortenWalletAddress(umbraReceipt.id, 6)
                    : '--',
            copyValue: signature ?? receipt?.id ?? umbraReceipt?.id ?? null,
            mono: true,
          },
          {
            label: 'Fee',
            value: transaction != null ? formatLamportsAsExactSolLabel(transaction.fee) : '--',
          },
          { label: 'Route', value: programInfo?.routeLabel ?? getNetworkLabel(activeNetwork) },
          { label: 'Privacy', value: programInfo?.privacyLabel ?? 'Public route' },
          ...(view.tokenSymbol != null ? [{ label: 'Token', value: view.tokenSymbol }] : []),
          ...(view.tokenMint != null
            ? [
                {
                  label: 'Mint',
                  value: shortenWalletAddress(view.tokenMint, 5),
                  copyValue: view.tokenMint,
                  mono: true,
                },
              ]
            : []),
        ];

  return (
    <View style={styles.container}>
      <GradientBackground />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + (dense ? spacing.sm : spacing.lg),
            paddingBottom: bottomPadding,
            paddingHorizontal: horizontalPadding,
            gap: compact ? spacing.lg : spacing.xl,
          },
        ]}
      >
        <Animated.View entering={FadeIn.duration(160)} style={[styles.contentFrame, styles.header]}>
          <HeaderIconButton onPress={() => router.back()} accessibilityLabel="Go back">
            <Ionicons
              name="chevron-back"
              size={layout.iconSizeNav}
              color={colors.brand.azureCyan}
            />
          </HeaderIconButton>
          <Text
            variant="h2"
            color={colors.text.inverse}
            style={[styles.headerTitle, compact && styles.headerTitleCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={1}
          >
            Activity Details
          </Text>
          <View
            style={styles.headerIconPlaceholder}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Animated.View>

        {view == null ? (
          <StaggerRevealItem index={0} style={[styles.contentFrame, styles.emptyState]}>
            <Text variant="bodyBold" color={colors.text.primary} align="center">
              {showLoading ? 'Loading activity' : 'Transaction not found'}
            </Text>
            <Text
              variant="small"
              color={colors.text.secondary}
              align="center"
              style={styles.emptyText}
            >
              Open a transaction from the history list after the wallet activity has refreshed.
            </Text>
          </StaggerRevealItem>
        ) : (
          <StaggerRevealGroup itemStyle={styles.contentFrame}>
            <View style={styles.summaryShell}>
              <LinearGradient
                colors={[...DETAIL_GLASS_COLORS]}
                start={{ x: 0.04, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.summaryCard, { padding: heroPadding }]}
              >
                <View style={styles.summaryTopRow}>
                  <TransactionTokenCluster tx={view} size={iconSize} tokenLogos={tokenLogos} />
                  <View style={styles.summaryCopy}>
                    <Text
                      variant="h2"
                      color={colors.text.primary}
                      style={[styles.summaryTitle, dense && styles.summaryTitleDense]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.72}
                      maxFontSizeMultiplier={1}
                    >
                      {view.title}
                    </Text>
                    <Text
                      variant="small"
                      color={colors.text.secondary}
                      style={styles.summarySubtitle}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      {programInfo?.programLabel ?? view.subtitle}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, styles.statusPillCompact]}>
                    <Ionicons
                      name={getStatusIconName(view.status)}
                      size={14}
                      color={
                        view.status === 'failed'
                          ? colors.semantic.error
                          : view.status === 'pending'
                            ? colors.semantic.warning
                            : colors.semantic.success
                      }
                    />
                    <Text
                      variant="small"
                      color={colors.text.primary}
                      style={styles.pillText}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      {statusLabel}
                    </Text>
                  </View>
                </View>

                <View style={styles.summaryMiddleRow}>
                  <View style={styles.amountBlock}>
                    <Text
                      variant="small"
                      color={colors.text.secondary}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      Amount
                    </Text>
                    <Text
                      variant="h2"
                      color={AMOUNT_COLORS[view.amountTone]}
                      style={[styles.amountValue, dense && styles.amountValueDense]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.66}
                      maxFontSizeMultiplier={1}
                    >
                      {view.amountLabel ?? '--'}
                    </Text>
                    {view.secondaryAmountLabel != null ? (
                      <Text
                        variant="small"
                        color={colors.text.secondary}
                        style={styles.secondaryAmount}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1}
                      >
                        {view.secondaryAmountLabel}
                      </Text>
                    ) : null}
                  </View>

                  {signature != null && activeNetwork != null ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.explorerButton,
                        pressed ? styles.controlPressed : null,
                      ]}
                      onPress={handleOpenExplorer}
                      accessibilityRole="link"
                      accessibilityLabel="Open transaction in Solscan"
                    >
                      <Ionicons name="open-outline" size={18} color={colors.brand.azureCyan} />
                      <Text
                        variant="small"
                        color={colors.brand.deepShadow}
                        style={styles.explorerLabel}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1}
                      >
                        Solscan
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.pillRow}>
                  <View style={styles.statusPill}>
                    <Text
                      variant="small"
                      color={colors.text.primary}
                      style={styles.pillText}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      {getNetworkLabel(activeNetwork)}
                    </Text>
                  </View>
                  <View style={styles.statusPill}>
                    <Text
                      variant="small"
                      color={colors.text.primary}
                      style={styles.pillText}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      {programInfo?.privacyLabel ?? 'Public route'}
                    </Text>
                  </View>
                  {view.sourceLabel != null ? (
                    <View style={styles.statusPill}>
                      <Text
                        variant="small"
                        color={colors.text.primary}
                        style={styles.pillText}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1}
                      >
                        {view.sourceLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </LinearGradient>
            </View>

            <View style={styles.infoPanel}>
                <View style={styles.infoGrid}>
                  {infoTiles.map((tile) => {
                    const tileCopyValue = 'copyValue' in tile ? tile.copyValue : null;

                    return (
                      <InfoTile
                        key={`${tile.label}:${tile.value}`}
                        label={tile.label}
                        value={tile.value}
                        mono={'mono' in tile ? tile.mono : false}
                        copyable={tileCopyValue != null}
                        onCopy={
                          tileCopyValue != null
                            ? () => copyValue(`${tile.label} copied`, tileCopyValue)
                            : undefined
                        }
                      />
                    );
                  })}
                </View>

                {visibleParticipants.length > 0 ? (
                  <View style={styles.accountsBlock}>
                    <Text
                      variant="small"
                      color={colors.text.secondary}
                      style={styles.accountsTitle}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      Accounts
                    </Text>
                    <View style={styles.accountsRow}>
                      {visibleParticipants.map((participant) => (
                        <AccountPill
                          key={participant.id}
                          participant={participant}
                          onCopy={copyValue}
                        />
                      ))}
                      {hiddenParticipantCount > 0 ? (
                        <View style={styles.moreAccountsPill}>
                          <Text
                            variant="small"
                            color={colors.text.secondary}
                            style={styles.moreAccountsText}
                            numberOfLines={1}
                            maxFontSizeMultiplier={1}
                          >
                            +{hiddenParticipantCount}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {description != null ? (
                  <View style={styles.memoBlock}>
                    <Text
                      variant="small"
                      color={colors.text.secondary}
                      style={styles.memoLabel}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                    >
                      Memo
                    </Text>
                    <Text
                      variant="small"
                      color={colors.text.primary}
                      style={styles.memoText}
                      numberOfLines={2}
                      selectable
                      maxFontSizeMultiplier={1}
                    >
                      {description}
                    </Text>
                  </View>
                ) : null}
            </View>
          </StaggerRevealGroup>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: TRANSACTION_DETAIL_CONTENT_MAX_WIDTH,
  },
  header: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: DETAIL_CONTROL_SHADOW,
  },
  headerIconGlass: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconPlaceholder: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.display,
  },
  headerTitleCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  summaryShell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: DETAIL_PANEL_SHADOW,
  },
  summaryCard: {
    gap: spacing.md,
    backgroundColor: colors.glass.strongFill,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    minWidth: 0,
    fontSize: 24,
    lineHeight: 30,
  },
  summaryTitleDense: {
    fontSize: 20,
    lineHeight: 26,
  },
  summarySubtitle: {
    lineHeight: 16,
  },
  summaryMiddleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  amountBlock: {
    flex: 1,
    minWidth: 0,
  },
  amountValue: {
    fontFamily: fontFamily.monoSemiBold,
    fontVariant: ['tabular-nums'],
    fontSize: 25,
    lineHeight: 31,
  },
  amountValueDense: {
    fontSize: 21,
    lineHeight: 27,
  },
  secondaryAmount: {
    fontFamily: fontFamily.mono,
    fontVariant: ['tabular-nums'],
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusPill: {
    minHeight: 32,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  statusPillCompact: {
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    flexShrink: 0,
  },
  statusPillFailed: {
    backgroundColor: 'rgba(255, 201, 201, 0.58)',
  },
  pillText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  tokenCluster: {
    flexShrink: 0,
    overflow: 'visible',
  },
  clusterSingleIcon: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  clusterPrimaryIcon: {
    position: 'absolute',
    bottom: 0,
    zIndex: 2,
  },
  clusterSecondaryIcon: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  clusterFallbackIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBadge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.badgeFill,
    boxShadow: ACTION_BADGE_SHADOW,
  },
  explorerButton: {
    minHeight: 42,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.badgeFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    boxShadow: DETAIL_CONTROL_SHADOW,
  },
  explorerLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  infoPanel: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: DETAIL_PANEL_SHADOW,
    padding: spacing.lg,
    gap: spacing.md,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
    columnGap: spacing.md,
  },
  infoTile: {
    flexGrow: 1,
    flexBasis: '44%',
    minWidth: 0,
    gap: 2,
  },
  infoTileWide: {
    flexBasis: '100%',
  },
  infoTilePressed: {
    opacity: 0.6,
  },
  infoTileLabel: {
    fontFamily: fontFamily.uiMedium,
  },
  infoTileValueRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  infoTileValue: {
    flex: 1,
    minWidth: 0,
  },
  infoTileMonoValue: {
    fontSize: 13,
    lineHeight: 18,
  },
  accountsBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.holdingsCard.divider,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  accountsTitle: {
    fontFamily: fontFamily.uiMedium,
  },
  accountsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
    columnGap: spacing.md,
  },
  accountPill: {
    flexGrow: 1,
    flexBasis: '44%',
    minWidth: 0,
    gap: 2,
    justifyContent: 'center',
  },
  accountLabel: {
    fontFamily: fontFamily.uiMedium,
  },
  accountValue: {
    fontSize: 12,
    lineHeight: 16,
  },
  moreAccountsPill: {
    minHeight: 42,
    minWidth: 42,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  moreAccountsText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  memoBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.holdingsCard.divider,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  memoLabel: {
    fontFamily: fontFamily.uiMedium,
  },
  memoText: {
    lineHeight: 17,
  },
  emptyState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: DETAIL_PANEL_SHADOW,
  },
  emptyText: {
    lineHeight: 18,
  },
  controlPressed: {
    opacity: 0.72,
  },
});
