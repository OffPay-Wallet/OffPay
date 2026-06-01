import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { PuffyChevronRightIcon } from '@/components/ui/icons/PuffyChevronRightIcon';
import { PuffyExternalLinkIcon } from '@/components/ui/icons/PuffyExternalLinkIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import type { ReactNode } from 'react';

interface SettingsRowProps {
  iconNode?: ReactNode;
  label: string;
  subtitle?: string;
  rightValue?: string;
  rightNode?: ReactNode;
  badgeCount?: number;
  isExternal?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  compact?: boolean;
  dense?: boolean;
  onPress?: () => void;
}

export function SettingsRow({
  iconNode,
  label,
  subtitle,
  rightValue,
  rightNode,
  badgeCount,
  isExternal = false,
  destructive = false,
  disabled = false,
  compact = false,
  dense = false,
  onPress,
}: SettingsRowProps): React.JSX.Element {
  const iconWellSize = dense ? 24 : compact ? 26 : 28;
  const accessorySize = dense ? 18 : 20;
  const showAccessory = onPress != null && !disabled;
  const labelColor = destructive ? colors.semantic.error : colors.brand.deepShadow;
  const accessoryColor = destructive ? colors.semantic.error : colors.text.tertiary;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        dense && styles.rowDense,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled || onPress == null}
      accessibilityRole={onPress == null ? undefined : 'button'}
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
    >
      <View style={styles.left}>
        <View style={[styles.iconWrap, { width: iconWellSize, height: iconWellSize }]}>
          {iconNode}
        </View>
        <View style={styles.textCol}>
          <Text
            variant="body"
            color={labelColor}
            style={[styles.label, compact && styles.labelCompact, dense && styles.labelDense]}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.05}
          >
            {label}
          </Text>
          {subtitle != null ? (
            <Text
              variant="small"
              color={colors.text.secondary}
              style={[styles.subtitle, dense && styles.subtitleDense]}
              numberOfLines={2}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.right}>
        {rightNode != null ? rightNode : null}

        {rightValue != null ? (
          <Text
            variant="small"
            color={colors.text.secondary}
            style={styles.rightValue}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {rightValue}
          </Text>
        ) : null}

        {badgeCount != null ? (
          <View style={styles.badge}>
            <Text variant="small" color={colors.brand.deepShadow} style={styles.badgeText}>
              {badgeCount}
            </Text>
          </View>
        ) : null}

        {showAccessory ? (
          isExternal ? (
            <PuffyExternalLinkIcon size={accessorySize} color={accessoryColor} focused />
          ) : (
            <PuffyChevronRightIcon size={accessorySize} color={accessoryColor} focused />
          )
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'transparent',
    gap: spacing.sm,
    minWidth: 0,
  },
  rowCompact: {
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  rowDense: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surface.pressed,
  },
  disabled: {
    opacity: 0.5,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    minWidth: 0,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  label: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  labelCompact: {
    fontSize: 15,
    lineHeight: 19,
  },
  labelDense: {
    fontSize: 14,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  subtitleDense: {
    fontSize: 11,
    lineHeight: 14,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  rightValue: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    minWidth: layout.iconSizeInline + spacing.xs,
    height: layout.iconSizeInline + spacing.xs,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.iceBlue,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surface.backgroundAlt,
  },
  badgeText: {
    fontFamily: fontFamily.semiBold,
  },
});
