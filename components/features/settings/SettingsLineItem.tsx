/**
 * SettingsLineItem — icon + title/subtitle row with optional right content.
 * Used inside bottom-sheet modals (Security, Preferences) for menu items.
 * NOT the same as SettingsRow (which is for the top-level Settings screen).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { ReactNode } from 'react';

interface SettingsLineItemProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  iconVariant?: 'default' | 'accent';
  compact?: boolean;
  dense?: boolean;
}

export function SettingsLineItem({
  icon,
  title,
  subtitle,
  right,
  onPress,
  disabled = false,
  iconVariant = 'default',
  compact = false,
  dense = false,
}: SettingsLineItemProps): React.JSX.Element {
  const iconSize = dense ? 32 : compact ? 36 : 40;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        dense && styles.rowDense,
        pressed && !disabled ? styles.pressed : undefined,
        disabled && styles.disabled,
      ]}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.left}>
        <View
          style={[
            styles.icon,
            { width: iconSize, height: iconSize },
            iconVariant === 'accent' ? styles.iconAccent : undefined,
          ]}
        >
          {icon}
        </View>
        <View style={styles.text}>
          <Text
            variant="body"
            color={colors.text.primary}
            style={[styles.title, compact && styles.titleCompact, dense && styles.titleDense]}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.05}
          >
            {title}
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
      {right != null ? <View style={styles.right}>{right}</View> : null}
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
    gap: spacing.md,
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
  pressed: { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
  disabled: { opacity: 0.4 },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, minWidth: 0 },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.1)',
      'inset 0 -1px 1px rgba(0, 0, 0, 0.15)',
    ].join(', '),
  },
  iconAccent: {
    opacity: 0.92,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  titleCompact: {
    fontSize: 15,
    lineHeight: 19,
  },
  titleDense: {
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
    flexShrink: 0,
    alignItems: 'flex-end',
    marginLeft: spacing.xs,
  },
});
