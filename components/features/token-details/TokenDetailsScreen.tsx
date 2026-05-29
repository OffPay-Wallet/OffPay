import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TransactionActivityRow } from '@/components/features/history/TransactionActivityRow';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { PuffyReceiveIcon } from '@/components/ui/icons/PuffyReceiveIcon';
import { PuffySendIcon } from '@/components/ui/icons/PuffySendIcon';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { useAppToast } from '@/components/ui/AppToast';
import { Text } from '@/components/ui/Text';
import { StaggerRevealGroup, StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayTokenValuations } from '@/hooks/useOffpayTokenValuations';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import {
  buildStablecoinMetadataLookup,
  buildVisibleTokenHoldings,
  mapWalletTransactionForHistory,
  shortenWalletAddress,
} from '@/lib/api/offpay-wallet-data';
import { formatLamportsAsExactSolLabel } from '@/lib/crypto/solana-amounts';
import { usePreferencesStore } from '@/store/preferencesStore';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';
import type { WalletTransactionsResponse } from '@/types/offpay-api';

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const MAX_TOKEN_ACTIVITY_ROWS = 8;
const TOKEN_DETAIL_CONTENT_MAX_WIDTH = 430;
const TOKEN_DETAIL_PANEL_SHADOW =
  '0 2px 8px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)';
const TOKEN_DETAIL_CONTROL_SHADOW =
  '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)';

type WalletTransaction = WalletTransactionsResponse['transactions'][number];
type TokenDetailActionId = 'send' | 'receive' | 'swap';

const TOKEN_DETAIL_ACTIONS: { id: TokenDetailActionId; label: string }[] = [
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'swap', label: 'Swap' },
];

function getSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function normalizeSymbol(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

function isNativeSolHolding(holding: TokenHolding): boolean {
  return holding.mint === 'native-sol' || normalizeSymbol(holding.symbol) === 'SOL';
}

function getTokenActionMint(holding: TokenHolding): string {
  return isNativeSolHolding(holding) ? NATIVE_SOL_MINT : holding.mint;
}

function transactionMatchesHolding(transaction: WalletTransaction, holding: TokenHolding): boolean {
  const tokenMint = transaction.tokenMint?.trim() ?? null;
  const tokenSymbol = normalizeSymbol(transaction.tokenSymbol);
  const holdingSymbol = normalizeSymbol(holding.symbol);
  const description = transaction.description ?? '';

  if (isNativeSolHolding(holding)) {
    // The OffPay backend's RPC fallback (used on devnet and as the
    // mainnet fallback when the wallet API is unavailable) does not
    // surface a token mint or symbol for native SOL transfers — it
    // only fills `description: 'Native token transfer'` with a
    // type of `TRANSFER`. The mainnet enhanced API does populate
    // the SOL mint string. Match all three shapes so SOL transfers
    // surface in the SOL token-details view regardless of which
    // upstream provider answered.
    if (tokenMint === NATIVE_SOL_MINT) return true;
    if (tokenSymbol === 'SOL') return true;
    if (/\bSOL\b/i.test(description)) return true;
    // Fallback for the RPC path: any transaction that *does not*
    // have an SPL mint/symbol attached and is shaped like a transfer
    // is a native SOL movement.
    if (tokenMint == null && tokenSymbol.length === 0) {
      const rawType = transaction.type?.toUpperCase() ?? '';
      if (rawType === 'TRANSFER' || rawType === 'NATIVE_TRANSFER') return true;
      if (
        transaction.direction === 'send' ||
        transaction.direction === 'receive' ||
        transaction.amount?.trim() ||
        transaction.rawAmount?.trim()
      ) {
        return true;
      }
    }
    return false;
  }

  return tokenMint === holding.mint || tokenSymbol === holdingSymbol;
}

function formatDateTime(timestampSeconds: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestampSeconds * 1000));
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
      {children}
    </Pressable>
  );
}

