import Ionicons from '@expo/vector-icons/Ionicons';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import cancelLottie from '@/assets/lotties/Cancel.json';
import { SendSuccessLottieMark } from '@/components/features/private-payment/send-flow/SendSummarySheet';
import { GlassSliderButton } from '@/components/ui/glass-slider-button';
import { SolscanTransactionLink } from '@/components/ui/SolscanTransactionLink';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useLoopingProgress } from '@/hooks/useLoopingProgress';
import { useOverlayVisibilityStore } from '@/store/overlayVisibilityStore';

import { useQuoteExpiryDetailLabel } from '@/components/features/swap/quote-expiry-label';

import type { OffpayNetwork } from '@/types/offpay-api';

export type RwaSwapReviewScreenPhase = 'review' | 'processing' | 'success' | 'error';
export type RwaSwapReviewScreenSide = 'buy' | 'sell';

export interface RwaSwapReviewScreenTokenLeg {
  label: string;
  amount: string;
  symbol: string;
  name: string;
  logo: string | null;
}

export interface RwaSwapReviewScreenDetailRow {
  label: string;
  value: string;
  expiresAt?: number | null;
  selectable?: boolean;
  signature?: string | null;
  network?: OffpayNetwork | null;
}

interface RwaSwapReviewScreenProps {
  visible: boolean;
  phase: RwaSwapReviewScreenPhase;
  payLeg: RwaSwapReviewScreenTokenLeg | null;
  receiveLeg: RwaSwapReviewScreenTokenLeg | null;
  detailRows: RwaSwapReviewScreenDetailRow[];
  side: RwaSwapReviewScreenSide | null;
  canSubmit: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onTradeAgain: () => void;
  onDone: () => void;
}

const OPEN_DURATION_MS = 360;
const CLOSE_DURATION_MS = 240;
const PHASE_FADE_MS = 260;
const DISMISS_DRAG_RATIO = 0.32;
const CIRCLE_SIZE = 112;
const RESULT_MARK_SIZE = 156;
const RING_THICKNESS = 4;
const ERROR_AUTO_DISMISS_MS = 2200;
const OVERLAY_ID = 'rwa-swap-review';

function SheetDetailValue({
  row,
  visible,
}: {
  row: RwaSwapReviewScreenDetailRow;
  visible: boolean;
}): React.JSX.Element {
  const value = useQuoteExpiryDetailLabel(row.value, row.expiresAt, { enabled: visible });

  if (row.signature != null && row.network != null) {
    return (
      <SolscanTransactionLink
        signature={row.signature}
        network={row.network}
        accessibilityLabel="View RWA transaction on Solscan"
        style={styles.detailLink}
        textStyle={styles.detailValue}
      />
    );
  }

  return (
    <Text
      variant="captionBold"
      color={colors.text.primary}
      numberOfLines={row.selectable ? 2 : 1}
      adjustsFontSizeToFit
      minimumFontScale={0.64}
      selectable={row.selectable}
      style={styles.detailValue}
    >
      {value}
    </Text>
  );
}

function DetailRow({
  row,
  last,
  visible,
}: {
  row: RwaSwapReviewScreenDetailRow;
  last: boolean;
  visible: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text variant="caption" color={colors.text.secondary} style={styles.detailLabel}>
        {row.label}
      </Text>
      <SheetDetailValue row={row} visible={visible} />
    </View>
  );
}

function TokenLegRow({
  leg,
  emphasized,
}: {
  leg: RwaSwapReviewScreenTokenLeg;
  emphasized?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.legRow}>
      <View style={styles.legIdentity}>
        <TokenIcon symbol={leg.symbol} name={leg.name} logoUri={leg.logo} size={40} />
        <View style={styles.legTextBlock}>
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            {leg.label}
          </Text>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            numberOfLines={1}
            style={styles.legSymbol}
          >
            {leg.symbol}
          </Text>
        </View>
      </View>
      <Text
        variant={emphasized ? 'h3' : 'bodyBold'}
        color={colors.text.primary}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.58}
        selectable
        style={styles.legAmount}
      >
        {leg.amount}
      </Text>
    </View>
  );
}

