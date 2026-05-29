/**
 * GlassActionButton — primary CTA for the wallet-setup flow.
 *
 * Solid-fill recipe (matches the onboarding "Create a new wallet"
 * and Settings → Reset buttons): no gradient, no shadow, no rim
 * glow. The variant controls the fill colour and label ink while
 * the geometry (pill, full-width, 48–56dp height) stays constant.
 *
 * Variants:
 *   - primary    → azureCyan fill, white text. Primary CTA.
 *   - secondary  → whiteStream fill, deep navy text, hairline rim.
 *                  Reads as a peer to the primary without competing.
 *   - solidBlue  → azureBlue fill, white text. Use for a third
 *                  emphasis tier (rare).
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';

import type { ReactNode } from 'react';

export type GlassActionButtonVariant = 'primary' | 'secondary' | 'solidBlue';
export type GlassActionButtonSize = 'regular' | 'compact';

interface GlassActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: GlassActionButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  size?: GlassActionButtonSize;
  accessibilityLabel?: string;
}

interface VariantTokens {
  fill: string;
  pressedFill: string;
  label: string;
  borderColor?: string;
  borderWidth?: number;
}

const VARIANT_TOKENS: Record<GlassActionButtonVariant, VariantTokens> = {
  primary: {
    fill: colors.brand.azureCyan,
    pressedFill: colors.brand.azureBlue,
    label: colors.brand.whiteStream,
  },
  secondary: {
    fill: colors.brand.whiteStream,
    pressedFill: colors.brand.iceBlue,
    label: colors.brand.deepShadow,
    borderColor: colors.glass.rim,
    borderWidth: StyleSheet.hairlineWidth,
  },
  solidBlue: {
    fill: colors.brand.azureBlue,
    pressedFill: colors.brand.deepShadow,
    label: colors.brand.whiteStream,
  },
};

export function GlassActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  size = 'regular',
  accessibilityLabel,
}: GlassActionButtonProps): React.JSX.Element {
  const tokens = VARIANT_TOKENS[variant];
  const isDisabled = disabled || loading;
  const isCompact = size === 'compact';
  const buttonHeight = isCompact ? layout.buttonHeightMd : layout.buttonHeightLg;
  const verticalPadding = isCompact ? spacing.sm : spacing.md;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.shell,
        {
          minHeight: buttonHeight,
          paddingVertical: verticalPadding,
          backgroundColor: pressed && !isDisabled ? tokens.pressedFill : tokens.fill,
          borderColor: tokens.borderColor,
          borderWidth: tokens.borderWidth,
        },
        isDisabled ? styles.disabled : null,
      ]}
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      <View style={styles.content}>
        {!loading && icon != null ? icon : null}
        <Text
          variant={isCompact ? 'buttonSmall' : 'button'}
          color={tokens.label}
          align="center"
          numberOfLines={1}
          maxFontSizeMultiplier={1.05}
          style={styles.label}
        >
          {label}
        </Text>
        {loading ? (
          <ActivityIndicator size="small" color={tokens.label} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    flexShrink: 1,
  },
});
