import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SWAP_CONTROL_SHADOW, SWAP_PANEL_SHADOW } from '@/components/features/swap/swapGlass';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { Text } from '@/components/ui/Text';
import { PuffyQRIcon } from '@/components/ui/icons/PuffyQRIcon';
import { PuffyShieldIcon } from '@/components/ui/icons/PuffyShieldIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';

interface ReceiveInfoModalProps {
  visible: boolean;
  networkLabel: string;
  onClose: () => void;
}

export function ReceiveInfoModal({
  visible,
  networkLabel,
  onClose,
}: ReceiveInfoModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(height);
  const opacity = useSharedValue(0);
  const compactSheet = width < 380 || fontScale > 1.08;
  const sheetWidth = Math.min(Math.max(width - spacing.md * 2, 0), 430);
  const sheetPadding = compactSheet ? spacing.lg : spacing.xl;

  useEffect(() => {
    const startedAt = markAnimationPerf();
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: 240 });
      translateY.value = withTiming(
        0,
        {
          duration: 280,
          easing: Easing.out(Easing.poly(3)),
        },
        (finished) => {
          runOnJS(finishAnimationPerf)('receive.infoModal', startedAt, finished, {
            phase: 'open',
          });
        },
      );
      return;
    }

    translateY.value = withTiming(
      height,
      {
        duration: 220,
        easing: Easing.in(Easing.ease),
      },
      (finished) => {
        runOnJS(finishAnimationPerf)('receive.infoModal', startedAt, finished, {
          phase: 'close',
        });
      },
    );
    opacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [height, opacity, translateY, visible]);

  const handleClose = () => {
    const startedAt = markAnimationPerf();
    translateY.value = withTiming(
      height,
      { duration: 220, easing: Easing.in(Easing.ease) },
      (finished) => {
        runOnJS(finishAnimationPerf)('receive.infoModal', startedAt, finished, {
          phase: 'manualClose',
        });
        runOnJS(onClose)();
      },
    );
    opacity.value = withTiming(0, { duration: 200 });
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim />
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      <View
        style={[styles.overlay, { paddingBottom: insets.bottom + spacing.xl }]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[styles.sheet, { width: sheetWidth, padding: sheetPadding }, sheetStyle]}
        >
          <View
            style={[
              { backgroundColor: colors.surface.cardElevated },
              [StyleSheet.absoluteFill, styles.sheetSurface],
            ]}
          />

          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text
                variant="h2"
                color={colors.text.primary}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                maxFontSizeMultiplier={1}
              >
                Receive
              </Text>
              <Text variant="body" color={colors.text.secondary} style={styles.headerSubtitle}>
                Share your Solana wallet address
              </Text>
            </View>
            <Pressable
              style={styles.closeBtn}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close receive information"
            >
              <View
                style={[{ backgroundColor: colors.surface.cardElevated }, styles.closeBtnSurface]}
              >
                <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
              </View>
            </Pressable>
          </View>

          <View
            style={[
              { backgroundColor: colors.surface.cardElevated },
              [styles.infoCard, compactSheet && styles.infoCardCompact],
            ]}
          >
            <View style={styles.iconContainer}>
              <PuffyShieldIcon size={layout.iconSizeTab} color={colors.brand.glossAccent} focused />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="bodyBold" color={colors.text.primary}>
                Active network
              </Text>
              <Text variant="small" color={colors.text.secondary} style={styles.infoDescription}>
                Share this address on Solana {networkLabel}.
              </Text>
            </View>
          </View>

          <View
            style={[
              { backgroundColor: colors.surface.cardElevated },
              [styles.infoCard, compactSheet && styles.infoCardCompact],
            ]}
          >
            <View style={styles.iconContainer}>
              <PuffyQRIcon size={layout.iconSizeTab} color={colors.brand.glossAccent} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="bodyBold" color={colors.text.primary}>
                QR and copy ready
              </Text>
              <Text variant="small" color={colors.text.secondary} style={styles.infoDescription}>
                Use the QR or copy the address when a sender asks for your wallet.
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={handleClose}
            accessibilityRole="button"
          >
            <View style={[{ backgroundColor: colors.brand.glossAccent }, styles.actionBtnSurface]}>
              <Text variant="button" color={colors.brand.graphiteDepth} align="center">
                Got it!
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 10000,
    elevation: 10000,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: colors.surface.cardElevated,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: SWAP_PANEL_SHADOW,
  },
  sheetSurface: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xl,
    minWidth: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerSubtitle: {
    marginTop: spacing.xs,
  },
  closeBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  closeBtnSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.cardElevated,
    padding: spacing.md,
    marginBottom: spacing.md,
    minWidth: 0,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  infoCardCompact: {
    padding: spacing.sm,
  },
  iconContainer: {
    width: layout.buttonHeightMd,
    height: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.smokeWash,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    flexShrink: 0,
  },
  infoTextContainer: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  infoDescription: {
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  actionBtn: {
    width: '100%',
    minHeight: layout.buttonHeightLg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.brand.glossAccent,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    marginTop: spacing.xl,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  actionBtnSurface: {
    minHeight: layout.buttonHeightLg,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPressed: {
    opacity: 0.82,
  },
});