function ResultLottie({
  phase,
}: {
  phase: Extract<RwaSwapReviewScreenPhase, 'success' | 'error'>;
}): React.JSX.Element {
  if (phase === 'success') return <SendSuccessLottieMark size={RESULT_MARK_SIZE} />;

  const source = cancelLottie as AnimationObject;

  return (
    <View style={styles.resultStatusInner}>
      <LottieView
        source={source}
        autoPlay
        loop={false}
        resizeMode="contain"
        style={styles.resultLottie}
      />
    </View>
  );
}

export function RwaSwapReviewScreen({
  visible,
  phase,
  payLeg,
  receiveLeg,
  detailRows,
  side,
  canSubmit,
  onCancel,
  onConfirm,
  onTradeAgain,
  onDone,
}: RwaSwapReviewScreenProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const showOverlay = useOverlayVisibilityStore((state) => state.showOverlay);
  const hideOverlay = useOverlayVisibilityStore((state) => state.hideOverlay);
  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(0);
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const sheetHeightRef = useRef(0);
  const lockedRef = useRef(phase !== 'review');
  lockedRef.current = phase !== 'review';

  const processing = phase === 'processing';
  const review = phase === 'review';
  const result = phase === 'success' || phase === 'error';
  const statusOnly = processing || result;
  const statusLeg =
    receiveLeg?.logo != null ? receiveLeg : payLeg?.logo != null ? payLeg : (receiveLeg ?? payLeg);
  const sliderLabel = side === 'sell' ? 'Slide to Sell' : 'Slide to Buy';
  const resultLinkRows = result
    ? detailRows.filter((row) => row.signature != null && row.network != null)
    : [];

  const ringSpin = useLoopingProgress({ active: processing, durationMs: 900 });

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
    if (!visible || phase !== 'error') return undefined;
    const timeout = setTimeout(onDone, ERROR_AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [onDone, phase, visible]);

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
    return { transform: [{ translateY: (1 - progress.value) * hidden + dragY.value }] };
  });
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringSpin.value * 360}deg` }],
  }));

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlayRoot]} pointerEvents="box-none">
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (review) onCancel();
            if (phase === 'error') onDone();
          }}
          accessibilityLabel={review ? 'Dismiss RWA swap review' : 'Dismiss RWA swap result'}
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
        <View style={styles.grabberZone} {...(review ? panResponder.panHandlers : {})}>
          <View style={[styles.grabber, !review && styles.grabberHidden]} />
        </View>

        {statusOnly ? (
          <Animated.View
            key={`status-${phase}`}
            entering={FadeIn.duration(PHASE_FADE_MS)}
            layout={LinearTransition.duration(PHASE_FADE_MS).easing(Easing.out(Easing.cubic))}
            style={styles.statusOnly}
          >
            <View style={[styles.statusCircle, result && styles.resultStatusCircle]}>
              {processing ? (
                <>
                  <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
                  <View style={styles.statusInner}>
                    <TokenIcon
                      symbol={statusLeg?.symbol}
                      name={statusLeg?.name ?? statusLeg?.symbol ?? 'RWA'}
                      logoUri={statusLeg?.logo ?? null}
                      size={CIRCLE_SIZE - RING_THICKNESS * 2 - 18}
                    />
                  </View>
                </>
              ) : (
                <ResultLottie phase={phase} />
              )}
            </View>
            {result ? (
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                align="center"
                style={styles.resultTitle}
              >
                {phase === 'success' ? (side === 'sell' ? 'Sold!' : 'Bought!') : 'Trade failed'}
              </Text>
            ) : null}
            {resultLinkRows.length > 0 ? (
              <View style={styles.resultDetailCard}>
                {resultLinkRows.map((row, index) => (
                  <DetailRow
                    key={`${row.label}-${index}`}
                    row={row}
                    last={index === resultLinkRows.length - 1}
                    visible={visible}
                  />
                ))}
              </View>
            ) : null}
            {phase === 'success' ? (
              <View style={styles.successActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.tradeAgainButton,
                    pressed && styles.actionPressed,
                  ]}
                  onPress={onTradeAgain}
                  accessibilityRole="button"
                  accessibilityLabel={side === 'sell' ? 'Sell this asset again' : 'Buy this asset again'}
                >
                  <Text variant="button" color={colors.text.primary}>
                    {side === 'sell' ? 'Sell again' : 'Buy again'}
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
        ) : (
          <>
            <Text
              variant="h3"
              color={colors.text.primary}
              align="center"
              style={styles.phaseTitle}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              RWA swap review
            </Text>

            <View style={styles.orderCard}>
              {payLeg != null ? <TokenLegRow leg={payLeg} /> : null}
              <View style={styles.legDivider}>
                <View style={styles.dividerLine} />
                <View style={styles.arrowBadge}>
                  <Ionicons name="arrow-down" size={17} color={colors.text.primary} />
                </View>
                <View style={styles.dividerLine} />
              </View>
              {receiveLeg != null ? <TokenLegRow leg={receiveLeg} /> : null}
            </View>

            {detailRows.length > 0 ? (
              <View style={styles.detailCard}>
                {detailRows.map((row, index) => (
                  <DetailRow
                    key={`${row.label}-${index}`}
                    row={row}
                    last={index === detailRows.length - 1}
                    visible={visible}
                  />
                ))}
              </View>
            ) : null}

            <GlassSliderButton
              label={sliderLabel}
              loadingLabel="Signing"
              disabled={!canSubmit}
              loading={false}
              onComplete={onConfirm}
            />
            <Pressable
              style={({ pressed }) => [styles.textButton, pressed && styles.textPressed]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close and edit RWA swap"
            >
              <Text variant="button" color={colors.text.secondary}>
                Close
              </Text>
            </Pressable>
          </>
        )}
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
  grabberHidden: {
    opacity: 0,
  },
  phaseTitle: {
    fontFamily: fontFamily.semiBold,
  },
  statusOnly: {
    minHeight: 176,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  statusCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultStatusCircle: {
    width: RESULT_MARK_SIZE,
    height: RESULT_MARK_SIZE,
    borderRadius: RESULT_MARK_SIZE / 2,
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: RING_THICKNESS,
    borderColor: colors.glass.smokeWash,
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
  resultStatusInner: {
    width: RESULT_MARK_SIZE,
    height: RESULT_MARK_SIZE,
    borderRadius: RESULT_MARK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultLottie: {
    width: RESULT_MARK_SIZE,
    height: RESULT_MARK_SIZE,
  },
  orderCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.glassTint,
    padding: spacing.lg,
    gap: spacing.sm,
    boxShadow: ['0 10px 26px rgba(0, 0, 0, 0.3)', 'inset 0 1px 1px rgba(255, 255, 255, 0.1)'].join(
      ', ',
    ),
  },
  legRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  legIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  legSymbol: {
    fontFamily: fontFamily.uiSemiBold,
  },
  legAmount: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.displaySemiBold,
    fontVariant: ['tabular-nums'],
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
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
  },
  detailRow: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    width: 86,
    flexShrink: 0,
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 13,
    lineHeight: 17,
  },
  detailLink: {
    flex: 1,
    minWidth: 0,
  },
  resultDetailCard: {
    alignSelf: 'stretch',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.glassTint,
    overflow: 'hidden',
  },
  resultTitle: {
    fontFamily: fontFamily.semiBold,
  },
  successActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tradeAgainButton: {
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
  textButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
  },
  textPressed: {
    opacity: 0.6,
  },
});
