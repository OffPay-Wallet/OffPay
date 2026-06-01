/**
 * SendSummarySheet — single draggable card that carries the whole tail
 * of the send flow: review → sending → success. No separate result
 * screen.
 *
 * Phases:
 *   - 'review'  : final figures + "Slide to Confirm" + Cancel.
 *   - 'sending' : token logo centered inside a rotating progress ring
 *                 ("buffering"). Slider/cancel are hidden.
 *   - 'success' : the ring/logo cross-fades into a success lottie in
 *                 the same circle; the circle eases up and the txn
 *                 details fade in below, with a single Done action.
 *
 * Drag the grabber/sheet down to dismiss while reviewing (PanResponder
 * — works without a GestureHandlerRootView, which this app does not
 * mount). Dismiss is locked while sending.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import LottieView from 'lottie-react-native';
import Animated, {
  Easing,
  cancelAnimation,
  FadeIn,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import successLottie from '@/assets/lotties/success.json';
import { GlassSliderButton } from '@/components/ui/glass-slider-button';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import type { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import type { SendTokenOption } from './types';

export type SendSheetPhase = 'review' | 'sending' | 'success';

interface SendSummarySheetResult {
  status: 'submitted' | 'queued';
  id: string;
  amount: string;
  symbol: string;
  recipient: string;
}

interface SendSummarySheetProps {
  visible: boolean;
  phase: SendSheetPhase;
  token: SendTokenOption | null;
  amount: string;
  amountMetaLabel: string;
  recipientAddress: string;
  network: ReturnType<typeof useOffpayNetwork>['network'];
  modeLabel: string;
  networkFeeLabel: string;
  selfSend: boolean;
  canSubmit: boolean;
  /** Populated once the submit resolves; drives the success details. */
  result: SendSummarySheetResult | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Optional explorer / copy action shown on success. */
  onResultAction?: () => void;
  resultActionLabel?: string;
  onDone: () => void;
}

const OPEN_DURATION_MS = 360;
const CLOSE_DURATION_MS = 240;
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);
const PHASE_FADE_MS = 280;
const DISMISS_DRAG_RATIO = 0.32;
const CIRCLE_SIZE = 120;
const RING_THICKNESS = 4;

