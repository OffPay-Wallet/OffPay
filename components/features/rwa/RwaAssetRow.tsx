import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  formatRwaAssetDisplayName,
  formatRwaChangeLabel,
  formatUsd,
  getRwaAssetLogoUri,
  RWA_CATEGORY_LABELS,
  type RwaTradeSide,
} from '@/components/features/rwa/rwa-trade-utils';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { RwaAsset } from '@/types/offpay-api';

// Feather-touch micro interaction: a quick, light press-in and a soft glide back.
const RWA_ACTION_PRESS_IN = {
  duration: 110,
  easing: Easing.out(Easing.quad),
} as const;
const RWA_ACTION_PRESS_OUT = {
  duration: 320,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
} as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const RWA_ACTION_BUTTON_TONES: Record<
  RwaTradeSide,
  {
    background: string;
    backgroundPressed: string;
    border: string;
    borderPressed: string;
  }
> = {
  buy: {
    background: colors.semantic.receiveSoftFill,
    backgroundPressed: colors.semantic.receiveSoftFillPressed,
    border: colors.semantic.receiveSoftBorder,
    borderPressed: colors.semantic.receive,
  },
  sell: {
    background: colors.semantic.errorSoftFill,
    backgroundPressed: colors.semantic.errorSoftFillPressed,
    border: colors.semantic.errorSoftBorder,
    borderPressed: colors.semantic.error,
  },
};

function RwaTradeActionButton({
  side,
  active,
  disabled,
  label,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: {
  side: RwaTradeSide;
  active: boolean;
  disabled: boolean;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
}): React.JSX.Element {
  const pressProgress = useSharedValue(0);
  const tone = RWA_ACTION_BUTTON_TONES[side];

  const releasePress = useCallback((): void => {
    pressProgress.value = withTiming(0, RWA_ACTION_PRESS_OUT);
  }, [pressProgress]);

  const handlePressIn = useCallback((): void => {
    if (!disabled && active) {
      pressProgress.value = withTiming(1, RWA_ACTION_PRESS_IN);
    }
  }, [active, disabled, pressProgress]);

  const handlePressOut = useCallback((): void => {
    releasePress();
  }, [releasePress]);

  const handleResponderTerminate = useCallback((): void => {
    releasePress();
  }, [releasePress]);

  useEffect(() => {
    if (disabled || !active) releasePress();
  }, [active, disabled, releasePress]);

  const animatedButtonStyle = useAnimatedStyle(() => {
    const progress = active ? pressProgress.value : 0;

    return {
      backgroundColor: interpolateColor(
        progress,
        [0, 1],
        [tone.background, tone.backgroundPressed],
      ),
      borderColor: interpolateColor(progress, [0, 1], [tone.border, tone.borderPressed]),
      opacity: 1 - progress * 0.1,
      transform: [{ scale: 1 - progress * 0.03 }],
    };
  }, [active, tone.background, tone.backgroundPressed, tone.border, tone.borderPressed]);

  const foregroundColor = active ? colors.text.primary : colors.text.tertiary;

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onResponderTerminate={handleResponderTerminate}
      onResponderTerminationRequest={() => true}
      unstable_pressDelay={0}
      style={[styles.actionButton, active ? animatedButtonStyle : styles.actionButtonDisabled]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <Text
        variant="captionBold"
        color={foregroundColor}
        style={styles.actionLabel}
        maxFontSizeMultiplier={1.1}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export function RwaAssetRow({
  asset,
  dense,
  buyDisabledReason,
  sellDisabledReason,
  onBuy,
  onSell,
}: {
  asset: RwaAsset;
  dense: boolean;
  buyDisabledReason: string | null;
  sellDisabledReason: string | null;
  onBuy: (asset: RwaAsset) => void;
  onSell: (asset: RwaAsset) => void;
}): React.JSX.Element {
  const canBuy = buyDisabledReason == null;
  const canSell = sellDisabledReason == null;
  const changeLabel = formatRwaChangeLabel(asset.change24hPct);
  const changeColor =
    asset.change24hPct == null
      ? colors.text.tertiary
      : asset.change24hPct >= 0
        ? colors.semantic.receive
        : colors.semantic.error;

  return (
    <View style={[styles.assetCard, dense && styles.assetCardDense]}>
      <View style={[styles.assetHeader, dense && styles.assetHeaderDense]}>
        <View style={styles.assetIdentity}>
          <View style={[styles.assetLogoFrame, dense && styles.assetLogoFrameDense]}>
            <TokenIcon
              symbol={asset.underlyingSymbol ?? asset.symbol}
              name={asset.name}
              logoUri={getRwaAssetLogoUri(asset)}
              size={dense ? 42 : 48}
              recyclingKey={asset.mint}
            />
          </View>
          <View style={styles.assetNameBlock}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={styles.assetName}
              numberOfLines={2}
              maxFontSizeMultiplier={1.15}
            >
              {formatRwaAssetDisplayName(asset)}
            </Text>
            <Text
              variant="small"
              color={colors.text.tertiary}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {RWA_CATEGORY_LABELS[asset.category]} · {asset.underlyingSymbol ?? asset.symbol}
            </Text>
          </View>
        </View>
        <View style={[styles.priceBlock, dense && styles.priceBlockDense]}>
          <Text
            variant="money"
            color={colors.text.primary}
            style={styles.priceText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1.15}
          >
            {formatUsd(asset.priceUsd)}
          </Text>
          {changeLabel != null ? (
            <Text
              variant="small"
              color={changeColor}
              style={styles.changeText}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {changeLabel} 24h
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actionRow}>
        <RwaTradeActionButton
          side="buy"
          active={canBuy}
          disabled={!canBuy}
          label="Buy"
          accessibilityLabel={`Buy ${asset.symbol}`}
          accessibilityHint={buyDisabledReason ?? undefined}
          onPress={() => onBuy(asset)}
        />
        <RwaTradeActionButton
          side="sell"
          active={canSell}
          disabled={!canSell}
          label="Sell"
          accessibilityLabel={`Sell ${asset.symbol}`}
          accessibilityHint={sellDisabledReason ?? undefined}
          onPress={() => onSell(asset)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  assetCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetCardDense: {
    padding: spacing.md,
  },
  assetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  assetHeaderDense: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  assetIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  assetLogoFrame: {
    width: 52,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetLogoFrameDense: {
    width: 44,
    height: 42,
  },
  assetNameBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  assetName: {
    fontFamily: fontFamily.uiSemiBold,
  },
  priceBlock: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  priceBlockDense: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  priceText: {
    fontFamily: fontFamily.moneyBold,
    fontVariant: ['tabular-nums'],
  },
  changeText: {
    fontFamily: fontFamily.uiSemiBold,
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    minHeight: layout.minTouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonDisabled: {
    backgroundColor: colors.surface.disabled,
    borderColor: colors.glass.rimSubtle,
  },
  actionLabel: {
    fontFamily: fontFamily.medium,
  },
});
