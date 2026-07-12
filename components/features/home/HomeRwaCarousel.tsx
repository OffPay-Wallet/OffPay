import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  formatRwaAssetDisplayName,
  formatRwaChangeLabel,
  formatUsd,
  getRwaAssetLogoUri,
  RWA_CATEGORY_LABELS,
  type RwaTradeSide,
} from '@/components/features/rwa/rwa-trade-utils';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useCancelSafePress } from '@/hooks/useCancelSafePress';
import { useRwaAssets } from '@/hooks/useRwaAssets';

import type { CapabilitiesResponse, OffpayNetwork, RwaAsset } from '@/types/offpay-api';

const HOME_RWA_PREVIEW_LIMIT = 4;
const HOME_RWA_CARD_SHADOW = '0 10px 22px rgba(0, 0, 0, 0.4)';

function isTradeSideAvailable(asset: RwaAsset, side: RwaTradeSide): boolean {
  return (
    asset.tradable &&
    (asset.execution[side] === 'jupiter_swap' || asset.execution[side] === 'devnet_sandbox')
  );
}

function RwaActionButton({
  label,
  disabled,
  side,
  onPress,
}: {
  label: string;
  disabled: boolean;
  side: RwaTradeSide;
  onPress: () => void;
}): React.JSX.Element {
  const buy = side === 'buy';
  const activeStyle = buy ? styles.buyButton : styles.sellButton;
  const pressedStyle = buy ? styles.buyButtonPressed : styles.sellButtonPressed;
  const press = useCancelSafePress({ disabled, onPress });

  return (
    <Pressable
      disabled={disabled}
      onPress={press.onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onResponderTerminate={press.onResponderTerminate}
      onResponderTerminationRequest={press.onResponderTerminationRequest}
      style={[
        styles.actionButton,
        disabled ? styles.actionButtonDisabled : activeStyle,
        press.pressed ? pressedStyle : null,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${label} RWA`}
    >
      <Text
        variant="captionBold"
        color={disabled ? colors.text.tertiary : colors.text.primary}
        style={styles.actionLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const HomeRwaAssetCard = memo(function HomeRwaAssetCard({
  asset,
  cardWidth,
  dense,
  onBuy,
  onSell,
}: {
  asset: RwaAsset;
  cardWidth: number;
  dense: boolean;
  onBuy: (asset: RwaAsset) => void;
  onSell: (asset: RwaAsset) => void;
}): React.JSX.Element {
  const displayName = formatRwaAssetDisplayName(asset);
  const displaySymbol = asset.underlyingSymbol ?? asset.symbol;
  const changeLabel = formatRwaChangeLabel(asset.change24hPct);
  const changeTone =
    asset.change24hPct == null
      ? colors.text.tertiary
      : asset.change24hPct >= 0
        ? colors.semantic.receive
        : colors.semantic.error;
  const buyDisabled = !isTradeSideAvailable(asset, 'buy');
  const sellDisabled = !isTradeSideAvailable(asset, 'sell');

  return (
    <View style={[styles.assetCard, { width: cardWidth }]}>
      <View style={styles.assetIdentityRow}>
        <TokenIcon
          symbol={displaySymbol}
          name={displayName}
          logoUri={getRwaAssetLogoUri(asset)}
          size={dense ? 40 : 44}
          recyclingKey={asset.mint}
        />
        <View style={styles.assetCopy}>
          <Text
            variant="captionBold"
            color={colors.text.primary}
            style={styles.assetName}
            numberOfLines={2}
            maxFontSizeMultiplier={1.15}
          >
            {displayName}
          </Text>
          <Text
            variant="small"
            color={colors.text.tertiary}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
          >
            {RWA_CATEGORY_LABELS[asset.category]} · {displaySymbol}
          </Text>
        </View>
      </View>

      <View style={styles.assetMarketRow}>
        <View style={styles.marketMetric}>
          <Text variant="small" color={colors.text.tertiary} maxFontSizeMultiplier={1.15}>
            Price
          </Text>
          <Text
            variant="money"
            color={colors.text.primary}
            style={styles.priceText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1.15}
          >
            {formatUsd(asset.priceUsd)}
          </Text>
        </View>
        <View style={[styles.marketMetric, styles.marketMetricEnd]}>
          <Text variant="small" color={colors.text.tertiary} maxFontSizeMultiplier={1.15}>
            24h
          </Text>
          <Text
            variant="captionBold"
            color={changeLabel == null ? colors.text.tertiary : changeTone}
            style={styles.changeText}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
          >
            {changeLabel ?? '—'}
          </Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <RwaActionButton
          label="Buy"
          side="buy"
          disabled={buyDisabled}
          onPress={() => onBuy(asset)}
        />
        <RwaActionButton
          label="Sell"
          side="sell"
          disabled={sellDisabled}
          onPress={() => onSell(asset)}
        />
      </View>
    </View>
  );
});

function HomeRwaSkeletonCard({
  cardWidth,
  dense,
}: {
  cardWidth: number;
  dense: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.assetCard, { width: cardWidth }]}>
      <View style={styles.assetIdentityRow}>
        <SkeletonBlock width={dense ? 40 : 44} height={dense ? 40 : 44} radius={radii.full} />
        <View style={styles.skeletonIdentityCopy}>
          <SkeletonBlock width="78%" height={16} radius={radii.full} />
          <SkeletonBlock width="58%" height={11} radius={radii.full} />
        </View>
      </View>
      <View style={styles.assetMarketRow}>
        <View style={styles.skeletonPriceBlock}>
          <SkeletonBlock width={30} height={10} radius={radii.full} />
          <SkeletonBlock width={72} height={16} radius={radii.full} />
        </View>
        <View style={[styles.skeletonPriceBlock, styles.marketMetricEnd]}>
          <SkeletonBlock width={24} height={10} radius={radii.full} />
          <SkeletonBlock width={44} height={14} radius={radii.full} />
        </View>
      </View>
      <View style={styles.actionsRow}>
        <SkeletonBlock width="48%" height={layout.minTouchTarget} radius={radii.lg} />
        <SkeletonBlock width="48%" height={layout.minTouchTarget} radius={radii.lg} />
      </View>
    </View>
  );
}

function ViewAllRwaCard({
  cardWidth,
  onPress,
}: {
  cardWidth: number;
  onPress: () => void;
}): React.JSX.Element {
  const press = useCancelSafePress({ onPress });

  return (
    <Pressable
      onPress={press.onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onResponderTerminate={press.onResponderTerminate}
      onResponderTerminationRequest={press.onResponderTerminationRequest}
      style={[
        styles.viewAllCard,
        { width: cardWidth },
        press.pressed ? styles.viewAllCardPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel="View all RWAs"
    >
      <View style={styles.viewAllIcon}>
        <Ionicons name="arrow-forward" size={24} color={colors.text.primary} />
      </View>
      <Text variant="bodyBold" color={colors.text.primary} style={styles.assetName}>
        View all
      </Text>
    </Pressable>
  );
}

interface HomeRwaCarouselProps {
  network: OffpayNetwork | null;
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null;
  capabilitiesPending: boolean;
  onBuy: (asset: RwaAsset) => void;
  onSell: (asset: RwaAsset) => void;
  onViewAll: () => void;
}

export function HomeRwaCarousel({
  network,
  canUseNetwork,
  capabilities,
  capabilitiesPending,
  onBuy,
  onSell,
  onViewAll,
}: HomeRwaCarouselProps): React.JSX.Element | null {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const cardWidth = dense ? 188 : compact ? 204 : 220;
  const { canLoadAssets, query: assetsQuery } = useRwaAssets({
    network,
    canUseNetwork,
    capabilities,
    requestOwner: 'home.rwa.assets',
  });
  const assets = useMemo(() => assetsQuery.data?.assets ?? [], [assetsQuery.data?.assets]);
  const previewAssets = useMemo(() => assets.slice(0, HOME_RWA_PREVIEW_LIMIT), [assets]);
  const loading =
    capabilitiesPending || (canLoadAssets && assetsQuery.isPending && assetsQuery.data == null);
  const showViewAll = assets.length > HOME_RWA_PREVIEW_LIMIT;

  if (!loading && assets.length === 0 && !assetsQuery.isError) return null;
  if (!loading && !canLoadAssets && !assetsQuery.isError) return null;

  return (
    <View style={styles.section}>
      <View style={[styles.headerRow, compact && styles.headerRowCompact]}>
        <Text
          variant="bodyBold"
          color={colors.text.primary}
          style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
        >
          RWAs
        </Text>
        <Pressable
          style={styles.headerAction}
          onPress={onViewAll}
          accessibilityRole="button"
          accessibilityLabel="View all RWAs"
          hitSlop={6}
        >
          <Text
            variant="captionBold"
            color={colors.semantic.info}
            style={styles.headerActionText}
            numberOfLines={1}
            maxFontSizeMultiplier={1}
          >
            View All
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carouselContent}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <>
            <HomeRwaSkeletonCard cardWidth={cardWidth} dense={dense} />
            <HomeRwaSkeletonCard cardWidth={cardWidth} dense={dense} />
          </>
        ) : assetsQuery.isError ? (
          <View style={[styles.stateCard, { width: cardWidth * 1.42 }]}>
            <LazyLoadingSpinner size={24} color={colors.text.secondary} />
            <Text variant="caption" color={colors.text.secondary} align="center" numberOfLines={2}>
              RWAs unavailable
            </Text>
          </View>
        ) : (
          <>
            {previewAssets.map((asset) => (
              <HomeRwaAssetCard
                key={asset.id}
                asset={asset}
                cardWidth={cardWidth}
                dense={dense}
                onBuy={onBuy}
                onSell={onSell}
              />
            ))}
            {showViewAll ? <ViewAllRwaCard cardWidth={cardWidth} onPress={onViewAll} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  headerRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerRowCompact: {
    minHeight: 36,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.displaySemiBold,
  },
  sectionTitleCompact: {
    fontSize: 18,
    lineHeight: 23,
  },
  headerAction: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerActionText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  carouselContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  assetCard: {
    minHeight: 196,
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: HOME_RWA_CARD_SHADOW,
  },
  assetIdentityRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  assetCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  assetName: {
    fontFamily: fontFamily.uiSemiBold,
  },
  assetMarketRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  marketMetric: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  marketMetricEnd: {
    alignItems: 'flex-end',
  },
  skeletonIdentityCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  skeletonPriceBlock: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  priceText: {
    fontFamily: fontFamily.moneyBold,
    fontVariant: ['tabular-nums'],
  },
  changeText: {
    fontFamily: fontFamily.uiSemiBold,
    fontVariant: ['tabular-nums'],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    minHeight: layout.minTouchTarget,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buyButton: {
    backgroundColor: colors.semantic.receiveSoftFill,
    borderColor: colors.semantic.receiveSoftBorder,
  },
  buyButtonPressed: {
    backgroundColor: colors.semantic.receiveSoftFillPressed,
  },
  sellButton: {
    backgroundColor: colors.semantic.errorSoftFill,
    borderColor: colors.semantic.errorSoftBorder,
  },
  sellButtonPressed: {
    backgroundColor: colors.semantic.errorSoftFillPressed,
  },
  actionButtonDisabled: {
    backgroundColor: colors.surface.disabled,
    borderColor: colors.glass.rimSubtle,
  },
  actionLabel: {
    fontFamily: fontFamily.medium,
  },
  viewAllCard: {
    minHeight: 196,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.clearFill,
  },
  viewAllCardPressed: {
    backgroundColor: colors.surface.solidControlPressed,
  },
  viewAllIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  stateCard: {
    minHeight: 196,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
});
