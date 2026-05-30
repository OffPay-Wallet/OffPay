import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import cancelLottie from '@/assets/lotties/Cancel.json';
import successLottie from '@/assets/lotties/success.json';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export type ProcessResultVariant = 'success' | 'cancelled' | 'error';

export interface ProcessResultTokenLeg {
  label: string;
  amount: string;
  symbol: string;
  name: string;
  logo: string | null;
}

export interface ProcessResultDetailRow {
  label: string;
  value: string;
  selectable?: boolean;
}

interface ProcessResultScreenProps {
  visible: boolean;
  variant: ProcessResultVariant;
  title: string;
  message?: string;
  statusLabel?: string;
  tokenLegs?: ProcessResultTokenLeg[];
  detailRows?: ProcessResultDetailRow[];
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  animationSize?: number;
  onAnimationFinish?: () => void;
  minimal?: boolean;
  transition?: 'fade' | 'ios-slide';
  transitionDirection?: 'forward' | 'backward';
}

const RESULT_CONTENT_MAX_WIDTH = 430;
const RESULT_SLIDE_DURATION_MS = 260;

function getResultEnteringAnimation(
  transition: ProcessResultScreenProps['transition'],
  direction: ProcessResultScreenProps['transitionDirection'],
) {
  if (transition !== 'ios-slide') return FadeIn.duration(180);
  const animation = direction === 'backward' ? SlideInLeft : SlideInRight;
  return animation.duration(RESULT_SLIDE_DURATION_MS).easing(Easing.out(Easing.cubic));
}

function getResultExitingAnimation(
  transition: ProcessResultScreenProps['transition'],
  direction: ProcessResultScreenProps['transitionDirection'],
) {
  if (transition !== 'ios-slide') return FadeOut.duration(140);
  const animation = direction === 'backward' ? SlideOutRight : SlideOutLeft;
  return animation.duration(RESULT_SLIDE_DURATION_MS).easing(Easing.out(Easing.cubic));
}

