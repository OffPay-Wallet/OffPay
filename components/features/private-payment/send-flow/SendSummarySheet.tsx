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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import LottieView from 'lottie-react-native';
import Animated, {
  Easing,
  cancelAnimation,
  FadeIn,
  LinearTransition,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassSliderButton } from '@/components/ui/glass-slider-button';
import { successLottie, whiteSuccessLottie } from '@/components/ui/success-lottie';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';

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
  /** Opens Solscan for submitted payments, copies reference for queued ones. */
  onResultAction?: () => void;
  /** Returns to the amount/route entry state with current inputs preserved. */
  onResend: () => void;
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
const SUCCESS_LOTTIE_META = successLottie as { fr?: number; ip?: number; op?: number };
const SUCCESS_LOTTIE_DURATION_MS =
  SUCCESS_LOTTIE_META.fr != null &&
  SUCCESS_LOTTIE_META.fr > 0 &&
  SUCCESS_LOTTIE_META.op != null &&
  SUCCESS_LOTTIE_META.ip != null
    ? Math.round(
        ((SUCCESS_LOTTIE_META.op - SUCCESS_LOTTIE_META.ip) / SUCCESS_LOTTIE_META.fr) * 1000,
      )
    : 1400;
const SUCCESS_CONFETTI_DELAY_MS = Math.max(520, SUCCESS_LOTTIE_DURATION_MS - 360);

const CONFETTI_PARTICLES = [
  { x: -74, y: -64, rotate: -34, delay: 0, width: 5, height: 13, color: colors.brand.whiteStream },
  { x: -46, y: -86, rotate: 24, delay: 40, width: 4, height: 10, color: colors.text.secondary },
  { x: -18, y: -76, rotate: -18, delay: 80, width: 5, height: 5, color: colors.semantic.error },
  { x: 20, y: -88, rotate: 38, delay: 20, width: 4, height: 12, color: colors.brand.whiteStream },
  { x: 54, y: -72, rotate: -28, delay: 70, width: 5, height: 11, color: colors.text.secondary },
  { x: 78, y: -46, rotate: 32, delay: 110, width: 5, height: 5, color: colors.brand.whiteStream },
  { x: -82, y: -18, rotate: 18, delay: 130, width: 4, height: 10, color: colors.text.tertiary },
  { x: 82, y: -12, rotate: -22, delay: 150, width: 4, height: 10, color: colors.semantic.error },
] as const;

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
  onResend,
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
    const startedAt = markAnimationPerf();
    if (visible) {
      setMounted(true);
      dragY.value = 0;
      progress.value = withTiming(
        1,
        { duration: OPEN_DURATION_MS, easing: OPEN_EASING },
        (finished) => {
          runOnJS(finishAnimationPerf)('privatePayment.summarySheet', startedAt, finished, {
            phase: 'open',
          });
        },
      );
      return;
    }
    progress.value = withTiming(
      0,
      { duration: CLOSE_DURATION_MS, easing: CLOSE_EASING },
      (done) => {
        runOnJS(finishAnimationPerf)('privatePayment.summarySheet', startedAt, done, {
          phase: 'close',
        });
        if (done) runOnJS(setMounted)(false);
      },
    );
  }, [dragY, progress, visible]);

  // Spin the progress ring only while sending.
  useEffect(() => {
    if (phase === 'sending') {
      const startedAt = markAnimationPerf();
      ringSpin.value = 0;
      ringSpin.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.linear }),
        -1,
        false,
      );
      return () => {
        cancelAnimation(ringSpin);
        finishAnimationPerf('privatePayment.summaryRing.loop', startedAt, false);
      };
    }

    cancelAnimation(ringSpin);
    ringSpin.value = 0;
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
        const startedAt = markAnimationPerf();
        dragY.value = withTiming(0, { duration: 200, easing: OPEN_EASING }, (finished) => {
          runOnJS(finishAnimationPerf)(
            'privatePayment.summarySheet.dragReset',
            startedAt,
            finished,
          );
        });
      },
      onPanResponderTerminate: () => {
        const startedAt = markAnimationPerf();
        dragY.value = withTiming(0, { duration: 200, easing: OPEN_EASING }, (finished) => {
          runOnJS(finishAnimationPerf)(
            'privatePayment.summarySheet.dragReset',
            startedAt,
            finished,
            {
              phase: 'terminate',
            },
          );
        });
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
  const showSuccessConfetti = phase === 'success' && result?.status === 'submitted';
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
                  {showSuccessConfetti ? <SuccessConfetti /> : null}
                  <LottieView
                    source={whiteSuccessLottie}
                    autoPlay
                    loop={false}
                    style={styles.lottie}
                  />
                  <Ionicons
                    name="checkmark"
                    size={42}
                    color={colors.brand.deepShadow}
                    style={styles.successCheckOverlay}
                  />
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
            {isProcessing && modeLabel.includes('Umbra') ? (
              <Text
                variant="caption"
                color={colors.text.secondary}
                align="center"
                style={styles.statusHint}
              >
                Generating privacy proof{'\n'}(may take 1-2 minutes)
              </Text>
            ) : null}
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

        {/* ── Detail rows: review keeps fee details; success stays minimal. ── */}
        {phase === 'review' ? (
          <Animated.View key="details-review" style={styles.detailCard}>
            <SummaryRow label="To" value={shortenWalletAddress(recipientAddress)} />
            <SummaryRow label="Network" value={network === 'devnet' ? 'Solana Devnet' : 'Solana'} />
            <SummaryRow label="Mode" value={modeLabel} />
            <SummaryRow label="Network fee" value={networkFeeLabel} last />
          </Animated.View>
        ) : null}

        {isSuccess ? (
          <Animated.View
            key="details-success"
            entering={FadeIn.duration(PHASE_FADE_MS).delay(120)}
            style={styles.successSummaryCard}
          >
            <View pointerEvents="none" style={styles.successSummaryGloss} />
            <Text
              variant="h2"
              color={colors.text.primary}
              align="center"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.68}
              style={styles.successAmount}
            >
              {result?.amount ?? amount} {symbol}
            </Text>
            <SummaryRow label="To" value={shortenWalletAddress(recipientAddress)} />
            <SummaryRow
              label={queued ? 'Offline id' : 'Transaction'}
              value={result != null ? shortenWalletAddress(result.id) : '—'}
              onPress={result != null ? onResultAction : undefined}
              actionIcon={queued ? 'copy-outline' : 'open-outline'}
              last
            />
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
            <Pressable
              style={({ pressed }) => [styles.resendButton, pressed && styles.actionPressed]}
              onPress={onResend}
              accessibilityRole="button"
              accessibilityLabel="Send again with these details"
            >
              <Text variant="button" color={colors.text.primary}>
                Resend
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.doneButton, pressed && styles.actionPressed]}
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
  onPress,
  actionIcon,
}: {
  label: string;
  value: string;
  last?: boolean;
  onPress?: () => void;
  actionIcon?: keyof typeof Ionicons.glyphMap;
}): React.JSX.Element {
  const content = (
    <>
      <Text variant="caption" color={colors.text.secondary} style={styles.summaryLabel}>
        {label}
      </Text>
      <View style={styles.summaryValueWrap}>
        <Text
          variant="captionBold"
          color={colors.text.primary}
          numberOfLines={1}
          style={styles.summaryValue}
        >
          {value}
        </Text>
        {actionIcon != null ? (
          <Ionicons name={actionIcon} size={16} color={colors.text.primary} />
        ) : null}
      </View>
    </>
  );

  if (onPress != null) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={`${label} ${value}`}
        style={({ pressed }) => [
          styles.summaryRow,
          styles.summaryRowPressable,
          last && styles.summaryRowLast,
          pressed && styles.textPressed,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.summaryRow, last && styles.summaryRowLast]}>{content}</View>;
}

