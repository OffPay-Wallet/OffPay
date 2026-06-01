import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface HoldingsSearchBarProps {
  value: string;
  onChange: (next: string) => void;
}

export function HoldingsSearchBar({ value, onChange }: HoldingsSearchBarProps): React.JSX.Element {
  const hasQuery = value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <View style={[{ backgroundColor: colors.glass.strongFill }, styles.surface]}>
        <Ionicons
          name="search-outline"
          size={layout.iconSizeInline}
          color={colors.text.secondary}
        />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Search tokens"
          placeholderTextColor={colors.text.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          selectionColor={colors.brand.glossAccent}
          style={styles.input}
          accessibilityLabel="Search tokens"
        />
        <Pressable
          style={styles.clearIcon}
          onPress={() => onChange('')}
          disabled={!hasQuery}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Clear token search"
          accessibilityState={{ disabled: !hasQuery }}
        >
          {hasQuery ? (
            <Ionicons
              name="close-circle"
              size={layout.iconSizeInline}
              color={colors.text.secondary}
            />
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: `0 2px 8px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: layout.minTouchTarget + spacing.sm,
  },
  input: {
    flex: 1,
    height: '100%',
    color: colors.text.primary,
    fontFamily: fontFamily.uiMedium,
    fontSize: 15,
  },
  clearIcon: {
    width: layout.iconSizeInline,
    height: layout.iconSizeInline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
