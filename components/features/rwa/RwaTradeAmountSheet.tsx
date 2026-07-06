import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  type KeyboardEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOverlayVisibilityStore } from '@/store/overlayVisibilityStore';

export type RwaTradeAmountSheetSide = 'buy' | 'sell';

interface RwaTradeAmountSheetProps {
  visible: boolean;
  side: RwaTradeAmountSheetSide | null;
  assetName: string;
  assetCategoryLabel: string;
  assetSymbol: string;
  assetLogo: string | null;
  assetPriceLabel: string;
  settlementSymbol: string;
  amountInput: string;
  holdingLabel: string | null;
  message: string | null;
  reviewDisabledReason: string | null;
  pending: boolean;
  onAmountChange: (value: string) => void;
  onMax: () => void;
  onCancel: () => void;
  onReview: () => void;
}

const OPEN_DURATION_MS = 360;
const CLOSE_DURATION_MS = 240;
const DISMISS_DRAG_RATIO = 0.32;
const OVERLAY_ID = 'rwa-trade-amount';

export function RwaTradeAmountSheet({
  visible,
  side,
  assetName,
  assetCategoryLabel,
  assetSymbol,
  assetLogo,
  assetPriceLabel,
  settlementSymbol,
  amountInput,
  holdingLabel,
  message,
  reviewDisabledReason,
  pending,
  onAmountChange,
  onMax,
  onCancel,
  onReview,
}: RwaTradeAmountSheetProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const showOverlay = useOverlayVisibilityStore((state) => state.showOverlay);
  const hideOverlay = useOverlayVisibilityStore((state) => state.hideOverlay);
  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(0);
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const keyboardOffset = useSharedValue(0);
  const sheetHeightRef = useRef(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const buy = side !== 'sell';
  const inputSymbol = buy ? settlementSymbol : assetSymbol;
  const reviewBlocked = reviewDisabledReason != null && !pending;
  const reviewDisabled = reviewBlocked || pending;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragY.value = 0;
      progress.value = withTiming(1, {
        duration: OPEN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    progress.value = withTiming(
      0,
      { duration: CLOSE_DURATION_MS, easing: Easing.in(Easing.cubic) },
      (done) => {
        if (done) runOnJS(setMounted)(false);
      },
    );
  }, [dragY, progress, visible]);

  useEffect(() => {
    const active = visible || mounted;
    if (active) {
      showOverlay(OVERLAY_ID);
    } else {
      hideOverlay(OVERLAY_ID);
    }
    return () => hideOverlay(OVERLAY_ID);
  }, [hideOverlay, mounted, showOverlay, visible]);

  useEffect(() => {
    const applyOffset = (height: number, duration: number): void => {
      // The sheet already reserves the bottom safe-area inset, and the keyboard
      // overlaps that region, so only lift by the height above the inset.
      const lift = Math.max(0, height - insets.bottom);
      keyboardOffset.value = withTiming(lift, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    };

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event: KeyboardEvent) => {
      applyOffset(event.endCoordinates?.height ?? 0, event.duration || 220);
    });
    const hideSub = Keyboard.addListener(hideEvent, (event: KeyboardEvent) => {
      applyOffset(0, event.duration || 200);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, keyboardOffset]);

  useEffect(() => {
    if (!visible) keyboardOffset.value = 0;
  }, [keyboardOffset, visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        !pendingRef.current && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        dragY.value = Math.max(0, gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const height = sheetHeightRef.current || 1;
        const shouldDismiss = gesture.dy > height * DISMISS_DRAG_RATIO || gesture.vy > 1.1;
        if (shouldDismiss && !pendingRef.current) {
          runOnJS(onCancel)();
          return;
        }
        dragY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      },
      onPanResponderTerminate: () => {
        dragY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      },
    }),
  ).current;

  const handleSheetLayout = useCallback((height: number): void => {
    sheetHeightRef.current = height;
    setSheetHeight((current) => (Math.abs(current - height) < 1 ? current : height));
  }, []);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => {
    const hidden = (sheetHeight > 0 ? sheetHeight : windowHeight) + insets.bottom;
    return {
      transform: [
        { translateY: (1 - progress.value) * hidden + dragY.value - keyboardOffset.value },
      ],
    };
  });

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlayRoot]} pointerEvents="box-none">
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!pending) onCancel();
          }}
          accessibilityLabel="Dismiss RWA amount entry"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md },
          sheetStyle,
        ]}
        onLayout={(event) => handleSheetLayout(event.nativeEvent.layout.height)}
      >
        <View style={styles.grabberZone} {...panResponder.panHandlers}>
          <View style={styles.grabber} />
        </View>

        <View style={styles.identityRow}>
          <TokenIcon symbol={assetSymbol} name={assetName} logoUri={assetLogo} size={52} />
          <View style={styles.identityText}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              numberOfLines={1}
              style={styles.identityName}
            >
              {assetName}
            </Text>
            <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
              {assetCategoryLabel} · {assetSymbol}
            </Text>
          </View>
          <View style={styles.identityPrice}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              numberOfLines={1}
              style={styles.identityPriceText}
            >
              {assetPriceLabel}
            </Text>
            <Text
              variant="small"
              color={side === 'sell' ? colors.semantic.error : colors.semantic.receive}
              numberOfLines={1}
            >
              {buy ? 'Buy' : 'Sell'}
            </Text>
          </View>
        </View>

        <View style={styles.amountCard}>
          <View style={styles.amountHeader}>
            <Text variant="caption" color={colors.text.secondary} style={styles.amountTitle}>
              {buy ? 'Pay amount' : 'Sell quantity'}
            </Text>
            <View style={styles.symbolPill}>
              <Text variant="small" color={colors.text.secondary} style={styles.symbolText}>
                {inputSymbol}
              </Text>
            </View>
          </View>

          <View style={styles.amountInputShell}>
            <TextInput
              value={amountInput}
              onChangeText={onAmountChange}
              placeholder="0.00"
              placeholderTextColor={colors.text.placeholder}
              keyboardType="decimal-pad"
              inputMode="decimal"
              returnKeyType="done"
              autoFocus
              editable={!pending}
              style={styles.amountInput}
              selectionColor={colors.brand.glossAccent}
              accessibilityLabel={`${buy ? 'Buy' : 'Sell'} ${assetSymbol} amount`}
            />
            <Pressable
              onPress={onMax}
              disabled={pending}
              style={({ pressed }) => [
                styles.maxButton,
                pressed && !pending ? styles.maxButtonPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Use maximum ${inputSymbol} amount`}
            >
              <Text variant="caption" color={colors.text.primary} style={styles.maxButtonLabel}>
                MAX
              </Text>
            </Pressable>
          </View>

          <View style={styles.holdingRow}>
            <Text variant="small" color={colors.text.tertiary} style={styles.holdingLabel}>
              Available
            </Text>
            <Text
              variant="small"
              color={colors.text.secondary}
              style={styles.holdingValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              selectable
            >
              {holdingLabel ?? `-- ${inputSymbol}`}
            </Text>
          </View>
        </View>

        {message != null ? (
          <Text variant="small" color={colors.text.tertiary} numberOfLines={2}>
            {message}
          </Text>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            disabled={pending}
            onPress={onCancel}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonSecondary,
              pressed && !pending ? styles.actionButtonSecondaryPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Cancel ${assetSymbol} RWA entry`}
          >
            <Text variant="button" color={colors.text.secondary}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            disabled={reviewDisabled}
            onPress={onReview}
            style={({ pressed }) => [
              styles.actionButton,
              reviewBlocked ? styles.actionButtonDisabled : styles.actionButtonPrimary,
              pressed && !reviewDisabled ? styles.actionButtonPrimaryPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: reviewDisabled, busy: pending }}
            accessibilityLabel={`Review ${buy ? 'buy' : 'sell'} ${assetSymbol}`}
            accessibilityHint={pending ? undefined : (reviewDisabledReason ?? undefined)}
          >
            {pending ? (
              <LazyLoadingSpinner size={22} color={colors.text.onAccent} />
            ) : (
              <Text
                variant="button"
                color={reviewBlocked ? colors.text.tertiary : colors.text.onAccent}
              >
                Review
              </Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    zIndex: 10000,
    elevation: 10000,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    elevation: 1,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.brand.graphiteDepth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: [
      '0 -18px 42px rgba(0, 0, 0, 0.48)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.5)',
    ].join(', '),
  },
  grabberZone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radii.full,
    backgroundColor: colors.text.tertiary,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  identityName: {
    fontFamily: fontFamily.uiSemiBold,
  },
  identityPrice: {
    alignItems: 'flex-end',
    gap: 2,
  },
  identityPriceText: {
    fontFamily: fontFamily.medium,
  },
  amountCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.glassTint,
  },
  amountHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  amountTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.medium,
  },
  symbolPill: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  symbolText: {
    fontFamily: fontFamily.mono,
  },
  amountInputShell: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.solidControl,
  },
  amountInput: {
    minWidth: 0,
    flex: 1,
    color: colors.text.primary,
    fontFamily: fontFamily.display,
    fontSize: 30,
    paddingVertical: 0,
  },
  maxButton: {
    minWidth: 58,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  maxButtonPressed: {
    backgroundColor: colors.surface.solidControlPressed,
  },
  maxButtonLabel: {
    fontFamily: fontFamily.medium,
  },
  holdingRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  holdingLabel: {
    fontFamily: fontFamily.medium,
  },
  holdingValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.medium,
    fontVariant: ['tabular-nums'],
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
  actionButtonSecondary: {
    backgroundColor: colors.surface.solidControl,
    borderColor: colors.glass.rimSubtle,
  },
  actionButtonSecondaryPressed: {
    backgroundColor: colors.surface.solidControlPressed,
  },
  actionButtonPrimary: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.glossAccent,
  },
  actionButtonPrimaryPressed: {
    backgroundColor: colors.surface.glossPressed,
  },
  actionButtonDisabled: {
    backgroundColor: colors.surface.disabled,
    borderColor: colors.glass.rimSubtle,
  },
});
