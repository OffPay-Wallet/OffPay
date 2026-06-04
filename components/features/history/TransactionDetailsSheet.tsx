import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PuffyReceiveArrowIcon } from '@/components/ui/icons/PuffyReceiveArrowIcon';
import { PuffySendIcon } from '@/components/ui/icons/PuffySendIcon';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useOverlayVisibilityStore } from '@/store/overlayVisibilityStore';

import type {
  OffpayDisplayTone,
  OffpayDisplayTransactionType,
  OffpayRecentActivityView,
  TokenLogoLookup,
} from '@/lib/api/offpay-wallet-data';
import type { OffpayNetwork } from '@/types/offpay-api';

const SHEET_OPEN_TIMING = {
  duration: 340,
  easing: Easing.out(Easing.cubic),
};
const SHEET_CLOSE_TIMING = {
  duration: 240,
  easing: Easing.in(Easing.cubic),
};
const FADE_TIMING = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
};
const TRANSACTION_DETAILS_OVERLAY_ID = 'transaction-details-sheet';
const SHEET_MAX_WIDTH = 430;
const SHEET_SHADOW = [
  'inset 0 1px 1px rgba(255, 255, 255, 0.16)',
  'inset 0 -1px 2px rgba(0, 0, 0, 0.34)',
  '0 8px 22px rgba(0, 0, 0, 0.32)',
].join(', ');

const AMOUNT_COLORS: Record<OffpayDisplayTone, string> = {
  positive: colors.semantic.receive,
  negative: colors.semantic.error,
  neutral: colors.text.primary,
  failed: colors.semantic.error,
};

function buildExplorerUrl(signature: string, network: OffpayNetwork): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

function getNetworkLabel(network: OffpayNetwork | null): string {
  if (network === 'devnet') return 'Solana Devnet';
  return 'Solana';
}

function normalizeTokenLogoSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function getStatusMeta(status: OffpayRecentActivityView['status']): {
  label: string;
  color: string;
} {
  if (status === 'failed') return { label: 'Failed', color: colors.semantic.error };
  if (status === 'pending') return { label: 'Pending', color: colors.semantic.warning };
  return { label: 'Succeeded', color: colors.semantic.success };
}

function getFallbackAccountLabel(type: OffpayDisplayTransactionType): string {
  if (type === 'receive') return 'From';
  if (type === 'send') return 'To';
  return 'With';
}

function formatSheetDate(timestampMs: number | null): string {
  if (timestampMs == null) return '--';

  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestampMs));
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(new Date(timestampMs))
    .toLowerCase();

  return `${date} at ${time}`;
}

function ActionBadge({
  type,
  tone,
  size,
}: {
  type: OffpayDisplayTransactionType;
  tone: OffpayDisplayTone;
  size: number;
}): React.JSX.Element {
  const color = tone === 'failed' ? colors.semantic.error : colors.brand.glossAccent;

  if (type === 'receive') return <PuffyReceiveArrowIcon size={size} color={color} />;
  if (type === 'swap') return <PuffySwapIcon size={size} color={color} focused />;
  return <PuffySendIcon size={size} color={color} />;
}

function DetailDivider(): React.JSX.Element {
  return <View style={styles.detailDivider} />;
}

