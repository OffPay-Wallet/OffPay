/**
 * SelectableCard — radio-style selection card with optional badge.
 * Used by PreferencesModal for Wallet Mode and Network selection.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface SelectableCardProps {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
  badge?: string;
  disabled?: boolean;
}

export function SelectableCard({
  title,
  subtitle,
  selected,
  onPress,
  badge,
  disabled = false,
}: SelectableCardProps): React.JSX.Element {
  const pressDisabled = disabled || selected;

  return (
    <Pressable
      style={[
        styles.card,
        selected ? styles.cardActive : undefined,
        disabled ? styles.disabled : undefined,
      ]}
      onPress={pressDisabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={title}
    >
      <View style={styles.content}>
        <View style={styles.textWrap}>
          <View style={styles.titleRow}>
            <Text
              variant="body"
              color={selected ? colors.brand.azureCyan : colors.text.primary}
              style={styles.title}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
            {badge != null ? (
              <View style={styles.badge}>
                <Text variant="small" color={colors.text.secondary} style={styles.badgeText}>
                  {badge}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="small" color={colors.text.secondary} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        <View style={[styles.radio, selected ? styles.radioActive : undefined]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
    padding: spacing.lg,
    minWidth: 0,
  },
  cardActive: {
    borderColor: colors.brand.azureCyan,
    backgroundColor: colors.glass.cyanWash,
  },
  disabled: {
    opacity: 0.45,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  textWrap: { flex: 1, minWidth: 0, marginRight: spacing.md, gap: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    minWidth: 0,
  },
  title: { fontFamily: fontFamily.medium, minWidth: 0, flexShrink: 1 },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  badgeText: { fontSize: 10 },
  radio: {
    width: layout.iconSizeInline + spacing.xs,
    height: layout.iconSizeInline + spacing.xs,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioActive: { borderColor: colors.brand.azureCyan },
  radioDot: {
    width: spacing.md,
    height: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.brand.azureCyan,
  },
});
