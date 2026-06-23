import React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

const overlayEntering = FadeIn.duration(180).easing(Easing.out(Easing.cubic));
const overlayExiting = FadeOut.duration(160).easing(Easing.in(Easing.cubic));
const cardEntering = FadeInDown.duration(230).easing(Easing.out(Easing.cubic));
const cardExiting = FadeOutDown.duration(170).easing(Easing.in(Easing.cubic));

interface OfflineSlotsPromptModalProps {
  visible: boolean;
  readySlots: number;
  pendingSlots: number;
  targetSlotCount: number;
  snapshotLoaded: boolean;
  networkLabel: string | null;
  rentEstimateLabel: string | null;
  preparing: boolean;
  canPrepare: boolean;
  isOffline: boolean;
  onPrepare: () => void;
  onGoOnline: () => void;
  onContinueOffline: () => void;
  onCancel: () => void;
}

export function OfflineSlotsPromptModal({
  visible,
  readySlots,
  pendingSlots,
  targetSlotCount,
  snapshotLoaded,
  networkLabel,
  rentEstimateLabel,
  preparing,
  canPrepare,
  isOffline,
  onPrepare,
  onGoOnline,
  onContinueOffline,
  onCancel,
}: OfflineSlotsPromptModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const dense = width < 350 || height < 700 || fontScale > 1.2;
  const compact = dense || width < 390 || height < 780 || fontScale > 1.1;
  const stackSecondaryButtons = width < 340 || fontScale > 1.22;
  const horizontalInset = dense ? spacing.lg : compact ? spacing.xl : spacing['3xl'];
  const verticalInset = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const cardMaxWidth = dense ? 352 : compact ? 372 : 392;
  const cardPadding = dense ? spacing.md : compact ? spacing.lg : spacing.xl;
  const cardGap = dense ? spacing.sm : compact ? spacing.md : spacing.lg;
  const detailRowHeight = dense ? 28 : compact ? 30 : 34;
  const detailRowPaddingY = dense ? 2 : spacing.xs;
  const primaryButtonHeight = dense ? layout.minTouchTarget : compact ? 46 : 48;
  const secondaryButtonHeight = dense ? layout.minTouchTarget : 44;
  const buttonPaddingHorizontal = dense ? spacing.md : spacing.lg;
  const requiredSlots = Math.max(0, targetSlotCount - readySlots);
  const visiblePendingSlots = preparing
    ? Math.max(pendingSlots, requiredSlots || targetSlotCount)
    : pendingSlots;
  const pendingLabel = `${Math.min(visiblePendingSlots, targetSlotCount)}/${targetSlotCount}`;
  const needsOnline = isOffline || !canPrepare;
  const primaryLabel = needsOnline
    ? 'Go online to prepare'
    : preparing
      ? 'Preparing slots'
      : `Prepare ${targetSlotCount} slots`;
  const networkName = networkLabel ?? 'the current network';
  const statusLabel = preparing
    ? `Preparing ${Math.max(1, Math.min(visiblePendingSlots, targetSlotCount))} slots`
    : visiblePendingSlots > 0
      ? `${pendingLabel} finalizing`
      : readySlots > 0
        ? `${readySlots}/${targetSlotCount} ready`
        : snapshotLoaded
          ? 'Not prepared'
          : 'Checking';
  const bodyText = preparing
    ? 'Creating offline payment slots. Keep the app online.'
    : visiblePendingSlots > 0
      ? `Offline slot setup is finalizing on ${networkName}.`
      : readySlots > 0
        ? 'Offline sends can use prepared payment slots.'
        : 'Needed for offline sends. Prepare before going offline.';
  const helperText =
    preparing || visiblePendingSlots > 0
      ? 'Keep the app online until setup completes.'
      : 'Setup uses network access and SOL rent.';

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      entering={overlayEntering}
      exiting={overlayExiting}
      style={styles.overlay}
      accessibilityViewIsModal
    >
      <ModalBackdropScrim opacity={0.74} />
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[
          styles.scrollerContent,
          {
            paddingHorizontal: horizontalInset,
            paddingTop: Math.max(insets.top, spacing.md) + verticalInset,
            paddingBottom: Math.max(insets.bottom, spacing.md) + verticalInset,
            justifyContent: 'center',
          },
        ]}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={cardEntering}
          exiting={cardExiting}
          style={[styles.cardShell, { maxWidth: cardMaxWidth }]}
        >
          <View
            style={[
              styles.card,
              {
                padding: cardPadding,
                gap: cardGap,
              },
            ]}
          >
            <View style={styles.copyBlock}>
              <Text
                variant="h3"
                color={colors.text.primary}
                align="center"
                style={styles.title}
                numberOfLines={2}
                maxFontSizeMultiplier={1.05}
              >
                Prepare offline slots
              </Text>
              <Text
                variant="caption"
                color={colors.text.secondary}
                align="center"
                style={styles.body}
                maxFontSizeMultiplier={1.05}
              >
                {bodyText}
              </Text>
            </View>

            <View style={styles.detailList}>
              <View
                style={[
                  styles.detailRow,
                  { minHeight: detailRowHeight, paddingVertical: detailRowPaddingY },
                ]}
              >
                <Text variant="small" color={colors.text.tertiary}>
                  Status
                </Text>
                <Text
                  variant="small"
                  color={colors.text.primary}
                  style={[styles.strong, styles.tabular]}
                  maxFontSizeMultiplier={1.05}
                >
                  {statusLabel}
                </Text>
              </View>
              <View
                style={[
                  styles.detailRow,
                  { minHeight: detailRowHeight, paddingVertical: detailRowPaddingY },
                ]}
              >
                <Text variant="small" color={colors.text.tertiary}>
                  Target
                </Text>
                <Text
                  variant="small"
                  color={colors.text.primary}
                  style={[styles.strong, styles.tabular]}
                  maxFontSizeMultiplier={1.05}
                >
                  {targetSlotCount} slots
                </Text>
              </View>
              <View
                style={[
                  styles.detailRow,
                  { minHeight: detailRowHeight, paddingVertical: detailRowPaddingY },
                ]}
              >
                <Text variant="small" color={colors.text.tertiary}>
                  Network
                </Text>
                <Text
                  variant="small"
                  color={colors.text.primary}
                  style={styles.strong}
                  maxFontSizeMultiplier={1.05}
                >
                  {networkLabel ?? 'Current'}
                </Text>
              </View>
              <View
                style={[
                  styles.detailRow,
                  { minHeight: detailRowHeight, paddingVertical: detailRowPaddingY },
                ]}
              >
                <Text variant="small" color={colors.text.tertiary}>
                  Rent
                </Text>
                <Text
                  variant="small"
                  color={colors.text.primary}
                  style={styles.strong}
                  maxFontSizeMultiplier={1.05}
                >
                  {rentEstimateLabel ?? 'Checking'}
                </Text>
              </View>
            </View>

            <Text
              variant="small"
              color={colors.text.tertiary}
              align="center"
              style={styles.helper}
              numberOfLines={2}
              maxFontSizeMultiplier={1.05}
            >
              {helperText}
            </Text>

            <View style={styles.buttonColumn}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    minHeight: primaryButtonHeight,
                    paddingHorizontal: buttonPaddingHorizontal,
                  },
                  pressed ? styles.buttonPressed : undefined,
                  preparing ? styles.disabled : undefined,
                ]}
                onPress={needsOnline ? onGoOnline : onPrepare}
                disabled={preparing}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={primaryLabel}
                accessibilityState={{ busy: preparing, disabled: preparing }}
              >
                {preparing ? (
                  <View style={styles.loadingFrame}>
                    <LazyLoadingSpinner size={18} color={colors.text.onAccent} />
                  </View>
                ) : (
                  <Text
                    variant="button"
                    color={colors.text.onAccent}
                    style={styles.buttonText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    maxFontSizeMultiplier={1.1}
                  >
                    {primaryLabel}
                  </Text>
                )}
              </Pressable>
              <View
                style={[
                  styles.secondaryRow,
                  stackSecondaryButtons ? styles.secondaryColumn : undefined,
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      minHeight: secondaryButtonHeight,
                      paddingHorizontal: buttonPaddingHorizontal,
                    },
                    pressed ? styles.buttonPressed : undefined,
                  ]}
                  onPress={onCancel}
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Text
                    variant="buttonSmall"
                    color={colors.text.secondary}
                    style={styles.buttonText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    maxFontSizeMultiplier={1.1}
                  >
                    Not now
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      minHeight: secondaryButtonHeight,
                      paddingHorizontal: buttonPaddingHorizontal,
                    },
                    pressed ? styles.buttonPressed : undefined,
                  ]}
                  onPress={onContinueOffline}
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Text
                    variant="buttonSmall"
                    color={colors.text.secondary}
                    style={styles.buttonText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    maxFontSizeMultiplier={1.1}
                  >
                    Continue offline
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
  },
  scroller: {
    flex: 1,
  },
  scrollerContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  cardShell: {
    width: '100%',
    maxWidth: 420,
  },
  card: {
    width: '100%',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: `0 18px 42px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
  },
  copyBlock: {
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamily.displaySemiBold,
  },
  body: {
    lineHeight: 20,
  },
  detailList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.holdingsCard.divider,
  },
  detailRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  strong: {
    fontFamily: fontFamily.uiSemiBold,
    flexShrink: 1,
    textAlign: 'right',
  },
  helper: {
    lineHeight: 18,
  },
  buttonColumn: {
    gap: spacing.sm,
  },
  loadingFrame: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    minHeight: layout.buttonHeightLg,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.54,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryColumn: {
    flexDirection: 'column',
  },
  secondaryButton: {
    flex: 1,
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  buttonText: {
    textAlign: 'center',
  },
});
