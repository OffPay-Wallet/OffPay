import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface RwaScreenHeaderProps {
  compact: boolean;
  onBack: () => void;
}

export function RwaScreenHeader({ compact, onBack }: RwaScreenHeaderProps): React.JSX.Element {
  return (
    <View style={styles.screenHeader}>
      <Pressable
        onPress={onBack}
        hitSlop={6}
        style={({ pressed }) => [
          styles.headerBackButton,
          pressed ? styles.headerBackButtonPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.text.primary} />
      </Pressable>
      <Text
        variant="h3"
        color={colors.text.primary}
        style={[styles.screenTitle, compact && styles.screenTitleCompact]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={1.05}
      >
        RWAs
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerBackButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.minTouchTarget / 2,
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 8px 18px rgba(0, 0, 0, 0.36)',
  },
  headerBackButtonPressed: {
    backgroundColor: colors.surface.solidControlPressed,
  },
  screenTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  screenTitleCompact: {
    fontSize: 19,
    lineHeight: 25,
  },
  headerSpacer: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
});