function DetailRow({
  label,
  value,
  valueColor = colors.text.primary,
  mono = false,
  dense = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
  dense?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.detailRow, dense && styles.detailRowDense]}>
      <Text
        variant="body"
        color={colors.text.secondary}
        style={[styles.detailLabel, dense && styles.detailTextDense]}
        numberOfLines={1}
        maxFontSizeMultiplier={1}
      >
        {label}
      </Text>
      <Text
        variant={mono ? 'mono' : 'bodyBold'}
        color={valueColor}
        style={[styles.detailValue, mono && styles.monoValue, dense && styles.detailTextDense]}
        numberOfLines={1}
        ellipsizeMode="middle"
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        maxFontSizeMultiplier={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function TransactionDetailsSheet({
  transaction,
  tokenLogos,
  onDismiss,
}: {
  transaction: OffpayRecentActivityView | null;
  tokenLogos?: TokenLogoLookup;
  onDismiss: () => void;
}): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const compact = width < 390 || height < 760 || fontScale > 1.08;
  const dense = width < 350 || height < 700 || fontScale > 1.16;
  const [mounted, setMounted] = useState(transaction != null);
  const [visibleTransaction, setVisibleTransaction] = useState(transaction);
  const translateY = useSharedValue(height);
  const opacity = useSharedValue(0);
  const showOverlay = useOverlayVisibilityStore((s) => s.showOverlay);
  const hideOverlay = useOverlayVisibilityStore((s) => s.hideOverlay);

  const finishClose = useCallback((): void => {
    setMounted(false);
    setVisibleTransaction(null);
  }, []);

  useEffect(() => {
    if (transaction != null) {
      setVisibleTransaction(transaction);
      setMounted(true);
      translateY.value = height;
      opacity.value = 0;
      const frame = requestAnimationFrame(() => {
        opacity.value = withTiming(1, FADE_TIMING);
        translateY.value = withTiming(0, SHEET_OPEN_TIMING);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!mounted) return undefined;

    opacity.value = withTiming(0, FADE_TIMING);
    translateY.value = withTiming(height, SHEET_CLOSE_TIMING, (finished) => {
      if (finished) runOnJS(finishClose)();
    });

    return undefined;
  }, [finishClose, height, mounted, opacity, transaction, translateY]);

  useEffect(() => {
    if (mounted) {
      showOverlay(TRANSACTION_DETAILS_OVERLAY_ID);
    } else {
      hideOverlay(TRANSACTION_DETAILS_OVERLAY_ID);
    }

    return () => hideOverlay(TRANSACTION_DETAILS_OVERLAY_ID);
  }, [hideOverlay, mounted, showOverlay]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const sheetData = useMemo(() => {
    if (visibleTransaction == null) return null;

    const primarySymbol = visibleTransaction.tokenSymbol ?? 'Token';
    const logoUri =
      visibleTransaction.tokenLogo ??
      (visibleTransaction.tokenMint == null
        ? null
        : (tokenLogos?.byMint?.get(visibleTransaction.tokenMint) ?? null)) ??
      (visibleTransaction.tokenSymbol == null
        ? null
        : (tokenLogos?.bySymbol?.get(normalizeTokenLogoSymbol(visibleTransaction.tokenSymbol)) ??
          null));
    const signature = visibleTransaction.detailSignature;
    const network = visibleTransaction.detailNetwork;
    const canOpenExplorer = signature != null && network != null;

    return {
      amountLabel: visibleTransaction.amountLabel ?? '--',
      accountLabel:
        visibleTransaction.detailAccountLabel ?? getFallbackAccountLabel(visibleTransaction.type),
      accountValue:
        visibleTransaction.detailAccountAddress == null
          ? '--'
          : shortenWalletAddress(visibleTransaction.detailAccountAddress, 4),
      canOpenExplorer,
      dateLabel: formatSheetDate(visibleTransaction.detailTimestampMs),
      explorerUrl: canOpenExplorer ? buildExplorerUrl(signature, network) : null,
      logoUri,
      networkLabel: getNetworkLabel(network),
      primarySymbol,
      status: getStatusMeta(visibleTransaction.status),
    };
  }, [tokenLogos, visibleTransaction]);

  if (!mounted || visibleTransaction == null || sheetData == null) return null;

  const iconSize = dense ? 44 : compact ? 50 : 56;
  const actionBadgeSize = dense ? 22 : compact ? 24 : 26;
  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim opacity={0.72} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close transaction details"
        />
      </Animated.View>

      <View
        style={[
          styles.sheetFrame,
          {
            paddingHorizontal: dense ? spacing.md : spacing.lg,
            paddingBottom: overlayPaddingBottom,
          },
        ]}
        accessibilityViewIsModal
      >
        <Animated.View
          style={[
            styles.sheet,
            dense && styles.sheetDense,
            { width: '100%', maxWidth: SHEET_MAX_WIDTH },
            sheetStyle,
          ]}
        >
          <View style={styles.sheetHeader}>
            <View
              style={styles.headerSide}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text
              variant="h2"
              color={colors.text.primary}
              style={[styles.title, dense && styles.titleDense]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1}
            >
              {visibleTransaction.title}
            </Text>
            <View style={[styles.headerSide, styles.headerRight]}>
              <Pressable
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                onPress={onDismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close transaction details"
              >
                <Ionicons name="close" size={dense ? 18 : 20} color={colors.text.primary} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.sheetContent, dense && styles.sheetContentDense]}>
            <View style={styles.hero}>
              <View style={[styles.assetFrame, { width: iconSize, height: iconSize }]}>
                <TokenIcon
                  symbol={sheetData.primarySymbol}
                  name={visibleTransaction.tokenName ?? sheetData.primarySymbol}
                  logoUri={sheetData.logoUri}
                  size={iconSize}
                  recyclingKey={visibleTransaction.tokenMint ?? visibleTransaction.id}
                />
                <View
                  style={[
                    styles.actionBadge,
                    {
                      width: actionBadgeSize,
                      height: actionBadgeSize,
                      borderRadius: actionBadgeSize / 2,
                    },
                  ]}
                >
                  <ActionBadge
                    type={visibleTransaction.type}
                    tone={visibleTransaction.amountTone}
                    size={Math.round(actionBadgeSize * 0.72)}
                  />
                </View>
              </View>

              <Text
                variant="h1"
                color={AMOUNT_COLORS[visibleTransaction.amountTone]}
                style={[
                  styles.amount,
                  compact && styles.amountCompact,
                  dense && styles.amountDense,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.48}
                maxFontSizeMultiplier={1}
              >
                {sheetData.amountLabel}
              </Text>
            </View>

            <View style={[styles.detailPanel, dense && styles.detailPanelDense]}>
              <DetailRow label="Date" value={sheetData.dateLabel} dense={dense} />
              <DetailDivider />
              <DetailRow
                label="Status"
                value={sheetData.status.label}
                valueColor={sheetData.status.color}
                dense={dense}
              />
              <DetailDivider />
              <DetailRow
                label={sheetData.accountLabel}
                value={sheetData.accountValue}
                mono={sheetData.accountValue !== '--'}
                dense={dense}
              />
              <DetailDivider />
              <DetailRow label="Network" value={sheetData.networkLabel} dense={dense} />
              <DetailDivider />
              <Pressable
                style={({ pressed }) => [
                  styles.explorerRow,
                  dense && styles.explorerRowDense,
                  !sheetData.canOpenExplorer && styles.explorerRowDisabled,
                  pressed && sheetData.canOpenExplorer && styles.pressed,
                ]}
                disabled={!sheetData.canOpenExplorer}
                onPress={() => {
                  if (sheetData.explorerUrl == null) return;
                  void Linking.openURL(sheetData.explorerUrl);
                }}
                accessibilityRole={sheetData.canOpenExplorer ? 'link' : undefined}
                accessibilityLabel={
                  sheetData.canOpenExplorer
                    ? 'View transaction on Solscan'
                    : 'Solscan link unavailable'
                }
              >
                <Text
                  variant="bodyBold"
                  color={
                    sheetData.canOpenExplorer ? colors.brand.glossAccent : colors.text.tertiary
                  }
                  style={styles.explorerText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1}
                >
                  {sheetData.canOpenExplorer ? 'View on Solscan' : 'Solscan unavailable'}
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 9999,
    elevation: 9999,
  },
  sheetFrame: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.graphiteDepth,
    boxShadow: SHEET_SHADOW,
  },
  sheetDense: {
    borderRadius: radii.xl,
  },
  sheetHeader: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerSide: {
    width: 38,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontSize: 24,
    lineHeight: 30,
  },
  titleDense: {
    fontSize: 22,
    lineHeight: 28,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.28)',
    ].join(', '),
  },
  pressed: {
    opacity: 0.72,
  },
  sheetContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  sheetContentDense: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  assetFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  amount: {
    width: '100%',
    textAlign: 'center',
    fontFamily: fontFamily.moneyBold,
    fontSize: 36,
    lineHeight: 42,
    fontVariant: ['tabular-nums'],
  },
  amountCompact: {
    fontSize: 32,
    lineHeight: 38,
  },
  amountDense: {
    fontSize: 28,
    lineHeight: 34,
  },
  detailPanel: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surface.backgroundTint,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.08)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.26)',
    ].join(', '),
  },
  detailPanelDense: {
    borderRadius: radii.lg,
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
  detailRow: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
  },
  detailRowDense: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    width: 88,
    flexShrink: 0,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamily.uiMedium,
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamily.uiSemiBold,
  },
  detailTextDense: {
    fontSize: 14,
    lineHeight: 18,
  },
  monoValue: {
    fontFamily: fontFamily.monoMedium,
  },
  explorerRow: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explorerRowDense: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  explorerRowDisabled: {
    opacity: 0.6,
  },
  explorerText: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 20,
  },
});
