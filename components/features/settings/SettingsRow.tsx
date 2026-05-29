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
  badgeCount?: number;
  isExternal?: boolean;
  compact?: boolean;
  dense?: boolean;
  onPress?: () => void;
}

export function SettingsRow({
  iconNode,
  label,
  subtitle,
  rightValue,
  badgeCount,
  isExternal = false,
  compact = false,
  dense = false,
  onPress,
}: SettingsRowProps): React.JSX.Element {
  const iconWellSize = dense ? 36 : compact ? 38 : 42;
  const accessorySize = dense ? 19 : 21;
  const showAccessory = onPress != null;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        dense && styles.rowDense,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      disabled={onPress == null}
      accessibilityRole={onPress == null ? undefined : 'button'}
      accessibilityLabel={label}
    >
      <View style={styles.left}>
        <View style={[styles.iconWrap, { width: iconWellSize, height: iconWellSize }]}>
          {iconNode}
        </View>
        <View style={styles.textCol}>
          <Text
            variant="body"
            color={colors.text.primary}
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
            <Text variant="small" color={colors.text.primary} style={styles.badgeText}>
              {badgeCount}
            </Text>
          </View>
        ) : null}

        {showAccessory ? (
          isExternal ? (
            <PuffyExternalLinkIcon size={accessorySize} color={colors.text.tertiary} focused />
          ) : (
            <PuffyChevronRightIcon size={accessorySize} color={colors.text.tertiary} focused />
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
    minHeight: 70,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: 'transparent',
    gap: spacing.md,
    minWidth: 0,
  },
  rowCompact: {
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  rowDense: {
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.holdingsCard.pressed,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    minWidth: 0,
  },
  iconWrap: {
    borderRadius: radii.full,
    backgroundColor: colors.glass.textBacking,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 10px 18px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.76)',
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
  },
  badge: {
    minWidth: layout.iconSizeInline + spacing.xs,
    height: layout.iconSizeInline + spacing.xs,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  badgeText: {
    fontFamily: fontFamily.semiBold,
  },
});