function extractFirstLottieFillColor(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (record.ty === 'fl') {
    const color = (record.c as { k?: unknown } | undefined)?.k;
    if (
      Array.isArray(color) &&
      color.length >= 3 &&
      typeof color[0] === 'number' &&
      typeof color[1] === 'number' &&
      typeof color[2] === 'number'
    ) {
      const [red = 0, green = 0, blue = 0, alpha = 1] = color as number[];
      return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(
        blue * 255,
      )}, ${alpha})`;
    }
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const color = extractFirstLottieFillColor(item);
        if (color != null) return color;
      }
      continue;
    }

    const color = extractFirstLottieFillColor(child);
    if (color != null) return color;
  }

  return null;
}

function getResultLottieColor(variant: ProcessResultVariant): string {
  if (variant !== 'success') {
    return colors.semantic.error;
  }

  const source = variant === 'success' ? successLottie : cancelLottie;
  return extractFirstLottieFillColor(source) ?? colors.semantic.success;
}

function ResultLottieMark({
  variant,
  size,
  onAnimationFinish,
}: {
  variant: ProcessResultVariant;
  size: number;
  onAnimationFinish?: () => void;
}): React.JSX.Element {
  const source = (variant === 'success' ? successLottie : cancelLottie) as AnimationObject;

  return (
    <View
      pointerEvents="none"
      style={[styles.animation, { width: size, height: size }]}
      accessibilityLabel={source.nm ?? 'Lottie animation'}
    >
      <LottieView
        key={variant}
        source={source}
        autoPlay
        loop={false}
        resizeMode="contain"
        onAnimationFinish={onAnimationFinish}
        style={styles.lottie}
      />
    </View>
  );
}

function ResultTokenRow({
  leg,
  compact,
}: {
  leg: ProcessResultTokenLeg;
  compact: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.tokenRow, compact && styles.tokenRowCompact]}>
      <View style={styles.tokenIdentity}>
        <TokenIcon
          symbol={leg.symbol}
          name={leg.name}
          logoUri={leg.logo}
          size={compact ? 30 : 34}
        />
        <View style={styles.tokenText}>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {leg.label}
          </Text>
          <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
            {leg.symbol}
          </Text>
        </View>
      </View>
      <Text
        variant={compact ? 'bodyBold' : 'h3'}
        color={colors.text.primary}
        style={styles.tokenAmount}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.58}
        selectable
      >
        {leg.amount}
      </Text>
    </View>
  );
}

export function ProcessResultScreen({
  visible,
  variant,
  title,
  message,
  statusLabel,
  tokenLegs = [],
  detailRows = [],
  secondaryActionLabel,
  onSecondaryAction,
  primaryActionLabel,
  onPrimaryAction,
  animationSize: animationSizeOverride,
  onAnimationFinish,
  minimal = false,
  transition = 'fade',
  transitionDirection = 'forward',
}: ProcessResultScreenProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const compact = width < 390 || height < 780 || fontScale > 1.08;
  const dense = width < 350 || height < 700 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const animationSize = animationSizeOverride ?? (dense ? 160 : compact ? 188 : 220);
  const actionBottomPadding = Math.max(insets.bottom, dense ? spacing.md : spacing.lg);
  const actionTopPadding = dense ? spacing.sm : spacing.md;
  const actionHeight = dense ? layout.buttonHeightMd : layout.buttonHeightLg;
  const resultColor = getResultLottieColor(variant);
  const statusColor = resultColor;

  if (!visible) return null;

  return (
    <Animated.View
      entering={getResultEnteringAnimation(transition, transitionDirection)}
      exiting={getResultExitingAnimation(transition, transitionDirection)}
      style={styles.screen}
    >
      <GradientBackground />
      <View style={[styles.safeFrame, { paddingTop: insets.top }]}>
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: horizontalPadding,
              paddingTop: dense ? spacing.lg : spacing.xl,
              paddingBottom: actionBottomPadding + 88,
              gap: dense ? spacing.md : spacing.lg,
            },
          ]}
        >
          <View style={styles.contentFrame}>
            <View style={styles.hero}>
              <ResultLottieMark
                variant={variant}
                size={animationSize}
                onAnimationFinish={onAnimationFinish}
              />
              <View style={[styles.heroCopy, minimal ? styles.heroCopyMinimal : undefined]}>
                {statusLabel != null && !minimal ? (
                  <View style={styles.statusPill}>
                    <Text
                      variant="small"
                      color={statusColor}
                      numberOfLines={1}
                      style={styles.statusText}
                    >
                      {statusLabel}
                    </Text>
                  </View>
                ) : null}
                <Text
                  variant={minimal ? 'h1' : 'h2'}
                  color={resultColor}
                  align="center"
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  maxFontSizeMultiplier={1}
                  style={[styles.title, minimal ? styles.titleMinimal : undefined]}
                >
                  {title}
                </Text>
                {message != null && message.length > 0 && !minimal ? (
                  <Text
                    variant="caption"
                    color={colors.text.secondary}
                    align="center"
                    numberOfLines={3}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                  >
                    {message}
                  </Text>
                ) : null}
                {secondaryActionLabel != null && onSecondaryAction != null && !minimal ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryAction,
                      pressed ? styles.controlPressed : null,
                    ]}
                    onPress={onSecondaryAction}
                    accessibilityRole="button"
                    accessibilityLabel={secondaryActionLabel}
                    hitSlop={8}
                  >
                    <Text
                      variant="bodyBold"
                      color={colors.brand.azureCyan}
                      align="center"
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.78}
                      style={styles.secondaryActionText}
                    >
                      {secondaryActionLabel}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {tokenLegs.length > 0 ? (
              <LinearGradient
                colors={[colors.glass.strongFill, colors.glass.frostFill, colors.glass.clearFill]}
                start={{ x: 0.04, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.panel}
              >
                {tokenLegs.map((leg, index) => (
                  <React.Fragment key={`${leg.label}-${leg.symbol}-${index}`}>
                    <ResultTokenRow leg={leg} compact={compact} />
                    {index < tokenLegs.length - 1 ? (
                      <View style={styles.tokenDivider}>
                        <View style={styles.dividerLine} />
                        <View style={styles.arrowBadge}>
                          <Ionicons name="arrow-down" size={16} color={colors.brand.deepShadow} />
                        </View>
                        <View style={styles.dividerLine} />
                      </View>
                    ) : null}
                  </React.Fragment>
                ))}
              </LinearGradient>
            ) : null}

            {detailRows.length > 0 ? (
              <LinearGradient
                colors={[colors.glass.strongFill, colors.glass.frostFill, colors.glass.clearFill]}
                start={{ x: 0.04, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.detailsPanel}
              >
                {detailRows.map((row, index) => (
                  <React.Fragment key={`${row.label}-${index}`}>
                    <View style={styles.detailRow}>
                      <Text
                        variant="small"
                        color={colors.text.secondary}
                        style={styles.detailLabel}
                        numberOfLines={1}
                      >
                        {row.label}
                      </Text>
                      <Text
                        variant="small"
                        color={colors.text.primary}
                        style={styles.detailValue}
                        numberOfLines={row.selectable ? 2 : 1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.64}
                        selectable={row.selectable}
                      >
                        {row.value}
                      </Text>
                    </View>
                    {index < detailRows.length - 1 ? <View style={styles.divider} /> : null}
                  </React.Fragment>
                ))}
              </LinearGradient>
            ) : null}
          </View>
        </ScrollView>

        {primaryActionLabel != null && onPrimaryAction != null && !minimal ? (
          <View
            style={[
              styles.footer,
              {
                paddingHorizontal: horizontalPadding,
                paddingBottom: actionBottomPadding,
                paddingTop: actionTopPadding,
              },
            ]}
          >
            <View style={styles.contentFrame}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  { height: actionHeight },
                  pressed ? styles.primaryButtonPressed : null,
                ]}
                onPress={onPrimaryAction}
                accessibilityRole="button"
                accessibilityLabel={primaryActionLabel}
              >
                <Text
                  variant="button"
                  color={colors.brand.whiteStream}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  style={styles.primaryButtonText}
                >
                  {primaryActionLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10020,
    elevation: 10020,
    backgroundColor: colors.backgroundGradient.base,
  },
  safeFrame: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: RESULT_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  heroCopy: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroCopyMinimal: {
    gap: spacing.lg,
  },
  animation: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: '100%',
    height: '100%',
  },
  statusPill: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  statusText: {
    fontFamily: fontFamily.uiBold,
    textAlign: 'center',
  },
  title: {
    fontFamily: fontFamily.display,
  },
  titleMinimal: {
    fontSize: 40,
    lineHeight: 48,
  },
  secondaryAction: {
    minHeight: layout.buttonHeightSm,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryActionText: {
    fontFamily: fontFamily.uiBold,
  },
  panel: {
    marginTop: spacing.lg,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
  },
  tokenRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minWidth: 0,
  },
  tokenRowCompact: {
    minHeight: 48,
  },
  tokenIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tokenText: {
    flex: 1,
    minWidth: 0,
  },
  tokenAmount: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.displaySemiBold,
    fontVariant: ['tabular-nums'],
  },
  tokenDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
  arrowBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  detailsPanel: {
    marginTop: spacing.md,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
  },
  detailRow: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
  },
  detailLabel: {
    width: 96,
    flexShrink: 0,
    fontFamily: fontFamily.uiMedium,
  },
  detailValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.uiSemiBold,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
  footer: {
    backgroundColor: 'transparent',
    flexShrink: 0,
    zIndex: 2,
  },
  primaryButton: {
    height: layout.buttonHeightLg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.azureCyan,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonPressed: {
    backgroundColor: colors.brand.azureBlue,
  },
  primaryButtonText: {
    textAlign: 'center',
  },
  controlPressed: {
    opacity: 0.72,
  },
});