export function SendSummarySheet({
  visible,
  phase,
  token,
  amount,
  amountMetaLabel,
  recipientAddress,
  network,
  modeLabel,
  networkFeeLabel,
  selfSend,
  canSubmit,
  result,
  onCancel,
  onConfirm,
  onResultAction,
  resultActionLabel,
  onDone,
}: SendSummarySheetProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(0);

  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const ringSpin = useSharedValue(0);
  const sheetHeightRef = useRef(0);
  const lockedRef = useRef(phase !== 'review');
  lockedRef.current = phase !== 'review';

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragY.value = 0;
      progress.value = withTiming(1, { duration: OPEN_DURATION_MS, easing: OPEN_EASING });
      return;
    }
    progress.value = withTiming(
      0,
      { duration: CLOSE_DURATION_MS, easing: CLOSE_EASING },
      (done) => {
        if (done) runOnJS(setMounted)(false);
      },
    );
  }, [dragY, progress, visible]);

  // Spin the progress ring only while sending.
  useEffect(() => {
    if (phase === 'sending') {
      ringSpin.value = 0;
      ringSpin.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(ringSpin);
      ringSpin.value = 0;
    }
    return () => {
      cancelAnimation(ringSpin);
    };
  }, [phase, ringSpin]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        !lockedRef.current && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        dragY.value = Math.max(0, gesture.dy);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const height = sheetHeightRef.current || 1;
        const shouldDismiss = gesture.dy > height * DISMISS_DRAG_RATIO || gesture.vy > 1.1;
        if (shouldDismiss && !lockedRef.current) {
          runOnJS(onCancel)();
          return;
        }
        dragY.value = withTiming(0, { duration: 200, easing: OPEN_EASING });
      },
      onPanResponderTerminate: () => {
        dragY.value = withTiming(0, { duration: 200, easing: OPEN_EASING });
      },
    }),
  ).current;

  const handleSheetLayout = useCallback((height: number) => {
    sheetHeightRef.current = height;
    setSheetHeight((current) => (Math.abs(current - height) < 1 ? current : height));
  }, []);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => {
    const hidden = (sheetHeight > 0 ? sheetHeight : windowHeight) + insets.bottom;
    const enterOffset = (1 - progress.value) * hidden;
    return { transform: [{ translateY: enterOffset + dragY.value }] };
  });
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringSpin.value * 360}deg` }],
  }));

  if (!mounted) return null;

  const symbol = token?.symbol ?? '';
  const isProcessing = phase === 'sending';
  const isSuccess = phase === 'success';
  const showStatusCircle = isProcessing || isSuccess;
  const queued = result?.status === 'queued';

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlayRoot]} pointerEvents="box-none">
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (phase === 'review') onCancel();
          }}
          accessibilityLabel="Dismiss summary"
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
        {phase === 'review' ? (
          <View style={styles.grabberZone} {...panResponder.panHandlers}>
            <View style={styles.grabber} />
          </View>
        ) : (
          <View style={styles.grabberZone}>
            <View style={[styles.grabber, styles.grabberHidden]} />
          </View>
        )}

        {/* ── Status circle (sending → success) ── */}
        {showStatusCircle ? (
          <Animated.View
            entering={FadeIn.duration(PHASE_FADE_MS)}
            layout={LinearTransition.duration(PHASE_FADE_MS).easing(OPEN_EASING)}
            style={styles.statusCircleWrap}
          >
            <View style={styles.statusCircle}>
              {isProcessing ? (
                <>
                  <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
                  <View style={styles.statusInner}>
                    <TokenIcon
                      symbol={symbol}
                      name={token?.name ?? symbol}
                      logoUri={token?.logo ?? null}
                      size={CIRCLE_SIZE - RING_THICKNESS * 2 - 18}
                    />
                  </View>
                </>
              ) : (
                <Animated.View
                  key="send-success-lottie"
                  entering={FadeIn.duration(PHASE_FADE_MS)}
                  style={styles.statusInner}
                >
                  <LottieView source={successLottie} autoPlay loop={false} style={styles.lottie} />
                </Animated.View>
              )}
            </View>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              align="center"
              style={styles.statusTitle}
            >
              {isProcessing ? 'Sending…' : queued ? 'Payment queued' : 'Sent!'}
            </Text>
          </Animated.View>
        ) : null}

        {/* ── Review header (amount) — hidden once processing starts ── */}
        {phase === 'review' ? (
          <>
            <Text
              variant="h1"
              color={colors.text.primary}
              align="center"
              style={styles.amount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {amount} {symbol}
            </Text>
            <Text
              variant="bodyBold"
              color={colors.text.secondary}
              align="center"
              style={styles.meta}
            >
              {amountMetaLabel}
            </Text>

            {selfSend ? (
              <View style={styles.warningBox}>
                <Text
                  variant="caption"
                  color={colors.text.inverse}
                  align="center"
                  numberOfLines={3}
                  maxFontSizeMultiplier={1}
                  style={styles.warningText}
                >
                  This is your current address. Sending will incur transfer fees with no other
                  balance changes.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {/* ── Detail rows: shown on review and on success (fade in) ── */}
        {phase === 'review' || isSuccess ? (
          <Animated.View
            key={`details-${phase}`}
            entering={isSuccess ? FadeIn.duration(PHASE_FADE_MS).delay(120) : undefined}
            style={styles.detailCard}
          >
            <SummaryRow label="To" value={shortenWalletAddress(recipientAddress)} />
            {isSuccess ? (
              <SummaryRow label="Amount" value={`${result?.amount ?? amount} ${symbol}`} />
            ) : null}
            <SummaryRow label="Network" value={network === 'devnet' ? 'Solana Devnet' : 'Solana'} />
            {isSuccess ? (
              <SummaryRow
                label={queued ? 'Offline id' : 'Transaction'}
                value={result != null ? shortenWalletAddress(result.id) : '—'}
                last
              />
            ) : (
              <>
                <SummaryRow label="Mode" value={modeLabel} />
                <SummaryRow label="Network fee" value={networkFeeLabel} last />
              </>
            )}
          </Animated.View>
        ) : null}

        {/* ── Actions ── */}
        {phase === 'review' ? (
          <>
            <GlassSliderButton
              label="Slide to Confirm"
              loadingLabel="Sending"
              disabled={!canSubmit}
              loading={false}
              onComplete={onConfirm}
            />
            <Pressable
              style={({ pressed }) => [styles.textButton, pressed && styles.textPressed]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close and edit amount"
            >
              <Text variant="button" color={colors.text.secondary}>
                Close
              </Text>
            </Pressable>
          </>
        ) : null}

        {isSuccess ? (
          <View style={styles.successActions}>
            {onResultAction != null && resultActionLabel != null ? (
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.textPressed]}
                onPress={onResultAction}
                accessibilityRole="button"
                accessibilityLabel={resultActionLabel}
              >
                <Text variant="button" color={colors.brand.actionFill}>
                  {resultActionLabel}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.doneButton, pressed && styles.donePressed]}
              onPress={onDone}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text variant="button" color={colors.text.onAccent}>
                Done
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast]}>
      <Text variant="caption" color={colors.text.secondary} style={styles.summaryLabel}>
        {label}
      </Text>
      <Text
        variant="captionBold"
        color={colors.text.primary}
        numberOfLines={1}
        style={styles.summaryValue}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    // Lift the whole overlay above the screen content + footer so the
    // sheet's buttons (Close / Done / slider) reliably receive touches
    // on Android, where sibling views with elevation/shadow can
    // otherwise render on top of a later-declared sibling.
    zIndex: 100,
    elevation: 100,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 16, 16, 0.42)',
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
    backgroundColor: colors.brand.whiteStream,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
    boxShadow: '0 -8px 28px rgba(16, 16, 16, 0.18)',
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
    backgroundColor: colors.glass.depthShadow,
  },
  grabberHidden: {
    opacity: 0,
  },
  statusCircleWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: RING_THICKNESS,
    borderColor: colors.glass.smokeWash,
    // The "moving" arc of the ring — one bright edge sweeps around.
    borderTopColor: colors.brand.glossAccent,
    borderRightColor: colors.brand.actionFill,
  },
  statusInner: {
    width: CIRCLE_SIZE - RING_THICKNESS * 2,
    height: CIRCLE_SIZE - RING_THICKNESS * 2,
    borderRadius: (CIRCLE_SIZE - RING_THICKNESS * 2) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
  },
  statusTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  amount: {
    fontFamily: fontFamily.semiBold,
    fontSize: 34,
    lineHeight: 40,
  },
  meta: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  warningBox: {
    borderRadius: radii.xl,
    backgroundColor: colors.semantic.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningText: {
    fontSize: 14,
    lineHeight: 19,
    includeFontPadding: false,
  },
  detailCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.frostFill,
    overflow: 'hidden',
  },
  summaryRow: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryRowLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    flexShrink: 0,
  },
  summaryValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 13,
    lineHeight: 17,
  },
  textButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textPressed: {
    opacity: 0.6,
  },
  successActions: {
    gap: spacing.sm,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButton: {
    minHeight: 52,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.glossAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donePressed: {
    opacity: 0.82,
  },
});
