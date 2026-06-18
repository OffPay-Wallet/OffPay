/**
 * GlassActionButton — primary CTA for the wallet-setup flow.
 *
 * Solid-fill glossy recipe (matches the dark app theme): no gradient
 * fill, with the rim and inset highlight carrying the gloss. The
 * variant controls the fill colour and label ink while the geometry
 * (pill, full-width, 48–56dp height) stays constant.
 *
 * Variants:
 *   - primary    -> gloss highlight fill, dark text. Primary CTA.
 *   - secondary  -> dark raised fill, white text, hairline rim.
 *                  Reads as a peer to the primary without competing.
 *   - solidDark  -> black fill, white text. Use for a third
 *                  emphasis tier (rare).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';

import type { ReactNode } from 'react';

export type GlassActionButtonVariant = 'primary' | 'secondary' | 'solidDark';
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
    fill: colors.brand.glossAccent,
    pressedFill: colors.semantic.warning,
    label: colors.text.onAccent,
    borderColor: colors.glass.rim,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondary: {
    fill: colors.surface.cardElevated,
    pressedFill: colors.surface.pressed,
    label: colors.text.primary,
    borderColor: colors.glass.rim,
    borderWidth: StyleSheet.hairlineWidth,
  },
  solidDark: {
    fill: colors.brand.actionFill,
    pressedFill: colors.surface.backgroundTint,
    label: colors.text.primary,
    borderColor: colors.glass.rimSubtle,
    borderWidth: StyleSheet.hairlineWidth,
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
        {loading ? <LazyLoadingSpinner size={18} color={tokens.label} /> : null}
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
    boxShadow: `0 14px 32px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
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
