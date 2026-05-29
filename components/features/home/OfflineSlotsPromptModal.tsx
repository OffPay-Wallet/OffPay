import React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
} from 'react-native-reanimated';

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
  const { width, height, fontScale } = useWindowDimensions();
  const compact = width < 380 || height < 740 || fontScale > 1.1;
  const stackSecondaryButtons = width < 390 || fontScale > 1.15;
  const horizontalInset = width < 360 ? spacing.md : spacing['2xl'];
  const verticalInset = compact ? spacing.lg : spacing['2xl'];
  const needsOnline = isOffline || !canPrepare;
  const primaryLabel = needsOnline
    ? 'Go online to prepare'
    : preparing
      ? 'Preparing slots'
      : 'Prepare slots';
  const progressLabel =
    pendingSlots > 0 && readySlots === 0
      ? `${Math.min(pendingSlots, targetSlotCount)}/${targetSlotCount} finalizing`
      : `${readySlots}/${targetSlotCount} ready`;

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
            paddingVertical: verticalInset,
            justifyContent: compact ? 'flex-start' : 'center',
          },
        ]}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={cardEntering} exiting={cardExiting} style={styles.cardShell}>
          <LinearGradient
            colors={[colors.glass.strongFill, colors.glass.frostFill, colors.glass.clearFill]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.card,
              {
                padding: compact ? spacing.lg : spacing.xl,
                gap: compact ? spacing.md : spacing.lg,
              },
            ]}
          >
            <View style={styles.copyBlock}>
              <Text variant="h3" color={colors.text.primary} align="center" style={styles.title}>
                Prepare offline slots
              </Text>
              <Text
                variant="caption"
                color={colors.text.secondary}
                align="center"
                style={styles.body}
              >
                {`Needed for offline sends. ${progressLabel}.`}
              </Text>
            </View>

            <View style={styles.detailList}>
              <View style={styles.detailRow}>
                <Text variant="small" color={colors.text.tertiary}>
                  {pendingSlots > 0 && readySlots === 0 ? 'Finalizing' : 'Ready'}
                </Text>
                <Text
                  variant="small"
                  color={colors.text.primary}
                  style={[styles.strong, styles.tabular]}
                >
                  {progressLabel}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="small" color={colors.text.tertiary}>
                  Target
                </Text>
                <Text
                  variant="small"
                  color={colors.text.primary}
                  style={[styles.strong, styles.tabular]}
                >
                  {targetSlotCount} slots
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="small" color={colors.text.tertiary}>
                  Network
                </Text>
                <Text variant="small" color={colors.text.primary} style={styles.strong}>
                  {networkLabel ?? 'Current'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="small" color={colors.text.tertiary}>
                  Rent
                </Text>
                <Text variant="small" color={colors.text.primary} style={styles.strong}>
                  {rentEstimateLabel ?? 'Checking'}
                </Text>
              </View>
            </View>

            <Text variant="small" color={colors.text.tertiary} align="center" style={styles.helper}>
              Setup uses network access and SOL rent.
            </Text>

            <View style={styles.buttonColumn}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.buttonPressed : undefined,
                  preparing ? styles.disabled : undefined,
                ]}
                onPress={needsOnline ? onGoOnline : onPrepare}
                disabled={preparing}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={primaryLabel}
              >
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
          </LinearGradient>
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
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
    backgroundColor: colors.glass.strongFill,
    boxShadow: `0 18px 42px ${colors.glass.depthShadow}, inset 0 1px 1px rgba(255, 255, 255, 0.82), inset 0 -14px 28px rgba(91, 200, 232, 0.12)`,
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
  primaryButton: {
    minHeight: layout.buttonHeightLg,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.azureCyan,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 12px 24px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.72)`,
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
    boxShadow: `0 8px 16px rgba(14, 42, 53, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.78)`,
  },
  buttonText: {
    textAlign: 'center',
  },
});
