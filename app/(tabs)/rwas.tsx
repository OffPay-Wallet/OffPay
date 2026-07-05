import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/ui/GradientBackground';
import { PuffyRwaIcon } from '@/components/ui/icons/PuffyRwaIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import { getRwaAssets } from '@/lib/api/offpay-api-client';

import type { RwaAsset } from '@/types/offpay-api';

const RWA_ASSETS_STALE_TIME_MS = 5 * 60 * 1000;
const RWA_ASSETS_GC_TIME_MS = 15 * 60 * 1000;
const RWA_CONTENT_MAX_WIDTH = 560;

const RWA_CATEGORY_LABELS: Record<RwaAsset['category'], string> = {
  equity: 'Equity',
  etf: 'ETF',
  treasury: 'Treasury',
  commodity: 'Commodity',
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 2 : 4,
  }).format(value);
}

function formatChange(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function rwaAssetsQueryKey(network: string | null) {
  return ['offpay', 'rwa', 'assets', network] as const;
}

function RwaAssetRow({ asset, dense }: { asset: RwaAsset; dense: boolean }): React.JSX.Element {
  const positive = asset.change24hPct >= 0;

  return (
    <View style={[styles.assetCard, dense && styles.assetCardDense]}>
      <View style={styles.assetHeader}>
        <View style={styles.assetIdentity}>
          <View style={styles.symbolBadge}>
            <Text
              variant="caption"
              color={colors.text.onAccent}
              style={styles.symbolText}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {asset.symbol}
            </Text>
          </View>
          <View style={styles.assetNameBlock}>
            <Text
              variant="body"
              color={colors.text.primary}
              style={styles.assetName}
              numberOfLines={1}
            >
              {asset.name}
            </Text>
            <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
              {RWA_CATEGORY_LABELS[asset.category]} · {asset.providerLabel}
            </Text>
          </View>
        </View>
        <View style={styles.priceBlock}>
          <Text variant="body" color={colors.text.primary} style={styles.priceText}>
            {formatUsd(asset.priceUsd)}
          </Text>
          <Text
            variant="caption"
            color={positive ? colors.semantic.receive : colors.semantic.error}
            style={styles.changeText}
          >
            {formatChange(asset.change24hPct)}
          </Text>
        </View>
      </View>

      <View style={styles.assetMetaRow}>
        <View style={styles.metaPill}>
          <Ionicons name="flask-outline" size={14} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            Devnet
          </Text>
        </View>
        <View style={styles.metaPill}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            Sandbox
          </Text>
        </View>
        <View style={styles.metaPill}>
          <Ionicons name="logo-usd" size={14} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            {asset.settlementSymbol}
          </Text>
        </View>
      </View>

      <Text
        variant="caption"
        color={colors.text.tertiary}
        style={styles.complianceText}
        numberOfLines={2}
      >
        {asset.complianceLabel}
      </Text>

      <View style={styles.actionRow}>
        <Pressable disabled style={[styles.actionButton, styles.actionButtonDisabled]}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.text.tertiary} />
          <Text variant="caption" color={colors.text.tertiary} style={styles.actionLabel}>
            Buy
          </Text>
        </Pressable>
        <Pressable disabled style={[styles.actionButton, styles.actionButtonDisabled]}>
          <Ionicons name="flash-outline" size={16} color={colors.text.tertiary} />
          <Text variant="caption" color={colors.text.tertiary} style={styles.actionLabel}>
            MagicBlock
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function RwasScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.xl;
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkSwitching } = useOffpayNetworkAccess();
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const capabilities = capabilitiesQuery.capabilities;
  const assetsCapability = getOffpayFeatureCapability(capabilities, 'rwa.assets');
  const canLoadAssets =
    network != null && canUseNetwork && isOffpayFeatureAvailable(capabilities, 'rwa.assets');

  const assetsQuery = useQuery({
    queryKey: rwaAssetsQueryKey(network),
    queryFn: ({ signal }) => {
      if (network == null) {
        throw new Error('RWA assets require a supported OffPay network.');
      }

      return getRwaAssets(network, {
        signal,
        requestOwner: 'rwa.assets',
      });
    },
    enabled: canLoadAssets,
    staleTime: RWA_ASSETS_STALE_TIME_MS,
    gcTime: RWA_ASSETS_GC_TIME_MS,
    refetchOnMount: false,
  });

  const assets = assetsQuery.data?.assets ?? [];
  const statusLabel = useMemo(() => {
    if (isNetworkSwitching) return 'Switching';
    if (!canUseNetwork) return 'Offline';
    if (capabilitiesQuery.isCapabilitiesPending) return 'Loading';
    if (!assetsCapability.available) return assetsCapability.reason === 'unsupported_network'
      ? 'Devnet only'
      : 'Unavailable';
    return assetsQuery.isPending ? 'Loading' : 'Devnet sandbox';
  }, [
    assetsCapability.available,
    assetsCapability.reason,
    assetsQuery.isPending,
    canUseNetwork,
    capabilitiesQuery.isCapabilitiesPending,
    isNetworkSwitching,
  ]);

  const contentState = useMemo(() => {
    if (capabilitiesQuery.isCapabilitiesPending || assetsQuery.isPending) return 'loading';
    if (assetsQuery.isError) return 'error';
    if (!assetsCapability.available) return 'unavailable';
    if (assets.length === 0) return 'empty';
    return 'ready';
  }, [
    assets.length,
    assetsCapability.available,
    assetsQuery.isError,
    assetsQuery.isPending,
    capabilitiesQuery.isCapabilitiesPending,
  ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: horizontalPadding,
            paddingBottom: bottomPadding,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.iconShell}>
            <PuffyRwaIcon size={dense ? 34 : 42} color={colors.text.primary} focused />
          </View>
          <View style={styles.headerText}>
            <Text
              variant={compact ? 'h3' : 'h2'}
              color={colors.text.inverse}
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.84}
            >
              RWAs
            </Text>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>

        {contentState === 'loading' ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={colors.text.primary} />
            <Text variant="caption" color={colors.text.secondary}>
              Loading RWA assets
            </Text>
          </View>
        ) : null}

        {contentState === 'error' ? (
          <View style={styles.statePanel}>
            <Ionicons name="warning-outline" size={22} color={colors.semantic.error} />
            <Text variant="body" color={colors.text.primary} align="center">
              RWA assets are unavailable
            </Text>
            <Text variant="caption" color={colors.text.secondary} align="center">
              {assetsQuery.error instanceof Error
                ? assetsQuery.error.message
                : 'Try again once the network is available.'}
            </Text>
          </View>
        ) : null}

        {contentState === 'unavailable' ? (
          <View style={styles.statePanel}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.text.secondary} />
            <Text variant="body" color={colors.text.primary} align="center">
              {assetsCapability.message}
            </Text>
          </View>
        ) : null}

        {contentState === 'empty' ? (
          <View style={styles.statePanel}>
            <Ionicons name="albums-outline" size={22} color={colors.text.secondary} />
            <Text variant="body" color={colors.text.primary} align="center">
              No RWA assets on this network
            </Text>
          </View>
        ) : null}

        {contentState === 'ready' ? (
          <View style={styles.assetList}>
            {assets.map((asset) => (
              <RwaAssetRow key={asset.id} asset={asset} dense={dense} />
            ))}
          </View>
        ) : null}
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
  content: {
    width: '100%',
    maxWidth: RWA_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingTop: spacing['2xl'],
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconShell: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 34,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamily.display,
  },
  statusPill: {
    alignSelf: 'flex-start',
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.glass.badgeFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.semantic.receive,
  },
  statePanel: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetList: {
    gap: spacing.md,
  },
  assetCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetCardDense: {
    padding: spacing.md,
  },
  assetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  assetIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  symbolBadge: {
    width: 58,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.brand.glossAccent,
  },
  symbolText: {
    fontFamily: fontFamily.mono,
    fontWeight: '800',
  },
  assetNameBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  assetName: {
    fontFamily: fontFamily.medium,
  },
  priceBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  priceText: {
    fontFamily: fontFamily.medium,
  },
  changeText: {
    fontFamily: fontFamily.medium,
  },
  assetMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaPill: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  complianceText: {
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    minHeight: layout.buttonHeightSm,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonDisabled: {
    backgroundColor: colors.surface.disabled,
    borderColor: colors.glass.rimSubtle,
  },
  actionLabel: {
    fontFamily: fontFamily.medium,
  },
});
