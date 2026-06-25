import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TransactionActivityRow } from '@/components/features/history/TransactionActivityRow';
import { TransactionDetailsSheet } from '@/components/features/history/TransactionDetailsSheet';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { PuffyReceiveIcon } from '@/components/ui/icons/PuffyReceiveIcon';
import { PuffySendIcon } from '@/components/ui/icons/PuffySendIcon';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { useAppToast } from '@/components/ui/AppToast';
import { Text } from '@/components/ui/Text';
import { StaggerRevealGroup, StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import {
  TOKEN_PRICE_HISTORY_TIMEFRAMES,
  useOffpayTokenPriceHistory,
} from '@/hooks/useOffpayTokenPriceHistory';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayTokenValuations } from '@/hooks/useOffpayTokenValuations';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import { useOffpayWalletTokenTransactions } from '@/hooks/useOffpayWalletTokenTransactions';
import {
  buildWalletHistoryGroups,
  buildStablecoinMetadataLookup,
  buildVisibleTokenHoldings,
  shortenWalletAddress,
  walletHistoryTransactionMatchesTokenFilter,
} from '@/lib/api/offpay-wallet-data';
import { buildLocalHistoryReceiptInputs } from '@/lib/api/offpay-local-history-receipts';
import { WALLET_TRANSACTIONS_PAGE_SIZE } from '@/lib/api/offpay-wallet-query-keys';
import { isSupportedStablecoinToken } from '@/lib/policy/stablecoin-policy';
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';
import { getViewportProfile } from '@/lib/ui/responsive-layout';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useAdvancedSwapStore } from '@/store/advancedSwapStore';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useWalletStore } from '@/store/walletStore';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';
import type {
  OffpayHistoryTransactionView,
  OffpayLocalReceiptViewInput,
  WalletTransactionTokenFilter,
} from '@/lib/api/offpay-wallet-data';
import type {
  ConvertedTokenPriceHistorySample,
  TokenPriceHistoryTimeframeId,
} from '@/hooks/useOffpayTokenPriceHistory';
import type { OffpayNetwork } from '@/types/offpay-api';

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_ACTIVITY_INITIAL_FILL_ROWS = 8;
const TOKEN_ACTIVITY_BATCH_ROWS = 8;
const TOKEN_ACTIVITY_SCROLL_PREFETCH_PX = 280;
const MAX_TOKEN_ACTIVITY_ROWS = 32;
const PRICE_CHART_VIEWBOX_WIDTH = 320;
const PRICE_CHART_VIEWBOX_HEIGHT = 140;
const PRICE_CHART_LEFT = 0;
const PRICE_CHART_RIGHT = PRICE_CHART_VIEWBOX_WIDTH;
const PRICE_CHART_TOP = 12;
const PRICE_CHART_BOTTOM = 130;
const TOKEN_COPY_FEEDBACK_MS = 1800;

const TOKEN_DETAIL_PANEL_SHADOW = [
  '0 12px 28px rgba(0, 0, 0, 0.42)',
  'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
  'inset 0 0 14px rgba(255, 255, 255, 0.03)',
  'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
].join(', ');
const TOKEN_DETAIL_CONTROL_SHADOW = [
  'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
  'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
  '0 3px 8px rgba(0, 0, 0, 0.18)',
].join(', ');

type TokenDetailActionId = 'send' | 'receive' | 'swap';
type PriceChartPoint = {
  x: number;
  y: number;
  sample: ConvertedTokenPriceHistorySample;
};

const TOKEN_DETAIL_ACTIONS: { id: TokenDetailActionId; label: string }[] = [
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'swap', label: 'Swap' },
];

type TokenDetailsRouteParams = {
  mint?: string;
  symbol?: string;
  name?: string;
  balance?: string;
  balanceValue?: string;
  priceMint?: string;
  priceSymbol?: string;
  logo?: string;
  usdPrice?: string;
  verified?: string;
  spam?: string;
  priceChange?: string;
};

function getSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function getNumberSearchParam(value: string | string[] | undefined): number | null {
  const text = getSearchParam(value);
  if (text == null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBooleanSearchParam(value: string | string[] | undefined): boolean | null {
  const text = getSearchParam(value)?.toLowerCase();
  if (text == null) return null;
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return null;
}

function normalizeSymbol(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

function isNativeSolHolding(holding: TokenHolding): boolean {
  return holding.mint === 'native-sol' || normalizeSymbol(holding.symbol) === 'SOL';
}

function isNativeSolMintValue(value: string | null | undefined): boolean {
  return value === NATIVE_SOL_MINT || value === 'native-sol';
}

function getTokenActionMint(holding: TokenHolding): string {
  return isNativeSolHolding(holding) ? NATIVE_SOL_MINT : holding.mint;
}

function buildRouteHoldingSnapshot(
  params: TokenDetailsRouteParams,
  requestedMint: string | null,
): TokenHolding | null {
  if (requestedMint == null) return null;

  const symbol =
    getSearchParam(params.symbol) ?? (isNativeSolMintValue(requestedMint) ? 'SOL' : null);
  const name = getSearchParam(params.name) ?? (symbol === 'SOL' ? 'Solana' : symbol);
  if (symbol == null || name == null) return null;

  const balanceValue = getNumberSearchParam(params.balanceValue) ?? 0;
  const priceMint =
    getSearchParam(params.priceMint) ??
    (isNativeSolMintValue(requestedMint) ? NATIVE_SOL_MINT : requestedMint);

  return {
    mint: requestedMint,
    priceMint,
    priceSymbol: getSearchParam(params.priceSymbol) ?? symbol,
    symbol,
    name,
    balance: getSearchParam(params.balance) ?? '0',
    balanceValue,
    logo: getSearchParam(params.logo),
    usdPrice: getNumberSearchParam(params.usdPrice),
    verified: getBooleanSearchParam(params.verified) ?? true,
    spam: getBooleanSearchParam(params.spam) ?? false,
    priceChange: getSearchParam(params.priceChange),
  };
}

function getTokenActivityFilter(
  holding: TokenHolding | null,
  requestedMint: string | null,
): WalletTransactionTokenFilter | null {
  if (holding != null) {
    return {
      mint: getTokenActionMint(holding),
      symbol: holding.symbol,
    };
  }

  if (requestedMint == null) return null;

  return {
    mint: isNativeSolMintValue(requestedMint) ? NATIVE_SOL_MINT : requestedMint,
    symbol: isNativeSolMintValue(requestedMint) ? 'SOL' : null,
  };
}

function buildTokenActivityRows(params: {
  filter: WalletTransactionTokenFilter | null;
  transactions: Parameters<typeof buildWalletHistoryGroups>[0]['transactions'];
  transactionViews: Parameters<typeof buildWalletHistoryGroups>[0]['transactionViews'];
  localReceipts: OffpayLocalReceiptViewInput[];
  network: OffpayNetwork | null;
}): OffpayHistoryTransactionView[] {
  const filter = params.filter;
  if (filter == null) return [];

  return buildWalletHistoryGroups({
    transactions: params.transactions,
    transactionViews: params.transactionViews,
    localReceipts: params.localReceipts,
    network: params.network,
  })
    .flatMap((group) => group.data)
    .filter((transaction) => walletHistoryTransactionMatchesTokenFilter(transaction, filter))
    .slice(0, MAX_TOKEN_ACTIVITY_ROWS);
}

function holdingSupportsPrivateSend(holding: TokenHolding, network: OffpayNetwork | null): boolean {
  if (network == null) return false;
  const mint = getTokenActionMint(holding);
  return (
    isSupportedStablecoinToken({
      network,
      token: mint,
      symbol: holding.symbol,
    }) || getUmbraTokenByMint(network, mint)?.mixer === true
  );
}

function formatActivityDateTime(timestampMs: number | null): string | null {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return null;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestampMs));
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
    return <PuffySendIcon size={size} color={colors.text.primary} />;
  }

  if (actionId === 'receive') {
    return <PuffyReceiveIcon size={size} color={colors.text.primary} />;
  }

  return <PuffySwapIcon size={size} color={colors.text.primary} focused />;
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
        color={colors.text.primary}
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

function VerifiedBadge(): React.JSX.Element {
  return (
    <View
      style={styles.verifiedBadge}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Verified token"
    >
      <Ionicons name="checkmark" size={13} color={colors.brand.deepShadow} />
    </View>
  );
}

function TokenNameCopyButton({
  name,
  mint,
  dense,
  onCopy,
}: {
  name: string;
  mint: string | null;
  dense: boolean;
  onCopy: () => void;
}): React.JSX.Element {
  const copyable = mint != null;
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopyPress = useCallback((): void => {
    if (!copyable) return;
    onCopy();
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), TOKEN_COPY_FEEDBACK_MS);
  }, [copyable, onCopy]);

  return (
    <View style={styles.tokenNameButton}>
      <Text
        variant="h2"
        color={colors.text.primary}
        style={[styles.tokenName, dense && styles.tokenNameDense]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        maxFontSizeMultiplier={1.05}
      >
        {name}
      </Text>
      {copyable ? (
        <Pressable
          style={({ pressed }) => [styles.tokenCopyButton, pressed ? styles.controlPressed : null]}
          onPress={handleCopyPress}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${name} contract address`}
          hitSlop={6}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={18}
            color={copied ? colors.text.primary : colors.text.secondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function formatPercentChange(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(Math.abs(normalized) >= 100 ? 1 : 2)}%`;
}

function formatFiatValue(value: number, currencyCode: string, compact = false): string {
  if (!Number.isFinite(value)) return '--';
  const absolute = Math.abs(value);
  const maximumFractionDigits = compact ? (absolute >= 1000 ? 1 : 0) : absolute >= 1 ? 2 : 4;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      notation: compact && absolute >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits,
      minimumFractionDigits: compact ? 0 : absolute >= 1 ? 2 : 0,
    }).format(Object.is(value, -0) ? 0 : value);
  } catch {
    return `${value.toFixed(maximumFractionDigits)} ${currencyCode}`;
  }
}