function TokenActionIcon({
  actionId,
  size,
}: {
  actionId: TokenDetailActionId;
  size: number;
}): React.JSX.Element {
  if (actionId === 'send') {
    return <PuffySendIcon size={size} color={colors.brand.azureCyan} />;
  }

  if (actionId === 'receive') {
    return <PuffyReceiveIcon size={size} color={colors.brand.azureCyan} />;
  }

  return <PuffySwapIcon size={size} color={colors.brand.azureCyan} focused />;
}

function TokenActionButton({
  action,
  compact,
  onPress,
}: {
  action: { id: TokenDetailActionId; label: string };
  compact: boolean;
  onPress: (actionId: TokenDetailActionId) => void;
}): React.JSX.Element {
  const iconSize = compact ? 20 : 22;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        pressed ? styles.controlPressed : null,
      ]}
      onPress={() => onPress(action.id)}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${action.label} ${action.id === 'swap' ? 'token' : 'token payment'}`}
    >
      <View style={[styles.actionIconSlot, { width: iconSize, height: iconSize }]}>
        <TokenActionIcon actionId={action.id} size={iconSize} />
      </View>
      <Text
        variant="small"
        color={colors.brand.deepShadow}
        style={styles.actionLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={1}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

function DetailRow({
  label,
  value,
  copyable,
  onCopy,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  onCopy?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.detailRow,
        copyable && pressed ? styles.detailRowPressed : null,
      ]}
      disabled={!copyable}
      onPress={onCopy}
      accessibilityRole={copyable ? 'button' : undefined}
      accessibilityLabel={copyable ? `Copy ${label}` : `${label}: ${value}`}
    >
      <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.detailValueRow}>
        <Text
          variant="captionBold"
          color={colors.text.primary}
          style={styles.detailValue}
          numberOfLines={1}
          ellipsizeMode="middle"
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

export function TokenDetailsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const compact = width < 380 || height < 760 || fontScale > 1.05;
  const dense = width < 340 || fontScale > 1.18;
  const { showToast } = useAppToast();
  const params = useLocalSearchParams<{ mint?: string }>();
  const requestedMint = getSearchParam(params.mint);
  const currency = usePreferencesStore((state) => state.currency);
  const { network } = useOffpayNetwork();
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: true,
    eagerWithoutCapabilities: true,
  });
  const transactionsQuery = useOffpayWalletTransactions({
    deferUntilAfterInteractions: true,
  });
  const tokenLogoMap = useOffpayTokenLogoMap();
  const capabilitiesQuery = useOffpayCapabilities();
  const tokenMetadata = useMemo(
    () =>
      buildStablecoinMetadataLookup(capabilitiesQuery.capabilities?.offline?.supportedStablecoins),
    [capabilitiesQuery.capabilities?.offline?.supportedStablecoins],
  );
  const holdings = useMemo(
    () =>
      balanceQuery.data == null
        ? []
        : buildVisibleTokenHoldings(balanceQuery.data, tokenLogoMap, tokenMetadata),
    [balanceQuery.data, tokenLogoMap, tokenMetadata],
  );
  const valuationQuery = useOffpayTokenValuations({ holdings, currency });
  const holding = useMemo(
    () => holdings.find((item) => item.mint === requestedMint) ?? null,
    [holdings, requestedMint],
  );
  const valuation = holding == null ? null : (valuationQuery.data?.[holding.mint] ?? null);
  const tokenActivity = useMemo(() => {
    if (holding == null) return [];

    return transactionsQuery.transactions
      .filter((transaction) => transactionMatchesHolding(transaction, holding))
      .slice(0, MAX_TOKEN_ACTIVITY_ROWS)
      .map((transaction) => ({
        transaction,
        view: mapWalletTransactionForHistory(transaction),
      }));
  }, [holding, transactionsQuery.transactions]);

  const mintForDisplay =
    holding == null ? requestedMint : isNativeSolHolding(holding) ? NATIVE_SOL_MINT : holding.mint;
  const networkLabel =
    network === 'mainnet' ? 'Mainnet' : network === 'devnet' ? 'Devnet' : 'Unknown';
  const screenHorizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const heroPadding = dense ? spacing.lg : compact ? spacing.xl : spacing['2xl'];
  const tokenIconSize = dense ? 54 : compact ? 60 : 68;
  const actionCompact = dense || width < 360 || fontScale > 1.1;

  const handleCopyMint = (): void => {
    if (mintForDisplay == null) return;
    void Clipboard.setStringAsync(mintForDisplay);
    showToast({
      title: 'Mint copied',
      message: shortenWalletAddress(mintForDisplay),
      variant: 'success',
    });
  };

  const handleTokenAction = useCallback(
    (actionId: TokenDetailActionId): void => {
      if (holding == null) return;

      const searchParams = new URLSearchParams();

      if (actionId === 'send') {
        searchParams.set('mode', 'send');
        searchParams.set('mint', holding.mint);
        searchParams.set('token', holding.symbol);
        searchParams.set('advance', 'recipient');
        router.navigate(`/private-payment?${searchParams.toString()}` as never);
        return;
      }

      if (actionId === 'receive') {
        searchParams.set('mint', holding.mint);
        searchParams.set('token', holding.symbol);
        searchParams.set('name', holding.name);
        router.navigate(`/receive-payment?${searchParams.toString()}` as never);
        return;
      }

      searchParams.set('inputMint', getTokenActionMint(holding));
      searchParams.set('inputSymbol', holding.symbol);
      router.navigate(`/(tabs)/swap?${searchParams.toString()}` as never);
    },
    [holding, router],
  );

  const bottomPadding = Math.max(insets.bottom, spacing.lg) + spacing['4xl'];

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
            paddingHorizontal: screenHorizontalPadding,
            gap: compact ? spacing.lg : spacing.xl,
          },
        ]}
      >
        <View style={styles.contentFrame}>
          <View style={styles.header}>
            <HeaderIconButton onPress={() => router.back()} accessibilityLabel="Go back">
              <Ionicons
                name="chevron-back"
                size={layout.iconSizeNav}
                color={colors.brand.deepShadow}
              />
            </HeaderIconButton>
            <Text
              variant="h2"
              color={colors.text.inverse}
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              maxFontSizeMultiplier={1}
            >
              Token Details
            </Text>
            <View
              style={styles.headerIconPlaceholder}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </View>
        </View>

        {holding == null ? (
          <View style={[styles.contentFrame, styles.emptyState]}>
            <Text variant="bodyBold" color={colors.text.primary} align="center">
              {balanceQuery.isLoading || balanceQuery.isCapabilitiesPending
                ? 'Loading token'
                : 'Token not found'}
            </Text>
            <Text
              variant="small"
              color={colors.text.secondary}
              align="center"
              style={styles.emptyText}
            >
              Refresh holdings or open a token from the holdings list.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.contentFrame, styles.heroCard, { padding: heroPadding }]}>
              <View style={styles.heroTopRow}>
                <TokenIcon
                  symbol={holding.symbol}
                  name={holding.name}
                  logoUri={holding.logo}
                  size={tokenIconSize}
                />
                <View style={styles.heroTokenCopy}>
                  <View style={styles.nameRow}>
                    <Text
                      variant="h2"
                      color={colors.text.primary}
                      style={[styles.tokenName, dense && styles.tokenNameDense]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.72}
                      maxFontSizeMultiplier={1.05}
                    >
                      {holding.name}
                    </Text>
                    {holding.verified ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.semantic.success} />
                    ) : null}
                  </View>
                  <Text variant="body" color={colors.text.secondary} numberOfLines={1}>
                    {holding.symbol}
                  </Text>
                </View>
              </View>

              <View style={styles.balanceBlock}>
                <Text variant="caption" color={colors.text.secondary}>
                  Balance
                </Text>
                <Text
                  variant="h1"
                  color={colors.text.primary}
                  style={styles.balanceValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                >
                  {holding.balance} {holding.symbol}
                </Text>
                <Text variant="body" color={colors.text.secondary} numberOfLines={1}>
                  {valuation?.fiatValueLabel ?? '--'}
                </Text>
              </View>
            </View>

            <View style={[styles.contentFrame, styles.actionsRow]}>
              {TOKEN_DETAIL_ACTIONS.map((action) => (
                <TokenActionButton
                  key={action.id}
                  action={action}
                  compact={actionCompact}
                  onPress={handleTokenAction}
                />
              ))}
            </View>

            <View style={[styles.contentFrame, styles.section]}>
              <Text variant="bodyBold" color={colors.text.primary} style={styles.sectionTitle}>
                Details
              </Text>
              <View style={styles.detailCard}>
                <DetailRow label="Network" value={networkLabel} />
                <DetailRow
                  label="Mint"
                  value={mintForDisplay == null ? '--' : shortenWalletAddress(mintForDisplay, 6)}
                  copyable={mintForDisplay != null}
                  onCopy={handleCopyMint}
                />
                <DetailRow label="Unit Price" value={valuation?.unitPriceLabel ?? '--'} />
                <DetailRow label="Verified" value={holding.verified ? 'Yes' : 'No'} />
              </View>
            </View>

            <View style={[styles.contentFrame, styles.section]}>
              <Text variant="bodyBold" color={colors.text.primary} style={styles.sectionTitle}>
                Recent Activity
              </Text>
              {tokenActivity.length > 0 ? (
                <View style={styles.activityList}>
                  {tokenActivity.map(({ transaction, view }) => (
                    <TransactionActivityRow
                      key={transaction.signature}
                      tx={{
                        ...view,
                        subtitle: `${view.subtitle} · ${formatDateTime(transaction.timestamp)}`,
                      }}
                      compact={compact}
                      tokenLogos={tokenLogoMap}
                      metaLabel={`Fee ${formatLamportsAsExactSolLabel(transaction.fee)}`}
                    />
                  ))}
                </View>
              ) : transactionsQuery.isLoading ||
                (transactionsQuery.isFetching && transactionsQuery.transactions.length === 0) ? (
                <View style={styles.emptyActivityCard}>
                  <ActivityIndicator size="small" color={colors.brand.azureCyan} />
                  <Text
                    variant="small"
                    color={colors.text.secondary}
                    style={styles.emptyText}
                  >
                    Loading recent activity…
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyActivityCard}>
                  <Text variant="bodyBold" color={colors.text.primary}>
                    No token activity
                  </Text>
                  <Text variant="small" color={colors.text.secondary} style={styles.emptyText}>
                    Confirmed transfers and swaps for this token will appear here.
                  </Text>
                </View>
              )}
            </View>
          </>
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
    maxWidth: TOKEN_DETAIL_CONTENT_MAX_WIDTH,
  },
  header: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerIconBtn: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: TOKEN_DETAIL_CONTROL_SHADOW,
  },
  headerIconPlaceholder: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.display,
  },
  heroCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    gap: spacing['2xl'],
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: TOKEN_DETAIL_PANEL_SHADOW,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  heroTokenCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  tokenName: {
    flex: 1,
    minWidth: 0,
  },
  tokenNameDense: {
    fontSize: 26,
    lineHeight: 32,
  },
  balanceBlock: {
    gap: spacing.xs,
  },
  balanceValue: {
    fontFamily: fontFamily.semiBold,
    fontVariant: ['tabular-nums'],
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fontFamily.semiBold,
  },
  detailCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    overflow: 'hidden',
    boxShadow: TOKEN_DETAIL_PANEL_SHADOW,
  },
  detailRow: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.holdingsCard.divider,
  },
  detailRowPressed: {
    backgroundColor: colors.holdingsCard.pressed,
  },
  detailValueRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  detailValue: {
    minWidth: 0,
    textAlign: 'right',
  },
  activityList: {
    gap: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    boxShadow: TOKEN_DETAIL_PANEL_SHADOW,
  },
  actionButtonCompact: {
    minHeight: 52,
  },
  actionIconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  controlPressed: {
    opacity: 0.72,
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
    boxShadow: TOKEN_DETAIL_PANEL_SHADOW,
  },
  emptyActivityCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.lg,
    gap: spacing.xs,
    boxShadow: TOKEN_DETAIL_PANEL_SHADOW,
  },
  emptyText: {
    lineHeight: 18,
  },
});
