import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/ui/GradientBackground';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export interface SwapReviewDetailRow {
  label: string;
  value: string;
}

export interface SwapReviewTokenLeg {
  label: string;
  amount: string;
  symbol: string;
  name: string;
  logo: string | null;
}

interface SwapReviewFlowScreenProps {
  visible: boolean;
  title: string;
  statusLabel: string;
  payLeg: SwapReviewTokenLeg | null;
  receiveLeg: SwapReviewTokenLeg | null;
  detailRows: SwapReviewDetailRow[];
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SwapReviewFlowScreen({
  visible,
  title,
  statusLabel,
  payLeg,
  receiveLeg,
  detailRows,
  confirmLabel,
  busyLabel = 'Signing',
  cancelLabel = 'Cancel',
  busy = false,
  onCancel,
  onConfirm,
}: SwapReviewFlowScreenProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 820 || fontScale > 1.05;
  const dense = windowWidth < 350 || windowHeight < 720 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const topPadding = dense ? spacing.sm : compact ? spacing.md : spacing.lg;
  const footerPaddingBottom = Math.max(insets.bottom, spacing.sm) + spacing.sm;

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      style={styles.screen}
    >
      <GradientBackground />
      <View style={[styles.safeFrame, { paddingTop: insets.top }]}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: topPadding,
              paddingHorizontal: horizontalPadding,
              paddingBottom: footerPaddingBottom + 88,
              gap: dense ? spacing.sm : spacing.md,
            },
          ]}
        >
          <View style={styles.contentFrame}>
            <View style={styles.header}>
              <Pressable
                style={({ pressed }) => [
                  styles.headerIconButton,
                  pressed && !busy ? styles.controlPressed : null,
                ]}
                onPress={onCancel}
                disabled={busy}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Back to swap"
                accessibilityState={{ disabled: busy }}
              >
                <View
                  style={[
                    { backgroundColor: colors.surface.cardElevated },
                    styles.headerIconSurface,
                  ]}
                >
                  <Ionicons
                    name="chevron-back"
                    size={layout.iconSizeNav}
                    color={colors.text.primary}
                  />
                </View>
              </Pressable>
              <Text
                variant="h2"
                color={colors.text.inverse}
                style={[styles.headerTitle, dense && styles.headerTitleDense]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                maxFontSizeMultiplier={1}
              >
                {title}
              </Text>
              <View style={[styles.statusPill, dense && styles.statusPillDense]}>
                <Text
                  variant="small"
                  color={colors.text.secondary}
                  style={styles.statusText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1}
                >
                  {statusLabel}
                </Text>
              </View>
            </View>

            <View
              style={[
                { backgroundColor: colors.surface.cardElevated },
                [styles.summaryPanel, dense && styles.summaryPanelDense],
              ]}
            >
              <Text
                variant="captionBold"
                color={colors.text.secondary}
                style={styles.panelLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
              >
                Swap
              </Text>
              <View style={styles.legs}>
                {payLeg != null ? <TokenLegRow leg={payLeg} dense={dense} /> : null}
                <View style={styles.legDivider}>
                  <View style={styles.dividerLine} />
                  <View style={[styles.arrowBadge, dense && styles.arrowBadgeDense]}>
                    <Ionicons
                      name="arrow-down"
                      size={dense ? 15 : 17}
                      color={colors.text.primary}
                    />
                  </View>
                  <View style={styles.dividerLine} />
                </View>
                {receiveLeg != null ? <TokenLegRow leg={receiveLeg} dense={dense} /> : null}
              </View>
            </View>

            <View
              style={[
                { backgroundColor: colors.surface.cardElevated },
                [styles.detailsPanel, dense && styles.detailsPanelDense],
              ]}
            >
              {detailRows.map((row, index) => (
                <React.Fragment key={`${row.label}-${index}`}>
                  <View style={[styles.detailRow, dense && styles.detailRowDense]}>
                    <Text
                      variant="small"
                      color={colors.text.secondary}
                      style={[styles.detailLabel, dense && styles.detailTextDense]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      maxFontSizeMultiplier={1}
                    >
                      {row.label}
                    </Text>
                    <Text
                      variant="small"
                      color={colors.text.primary}
                      style={[styles.detailValue, dense && styles.detailTextDense]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.62}
                      maxFontSizeMultiplier={1}
                      selectable
                    >
                      {row.value}
                    </Text>
                  </View>
                  {index < detailRows.length - 1 ? <View style={styles.divider} /> : null}
                </React.Fragment>
              ))}
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: horizontalPadding,
              paddingBottom: footerPaddingBottom,
              paddingTop: dense ? spacing.sm : spacing.md,
            },
          ]}
        >
          <View style={[styles.contentFrame, styles.actions]}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.cancelButton,
                pressed && !busy ? styles.controlPressed : null,
              ]}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              accessibilityState={{ disabled: busy }}
            >
              <View style={[{ backgroundColor: colors.glass.strongFill }, styles.actionSurface]}>
                <Text
                  variant="button"
                  color={busy ? colors.text.tertiary : colors.text.primary}
                  style={styles.actionText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  maxFontSizeMultiplier={1}
                >
                  {cancelLabel}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.confirmButton,
                pressed && !busy ? styles.controlPressed : null,
              ]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={busy ? busyLabel : confirmLabel}
              accessibilityState={{ busy, disabled: busy }}
            >
              <View style={[{ backgroundColor: colors.brand.glossAccent }, styles.actionSurface]}>
                {busy ? (
                  <View style={styles.loadingContent}>
                    <LazyLoadingSpinner size={24} color={colors.text.onAccent} />
                  </View>
                ) : (
                  <Text
                    variant="button"
                    color={colors.text.onAccent}
                    style={styles.actionText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.76}
                    maxFontSizeMultiplier={1}
                  >
                    {confirmLabel}
                  </Text>
                )}
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function TokenLegRow({
  leg,
  dense,
}: {
  leg: SwapReviewTokenLeg;
  dense: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.legRow, dense && styles.legRowDense]}>
      <View style={styles.legLeft}>
        <TokenIcon symbol={leg.symbol} name={leg.name} logoUri={leg.logo} size={dense ? 30 : 34} />
        <View style={styles.legTokenText}>
          <Text
            variant="small"
            color={colors.text.secondary}
            style={styles.legLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={1}
          >
            {leg.label}
          </Text>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={[styles.legSymbol, dense && styles.legSymbolDense]}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1}
          >
            {leg.symbol}
          </Text>
        </View>
      </View>
      <Text
        variant="h3"
        color={colors.text.primary}
        style={[styles.legAmount, dense && styles.legAmountDense]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.58}
        maxFontSizeMultiplier={1}
        selectable
      >
        {leg.amount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
    backgroundColor: colors.backgroundGradient.base,
  },
  safeFrame: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerIconButton: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
  },
  headerIconSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.display,
    textAlign: 'center',
  },
  headerTitleDense: {
    fontSize: 21,
    lineHeight: 28,
  },
  statusPill: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  statusPillDense: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
  statusText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
    letterSpacing: 0,
  },
  summaryPanel: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    marginBottom: spacing.md,
  },
  summaryPanelDense: {
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  panelLabel: {
    fontFamily: fontFamily.displaySemiBold,
  },
  legs: {
    gap: spacing.sm,
  },
  legRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minWidth: 0,
  },
  legRowDense: {
    minHeight: 46,
    gap: spacing.sm,
  },
  legLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legTokenText: {
    flex: 1,
    minWidth: 0,
  },
  legLabel: {
    fontFamily: fontFamily.uiMedium,
  },
  legSymbol: {
    fontFamily: fontFamily.uiSemiBold,
    lineHeight: 22,
  },
  legSymbolDense: {
    fontSize: 14,
    lineHeight: 18,
  },
  legAmount: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.displaySemiBold,
    fontVariant: ['tabular-nums'],
  },
  legAmountDense: {
    fontSize: 18,
    lineHeight: 24,
  },
  legDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
  arrowBadge: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  arrowBadgeDense: {
    width: 26,
    height: 26,
  },
  detailsPanel: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
  },
  detailsPanelDense: {
    borderRadius: radii.xl,
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
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    width: 104,
    flexShrink: 0,
    fontFamily: fontFamily.uiMedium,
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.uiSemiBold,
  },
  detailTextDense: {
    fontSize: 11,
    lineHeight: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
  footer: {
    backgroundColor: 'transparent',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 8px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  cancelButton: {
    backgroundColor: colors.glass.strongFill,
  },
  confirmButton: {
    backgroundColor: colors.brand.glossAccent,
  },
  actionSurface: {
    minHeight: 52,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionText: {
    fontFamily: fontFamily.uiSemiBold,
    textAlign: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  controlPressed: {
    opacity: 0.72,
  },
});
