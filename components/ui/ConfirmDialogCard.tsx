import React from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { useReanimatedModalProgress } from '@/components/ui/useReanimatedModalProgress';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface ConfirmDialogCardProps {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialogCard({
  visible,
  title,
  message,
  cancelLabel = 'Cancel',
  confirmLabel,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogCardProps): React.JSX.Element | null {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const dense = windowWidth < 340 || fontScale > 1.18;
  const compact = windowWidth < 390 || fontScale > 1.18;
  const maxWidth = Math.min(360, Math.max(280, windowWidth - spacing['3xl'] * 2));
  const buttonHeight = dense ? 44 : compact ? 46 : 48;
  const { mounted, progress } = useReanimatedModalProgress(visible);

  const layerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 8 }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Animated.View
        style={[styles.layer, layerStyle]}
        accessibilityViewIsModal
        accessibilityLabel={title}
      >
        <Pressable
          style={styles.scrim}
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <Animated.View style={[styles.card, { maxWidth }, cardStyle]}>
          <Text
            variant="h3"
            color={colors.text.primary}
            align="center"
            style={styles.title}
            numberOfLines={2}
            maxFontSizeMultiplier={1.05}
          >
            {title}
          </Text>
          <Text
            variant="body"
            color={colors.text.secondary}
            align="center"
            style={styles.message}
            maxFontSizeMultiplier={1.05}
          >
            {message}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                { minHeight: buttonHeight },
                pressed && !busy ? styles.cancelButtonPressed : null,
              ]}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text
                variant="buttonSmall"
                color={colors.text.primary}
                align="center"
                style={styles.buttonLabel}
                numberOfLines={1}
              >
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                destructive ? styles.confirmButtonDestructive : styles.confirmButtonPrimary,
                { minHeight: buttonHeight },
                pressed && !busy ? styles.confirmButtonPressed : null,
                busy ? styles.confirmButtonBusy : null,
              ]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ busy, disabled: busy }}
            >
              {busy ? (
                <LazyLoadingSpinner
                  size={18}
                  color={destructive ? colors.text.onAccent : colors.text.onAccent}
                />
              ) : (
                <Text
                  variant="buttonSmall"
                  color={destructive ? colors.text.onAccent : colors.text.onAccent}
                  align="center"
                  style={styles.buttonLabel}
                  numberOfLines={1}
                >
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing['3xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  card: {
    width: '100%',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xl,
    gap: spacing.md,
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.14), 0 18px 36px rgba(0, 0, 0, 0.5)',
  },
  title: {
    fontFamily: fontFamily.moneyBold,
    fontSize: 22,
    lineHeight: 26,
  },
  message: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  button: {
    flex: 1,
    flexBasis: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  cancelButton: {
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  cancelButtonPressed: {
    backgroundColor: colors.surface.pressed,
  },
  confirmButtonPrimary: {
    backgroundColor: colors.brand.glossAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  confirmButtonDestructive: {
    backgroundColor: colors.semantic.error,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 77, 90, 0.45)',
  },
  confirmButtonPressed: {
    opacity: 0.9,
  },
  confirmButtonBusy: {
    opacity: 0.72,
  },
});
