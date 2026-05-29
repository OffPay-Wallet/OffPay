import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

const RECEIVE_SHEET_COLORS = [
  colors.brand.whiteStream,
  colors.brand.iceBlue,
  colors.brand.whiteStream,
] as const;
const RECEIVE_INFO_CARD_COLORS = [
  colors.brand.whiteStream,
  colors.brand.whiteStream,
  colors.brand.iceBlue,
] as const;

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
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: 240 });
      translateY.value = withTiming(0, {
        duration: 280,
        easing: Easing.out(Easing.poly(3)),
      });
      return;
    }

    translateY.value = withTiming(height, {
      duration: 220,
      easing: Easing.in(Easing.ease),
    });
    opacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [height, opacity, translateY, visible]);

  const handleClose = () => {
    translateY.value = withTiming(height, { duration: 220, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(onClose)();
    });
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
          <LinearGradient
            colors={[...RECEIVE_SHEET_COLORS]}
            style={[StyleSheet.absoluteFill, styles.sheetGradient]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
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
              <LinearGradient
                colors={[...RECEIVE_INFO_CARD_COLORS]}
                start={{ x: 0.04, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.closeBtnSurface}
              >
                <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
              </LinearGradient>
            </Pressable>
          </View>

          <LinearGradient
            colors={[...RECEIVE_INFO_CARD_COLORS]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.infoCard, compactSheet && styles.infoCardCompact]}
          >
            <View style={styles.iconContainer}>
              <PuffyShieldIcon size={layout.iconSizeTab} color={colors.brand.azureCyan} focused />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="bodyBold" color={colors.text.primary}>
                Active network
              </Text>
              <Text variant="small" color={colors.text.secondary} style={styles.infoDescription}>
                Share this address on Solana {networkLabel}.
              </Text>
            </View>
          </LinearGradient>

          <LinearGradient
            colors={[...RECEIVE_INFO_CARD_COLORS]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.infoCard, compactSheet && styles.infoCardCompact]}
          >
            <View style={styles.iconContainer}>
              <PuffyQRIcon size={layout.iconSizeTab} color={colors.brand.azureCyan} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="bodyBold" color={colors.text.primary}>
                QR and copy ready
              </Text>
              <Text variant="small" color={colors.text.secondary} style={styles.infoDescription}>
                Use the QR or copy the address when a sender asks for your wallet.
              </Text>
            </View>
          </LinearGradient>

          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={handleClose}
            accessibilityRole="button"
          >
            <LinearGradient
              colors={[colors.brand.azureCyan, colors.glass.azureCyanHalf, colors.glass.cyanWash]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.actionBtnSurface}
            >
              <Text variant="button" color={colors.brand.navyDepth} align="center">
                Got it!
              </Text>
            </LinearGradient>
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
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: colors.brand.whiteStream,
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
  sheetGradient: {
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
    backgroundColor: colors.brand.whiteStream,
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
    backgroundColor: colors.brand.whiteStream,
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
    backgroundColor: colors.glass.cyanWash,
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
    backgroundColor: colors.brand.azureCyan,
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