function ConfettiParticle({
  index,
  particle,
}: {
  index: number;
  particle: (typeof CONFETTI_PARTICLES)[number];
}): React.JSX.Element {
  const burst = useSharedValue(0);

  useEffect(() => {
    const startedAt = markAnimationPerf();
    burst.value = 0;
    burst.value = withDelay(
      SUCCESS_CONFETTI_DELAY_MS + particle.delay,
      withTiming(1, { duration: 680, easing: Easing.out(Easing.cubic) }, (finished) => {
        runOnJS(finishAnimationPerf)(
          'privatePayment.successConfetti.particle',
          startedAt,
          finished,
          {
            delayMs: SUCCESS_CONFETTI_DELAY_MS + particle.delay,
            index,
          },
        );
      }),
    );
  }, [burst, index, particle.delay]);

  const particleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.14, 0.78, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(burst.value, [0, 1], [0, particle.x]) },
      { translateY: interpolate(burst.value, [0, 1], [0, particle.y]) },
      { rotate: `${interpolate(burst.value, [0, 1], [0, particle.rotate])}deg` },
      { scale: interpolate(burst.value, [0, 0.18, 1], [0.55, 1, 0.86]) },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.confettiParticle,
        {
          width: particle.width,
          height: particle.height,
          backgroundColor: particle.color,
        },
        particleStyle,
      ]}
    />
  );
}

function SuccessConfetti(): React.JSX.Element {
  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {CONFETTI_PARTICLES.map((particle, index) => (
        <ConfettiParticle
          key={`${particle.x}-${particle.y}-${index}`}
          index={index}
          particle={particle}
        />
      ))}
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
    ...StyleSheet.absoluteFill,
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
  successCheckOverlay: {
    position: 'absolute',
  },
  confettiLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  confettiParticle: {
    position: 'absolute',
    borderRadius: 2,
  },
  statusTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  statusHint: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.75,
    maxWidth: 240,
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
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.glassTint,
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
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.glassTint,
    overflow: 'hidden',
    boxShadow: ['0 10px 26px rgba(0, 0, 0, 0.3)', 'inset 0 1px 1px rgba(255, 255, 255, 0.1)'].join(
      ', ',
    ),
  },
  successSummaryCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.glassTint,
    overflow: 'hidden',
    boxShadow: [
      '0 18px 42px rgba(0, 0, 0, 0.46)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.32)',
    ].join(', '),
  },
  successSummaryGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '46%',
    backgroundColor: colors.glass.smokeWash,
    opacity: 0.78,
  },
  successAmount: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    fontFamily: fontFamily.semiBold,
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
  summaryRowPressable: {
    backgroundColor: colors.surface.backgroundTint,
  },
  summaryRowLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    flexShrink: 0,
  },
  summaryValueWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  summaryValue: {
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 13,
    lineHeight: 17,
  },
  textButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
  },
  textPressed: {
    opacity: 0.6,
  },
  successActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resendButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.glassTint,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [
      '0 10px 24px rgba(0, 0, 0, 0.28)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.14)',
    ].join(', '),
  },
  doneButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.glossAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: {
    opacity: 0.82,
  },
});