function buildChartPath(samples: ConvertedTokenPriceHistorySample[]): {
  linePath: string;
  areaPath: string;
  grid: { y: number; label: string }[];
  points: PriceChartPoint[];
} | null {
  if (samples.length < 2) return null;

  const chartWidth = PRICE_CHART_RIGHT - PRICE_CHART_LEFT;
  const chartHeight = PRICE_CHART_BOTTOM - PRICE_CHART_TOP;
  const minPrice = Math.min(...samples.map((sample) => sample.price));
  const maxPrice = Math.max(...samples.map((sample) => sample.price));
  const rawRange = maxPrice - minPrice;
  const range = rawRange <= 0 ? Math.max(maxPrice * 0.1, 1) : rawRange;
  const paddedMin = Math.max(0, minPrice - range * 0.14);
  const paddedMax = maxPrice + range * 0.14;
  const paddedRange = paddedMax - paddedMin;
  const points = samples.map((sample, index) => {
    const x = PRICE_CHART_LEFT + (index / Math.max(samples.length - 1, 1)) * chartWidth;
    const y =
      paddedRange <= 0
        ? PRICE_CHART_TOP + chartHeight / 2
        : PRICE_CHART_BOTTOM - ((sample.price - paddedMin) / paddedRange) * chartHeight;
    return { x, y, sample };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  if (firstPoint == null || lastPoint == null) return null;

  return {
    linePath,
    areaPath: `${linePath} L${lastPoint.x.toFixed(2)} ${PRICE_CHART_BOTTOM} L${firstPoint.x.toFixed(2)} ${PRICE_CHART_BOTTOM} Z`,
    grid: [],
    points,
  };
}

function PriceLineChart({
  samples,
  currency,
  loading,
  resetKey,
}: {
  samples: ConvertedTokenPriceHistorySample[];
  currency: string;
  loading: boolean;
  resetKey: string | number;
}): React.JSX.Element {
  const [chartWidth, setChartWidth] = useState(0);
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  const chartPath = useMemo(() => buildChartPath(samples), [samples]);
  const activePoint =
    chartPath?.points[
      Math.min(inspectedIndex ?? chartPath.points.length - 1, chartPath.points.length - 1)
    ] ?? null;

  const updateInspectedPoint = useCallback(
    (event: GestureResponderEvent): void => {
      if (chartPath == null || chartWidth <= 0) return;

      const viewBoxX = (event.nativeEvent.locationX / chartWidth) * PRICE_CHART_VIEWBOX_WIDTH;
      const nearestIndex = Math.max(
        0,
        Math.min(
          chartPath.points.length - 1,
          Math.round((viewBoxX / PRICE_CHART_VIEWBOX_WIDTH) * (chartPath.points.length - 1)),
        ),
      );
      setInspectedIndex(nearestIndex);
    },
    [chartPath, chartWidth],
  );
  const resetInspectedPoint = useCallback((): void => {
    setInspectedIndex(null);
  }, []);

  useEffect(() => {
    resetInspectedPoint();
  }, [resetInspectedPoint, resetKey]);

  const canInspect = chartPath != null && chartPath.points.length > 1;

  if (chartPath == null) {
    return (
      <View style={styles.chartInteractiveFrame}>
        <View style={styles.chartEmptyLine} />
        {loading ? (
          <View style={styles.chartLoadingOverlay} pointerEvents="none">
            <LazyLoadingSpinner size={18} color={colors.brand.glossAccent} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={styles.chartInteractiveFrame}
      onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => canInspect}
      onMoveShouldSetResponder={() => canInspect}
      onResponderGrant={updateInspectedPoint}
      onResponderMove={updateInspectedPoint}
    >
      <Svg
        width="100%"
        height={PRICE_CHART_VIEWBOX_HEIGHT}
        viewBox={`0 0 ${PRICE_CHART_VIEWBOX_WIDTH} ${PRICE_CHART_VIEWBOX_HEIGHT}`}
      >
        <Defs>
          <LinearGradient id="tokenPriceChartFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.text.primary} stopOpacity="0.22" />
            <Stop offset="1" stopColor={colors.text.primary} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        <Path d={chartPath.areaPath} fill="url(#tokenPriceChartFill)" />
        {activePoint != null ? (
          <>
            <Line
              x1={activePoint.x}
              y1={activePoint.y}
              x2={activePoint.x}
              y2={PRICE_CHART_BOTTOM}
              stroke="rgba(255, 255, 255, 0.25)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <Rect
              x={Math.max(4, Math.min(220, activePoint.x - 48))}
              y={2}
              width={96}
              height={28}
              rx={8}
              fill={colors.surface.cardElevated}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth={0.5}
            />
            <SvgText
              x={Math.max(4, Math.min(220, activePoint.x - 48)) + 48}
              y={21}
              fill={colors.text.primary}
              fontSize={13}
              fontFamily={fontFamily.moneyBold}
              textAnchor="middle"
            >
              {formatFiatValue(activePoint.sample.price, currency)}
            </SvgText>
          </>
        ) : null}
        <Path
          d={chartPath.linePath}
          fill="none"
          stroke={colors.text.primary}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {activePoint != null ? (
          <Circle
            cx={activePoint.x}
            cy={activePoint.y}
            r={4.5}
            fill={colors.text.primary}
            stroke={colors.glass.strongFill}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      {loading ? (
        <View style={styles.chartLoadingOverlay} pointerEvents="none">
          <LazyLoadingSpinner size={18} color={colors.brand.glossAccent} />
        </View>
      ) : null}
    </View>
  );
}

function TokenPriceHistoryCard({
  priceHistory,
  selectedTimeframe,
  onTimeframeChange,
  holding,
  valuation,
  mintForDisplay,
  onCopyMint,
  dense,
  compact,
}: {
  priceHistory: ReturnType<typeof useOffpayTokenPriceHistory>;
  selectedTimeframe: TokenPriceHistoryTimeframeId;
  onTimeframeChange: (timeframe: TokenPriceHistoryTimeframeId) => void;
  holding: TokenHolding;
  valuation?: { fiatValueLabel: string; unitPriceLabel: string } | null;
  mintForDisplay: string | null;
  onCopyMint: () => void;
  dense: boolean;
  compact: boolean;
}): React.JSX.Element {
  const data = priceHistory.data;
  const chartSamples = data?.samples ?? [];
  const change = data?.change ?? null;
  const currencyCode = data?.currency ?? 'USD';
  const [chartResetKey, setChartResetKey] = useState(0);
  const chartLoading =
    priceHistory.isLoading ||
    (priceHistory.isFetching && (data == null || data.timeframe !== selectedTimeframe));
  const resetChartInspection = useCallback((): void => {
    setChartResetKey((value) => value + 1);
  }, []);
  const handleTimeframePress = useCallback(
    (timeframe: TokenPriceHistoryTimeframeId): void => {
      resetChartInspection();
      onTimeframeChange(timeframe);
    },
    [onTimeframeChange, resetChartInspection],
  );

  return (
    <View style={[styles.priceCard, compact && styles.priceCardCompact]}>
      <View style={styles.overviewResetZone} onTouchStart={resetChartInspection}>
        <View style={styles.overviewIdentityRow}>
          <TokenIcon
            symbol={holding.symbol}
            name={holding.name}
            logoUri={holding.logo}
            size={dense ? 32 : compact ? 36 : 42}
          />
          <View style={styles.overviewTokenCopy}>
            <View style={styles.nameRow}>
              <TokenNameCopyButton
                name={holding.name}
                mint={mintForDisplay}
                dense={dense}
                onCopy={onCopyMint}
              />
              {holding.verified ? <VerifiedBadge /> : null}
            </View>
            <Text variant="captionBold" color={colors.text.secondary} numberOfLines={1}>
              {holding.symbol}
            </Text>
          </View>
        </View>

        <View style={styles.overviewHero}>
          <Text
            variant="h1"
            color={colors.text.primary}
            style={[
              styles.overviewBalanceValue,
              compact && styles.overviewBalanceValueCompact,
              dense && styles.overviewBalanceValueDense,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.42}
            maxFontSizeMultiplier={1}
          >
            {holding.balance}
          </Text>
          <View style={styles.overviewSubRow}>
            <Text
              variant="body"
              color={colors.text.secondary}
              style={styles.overviewSubText}
              numberOfLines={1}
            >
              {valuation?.fiatValueLabel ?? '--'}
            </Text>
            {change != null ? (
              <Text
                variant="bodyBold"
                color={change.tone === 'negative' ? colors.semantic.error : colors.text.primary}
                style={styles.overviewSubText}
                numberOfLines={1}
              >
                {formatPercentChange(change.percent)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.chartFrame}>
        <PriceLineChart
          samples={chartSamples}
          currency={currencyCode}
          loading={chartLoading}
          resetKey={`${selectedTimeframe}:${chartResetKey}`}
        />
      </View>

      <View
        style={[styles.timeframeRow, compact && styles.timeframeRowCompact]}
        onTouchStart={resetChartInspection}
      >
        {TOKEN_PRICE_HISTORY_TIMEFRAMES.map((timeframe) => {
          const selected = timeframe.id === selectedTimeframe;
          return (
            <Pressable
              key={timeframe.id}
              style={({ pressed }) => [
                styles.timeframeButton,
                selected && styles.timeframeButtonActive,
                pressed ? styles.controlPressed : null,
              ]}
              onPress={() => handleTimeframePress(timeframe.id)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${timeframe.label} token price chart`}
            >
              <Text
                variant="captionBold"
                color={selected ? colors.text.primary : colors.text.tertiary}
                numberOfLines={1}
              >
                {timeframe.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TokenActivitySkeletonRow({ compact }: { compact: boolean }): React.JSX.Element {
  const iconSize = compact ? 42 : 46;
  return (
    <View style={[styles.activitySkeletonRow, compact && styles.activitySkeletonRowCompact]}>
      <SkeletonBlock width={iconSize} height={iconSize} radius={radii.full} />
      <View style={styles.activitySkeletonText}>
        <SkeletonBlock width="46%" height={compact ? 15 : 17} radius={radii.xs} />
        <SkeletonBlock width="70%" height={compact ? 12 : 14} radius={radii.xs} />
      </View>
      <SkeletonBlock width={compact ? 78 : 92} height={compact ? 13 : 15} radius={radii.xs} />
    </View>
  );
}

function TokenActivitySkeletonList({
  compact,
  rowCount = TOKEN_ACTIVITY_INITIAL_FILL_ROWS,
}: {
  compact: boolean;
  rowCount?: number;
}): React.JSX.Element {
  return (
    <View style={styles.activityList}>
      {Array.from({ length: rowCount }, (_, index) => (
        <TokenActivitySkeletonRow key={`token-activity-skeleton-${index}`} compact={compact} />
      ))}
    </View>
  );
}

export function TokenDetailsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const viewportProfile = getViewportProfile({
    width,
    height,
    fontScale,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
  const compact = viewportProfile.compact;
  const dense = viewportProfile.dense;
  const { showToast } = useAppToast();
  const params = useLocalSearchParams<TokenDetailsRouteParams>();
  const requestedMint = getSearchParam(params.mint);
  const routeHoldingSnapshot = useMemo(
    () => buildRouteHoldingSnapshot(params, requestedMint),
    [params, requestedMint],
  );
  const currency = usePreferencesStore((state) => state.currency);
  const { network } = useOffpayNetwork();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const offlineReceipts = useOfflinePaymentStore((state) => state.receipts);
  const privatePaymentReceipts = usePrivatePaymentStore((state) => state.receipts);
  const swapReceipts = useAdvancedSwapStore((state) => state.receipts);
  const [selectedTimeframe, setSelectedTimeframe] = useState<TokenPriceHistoryTimeframeId>('24H');
  const [selectedTransaction, setSelectedTransaction] =
    useState<OffpayHistoryTransactionView | null>(null);
  const [visibleTokenActivityLimit, setVisibleTokenActivityLimit] = useState(
    TOKEN_ACTIVITY_INITIAL_FILL_ROWS,
  );
  const localReceipts = useMemo<OffpayLocalReceiptViewInput[]>(() => {
    return buildLocalHistoryReceiptInputs({
      network,
      walletAddress,
      offlineReceipts,
      privatePaymentReceipts,
      swapReceipts,
    });
  }, [network, offlineReceipts, privatePaymentReceipts, swapReceipts, walletAddress]);
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: true,
    eagerWithoutCapabilities: true,
    requestOwner: 'tokenDetails.balance',
  });
  const tokenLogoMap = useOffpayTokenLogoMap();
  const capabilitiesQuery = useOffpayCapabilities({
    requestOwner: 'tokenDetails.capabilities',
  });
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
  const holding = useMemo(
    () =>
      holdings.find(
        (item) =>
          item.mint === requestedMint ||
          (isNativeSolMintValue(requestedMint) && isNativeSolHolding(item)),
      ) ??
      routeHoldingSnapshot ??
      null,
    [holdings, requestedMint, routeHoldingSnapshot],
  );
  const valuationHoldings = useMemo(() => (holding == null ? [] : [holding]), [holding]);
  const valuationQuery = useOffpayTokenValuations({ holdings: valuationHoldings, currency });
  const valuation = holding == null ? null : (valuationQuery.data?.[holding.mint] ?? null);
  const mintForDisplay =
    holding == null ? requestedMint : isNativeSolHolding(holding) ? NATIVE_SOL_MINT : holding.mint;
  const tokenActivityFilter = useMemo(
    () => getTokenActivityFilter(holding, requestedMint),
    [holding, requestedMint],
  );
  const walletHistoryQuery = useOffpayWalletTransactions({
    autoFetchAllPages: false,
    deferUntilAfterInteractions: false,
    enabled: requestedMint != null,
    limit: WALLET_TRANSACTIONS_PAGE_SIZE,
    minWarmTransactionRows: TOKEN_ACTIVITY_INITIAL_FILL_ROWS,
    allowPartialWarmData: true,
    refetchOnMount: true,
    retry: false,
    requestOwner: 'tokenDetails.walletHistory',
    waitForDashboard: false,
  });
  const selectedTokenSupportsPrivateSend =
    holding != null && holdingSupportsPrivateSend(holding, capabilitiesQuery.network);
  const priceHistoryQuery = useOffpayTokenPriceHistory({
    mint: holding?.priceMint ?? null,
    symbol: holding?.symbol ?? null,
    priceSymbol: holding?.priceSymbol ?? null,
    currency,
    timeframe: selectedTimeframe,
    enabled: holding != null,
  });
  const walletHistoryActivity = useMemo<OffpayHistoryTransactionView[]>(
    () =>
      buildTokenActivityRows({
        filter: tokenActivityFilter,
        transactions: walletHistoryQuery.transactions,
        transactionViews: walletHistoryQuery.transactionViews,
        localReceipts,
        network: walletHistoryQuery.network ?? network,
      }),
    [
      localReceipts,
      network,
      tokenActivityFilter,
      walletHistoryQuery.network,
      walletHistoryQuery.transactionViews,
      walletHistoryQuery.transactions,
    ],
  );
  const shouldBackfillTokenTransactions =
    holding != null &&
    walletHistoryActivity.length < TOKEN_ACTIVITY_INITIAL_FILL_ROWS &&
    !walletHistoryQuery.isInitialDataPending &&
    !walletHistoryQuery.isFetching;
  const tokenTransactionsQuery = useOffpayWalletTokenTransactions({
    mint: holding == null ? null : getTokenActionMint(holding),
    deferUntilAfterInteractions: true,
    limit: MAX_TOKEN_ACTIVITY_ROWS,
    minWarmTransactionRows: TOKEN_ACTIVITY_INITIAL_FILL_ROWS,
    allowPartialWarmData: true,
    refetchOnMount: false,
    enabled: shouldBackfillTokenTransactions,
    requestOwner: 'tokenDetails.transactions.backfill',
  });
  const tokenEndpointActivity = useMemo<OffpayHistoryTransactionView[]>(
    () =>
      buildTokenActivityRows({
        filter: tokenActivityFilter,
        transactions: tokenTransactionsQuery.transactions,
        transactionViews: tokenTransactionsQuery.transactionViews,
        localReceipts,
        network: tokenTransactionsQuery.network ?? network,
      }),
    [
      localReceipts,
      network,
      tokenActivityFilter,
      tokenTransactionsQuery.network,
      tokenTransactionsQuery.transactionViews,
      tokenTransactionsQuery.transactions,
    ],
  );
  const tokenActivity =
    tokenEndpointActivity.length > walletHistoryActivity.length
      ? tokenEndpointActivity
      : walletHistoryActivity;
  const tokenActivityFetching = walletHistoryQuery.isFetching || tokenTransactionsQuery.isFetching;
  const tokenActivityWarmFillPending =
    tokenActivity.length > 0 &&
    tokenActivity.length < TOKEN_ACTIVITY_INITIAL_FILL_ROWS &&
    tokenActivityFetching;
  const visibleTokenActivity = tokenActivity.slice(0, visibleTokenActivityLimit);
  const tokenActivityTopOffRowCount = Math.max(
    1,
    Math.min(4, TOKEN_ACTIVITY_INITIAL_FILL_ROWS - visibleTokenActivity.length),
  );
  const tokenActivityLoading =
    tokenActivity.length === 0 &&
    (walletHistoryQuery.isInitialDataPending ||
      tokenTransactionsQuery.isInitialDataPending ||
      (tokenActivityFetching && walletHistoryQuery.transactions.length === 0));

  useEffect(() => {
    setVisibleTokenActivityLimit(TOKEN_ACTIVITY_INITIAL_FILL_ROWS);
  }, [holding?.mint, requestedMint]);

  useEffect(() => {
    setVisibleTokenActivityLimit((currentLimit) => {
      const initialLimit = Math.min(
        Math.max(TOKEN_ACTIVITY_INITIAL_FILL_ROWS, currentLimit),
        MAX_TOKEN_ACTIVITY_ROWS,
      );
      return tokenActivity.length < initialLimit ? tokenActivity.length : initialLimit;
    });
  }, [tokenActivity.length]);

  const screenHorizontalPadding = viewportProfile.horizontalPadding;
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
        if (!selectedTokenSupportsPrivateSend) {
          searchParams.set('route', 'normal');
        }
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
    [holding, router, selectedTokenSupportsPrivateSend],
  );
  const handleTokenActivityPress = useCallback(
    (transaction: OffpayHistoryTransactionView): void => {
      setSelectedTransaction(transaction);
    },
    [],
  );

  const handleDismissTransactionDetails = useCallback((): void => {
    setSelectedTransaction(null);
  }, []);

  const handleTokenDetailsScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      if (visibleTokenActivityLimit >= tokenActivity.length) return;

      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceFromBottom > TOKEN_ACTIVITY_SCROLL_PREFETCH_PX) return;

      setVisibleTokenActivityLimit((currentLimit) =>
        Math.min(tokenActivity.length, currentLimit + TOKEN_ACTIVITY_BATCH_ROWS),
      );
    },
    [tokenActivity.length, visibleTokenActivityLimit],
  );

  const bottomPadding =
    Math.max(insets.bottom, dense ? spacing.md : spacing.lg) +
    (dense ? spacing['2xl'] : spacing['4xl']);
  const emptyStateMinHeight = dense ? 180 : compact ? 220 : 260;

  return (
    <View style={styles.container}>
      <GradientBackground />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        removeClippedSubviews={Platform.OS === 'android'}
        onScroll={handleTokenDetailsScroll}
        scrollEventThrottle={16}
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
              <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.text.primary} />
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
          <StaggerRevealItem
            index={0}
            style={[styles.contentFrame, styles.emptyState, { minHeight: emptyStateMinHeight }]}
          >
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
          </StaggerRevealItem>
        ) : (
          <StaggerRevealGroup itemStyle={styles.contentFrame}>
            <TokenPriceHistoryCard
              priceHistory={priceHistoryQuery}
              selectedTimeframe={selectedTimeframe}
              onTimeframeChange={setSelectedTimeframe}
              holding={holding}
              valuation={valuation}
              mintForDisplay={mintForDisplay}
              onCopyMint={handleCopyMint}
              dense={dense}
              compact={compact}
            />

            <View style={styles.actionsRow}>
              {TOKEN_DETAIL_ACTIONS.map((action) => (
                <TokenActionButton
                  key={action.id}
                  action={action}
                  compact={actionCompact}
                  onPress={handleTokenAction}
                />
              ))}
            </View>

            <View style={styles.section}>
              <Text variant="bodyBold" color={colors.text.primary} style={styles.sectionTitle}>
                Recent Activity
              </Text>
              {tokenActivityLoading ? (
                <TokenActivitySkeletonList compact={compact} />
              ) : visibleTokenActivity.length > 0 ? (
                <View style={styles.activityList}>
                  {visibleTokenActivity.map((transaction) => {
                    const activityDate = formatActivityDateTime(transaction.detailTimestampMs);

                    return (
                      <TransactionActivityRow
                        key={transaction.id}
                        tx={
                          activityDate == null
                            ? transaction
                            : {
                                ...transaction,
                                subtitle: `${transaction.subtitle} · ${activityDate}`,
                              }
                        }
                        compact={compact}
                        tokenLogos={tokenLogoMap}
                        onPress={() => handleTokenActivityPress(transaction)}
                      />
                    );
                  })}
                  {tokenActivityWarmFillPending ? (
                    <TokenActivitySkeletonList
                      compact={compact}
                      rowCount={tokenActivityTopOffRowCount}
                    />
                  ) : null}
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
          </StaggerRevealGroup>
        )}
      </ScrollView>
      <TransactionDetailsSheet
        transaction={selectedTransaction}
        tokenLogos={tokenLogoMap}
        onDismiss={handleDismissTransactionDetails}
      />
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
    alignItems: 'stretch',
  },
  contentFrame: {
    width: '100%',
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  tokenNameButton: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tokenName: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  tokenNameDense: {
    fontSize: 22,
    lineHeight: 28,
  },
  tokenCopyButton: {
    flexShrink: 0,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadge: {
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: radii.full,
    backgroundColor: colors.brand.whiteStream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: colors.brand.whiteStream,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 -1px 1px rgba(0, 0, 0, 0.15)',
    ].join(', '),
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fontFamily.semiBold,
  },
  priceCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.backgroundAlt,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    boxShadow: TOKEN_DETAIL_PANEL_SHADOW,
  },
  priceCardCompact: {
    padding: spacing.md,
  },
  overviewResetZone: {
    gap: spacing.md,
  },
  overviewIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  overviewTokenCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  overviewHero: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  overviewBalanceValue: {
    width: '100%',
    textAlign: 'center',
    fontSize: 42,
    lineHeight: 48,
    fontFamily: fontFamily.moneyBold,
    fontVariant: ['tabular-nums'],
  },
  overviewBalanceValueCompact: {
    fontSize: 36,
    lineHeight: 42,
  },
  overviewBalanceValueDense: {
    fontSize: 32,
    lineHeight: 38,
  },
  overviewSubRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  overviewSubText: {
    fontFamily: fontFamily.moneyLight,
    fontVariant: ['tabular-nums'],
  },
  chartFrame: {
    minHeight: PRICE_CHART_VIEWBOX_HEIGHT,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    justifyContent: 'center',
    marginHorizontal: -spacing.md,
  },
  chartInteractiveFrame: {
    width: '100%',
    height: PRICE_CHART_VIEWBOX_HEIGHT,
    justifyContent: 'center',
  },
  chartEmptyLine: {
    height: PRICE_CHART_VIEWBOX_HEIGHT,
    borderRadius: radii.lg,
    backgroundColor: colors.glass.smokeWash,
  },
  chartLoadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.glass.clearFill,
  },
  timeframeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  timeframeRowCompact: {
    gap: spacing.xs,
  },
  timeframeButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    backgroundColor: 'transparent',
  },
  timeframeButtonActive: {
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 -1px 1px rgba(0, 0, 0, 0.2)',
    ].join(', '),
  },
  activityList: {
    gap: spacing.md,
  },
  activitySkeletonRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: colors.surface.cardElevated,
    boxShadow: '0 10px 22px rgba(0, 0, 0, 0.32)',
  },
  activitySkeletonRowCompact: {
    minHeight: 74,
    gap: spacing.sm,
  },
  activitySkeletonText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
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
