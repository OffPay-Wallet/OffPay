import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface HoldingsHeaderProps {
  title?: string;
  onBack: () => void;
}

export function HoldingsHeader({
  title = 'Holdings',
  onBack,
}: HoldingsHeaderProps): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.headerIconBtn, pressed && styles.headerIconPressed]}
        onPress={onBack}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <LinearGradient
          colors={[colors.glass.strongFill, colors.glass.frostFill, colors.glass.clearFill]}
          start={{ x: 0.04, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerIconSurface}
        >
          <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.brand.deepShadow} />
        </LinearGradient>
      </Pressable>

      <Text
        variant="h2"
        color={colors.text.inverse}
        style={styles.headerTitle}
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.86}
        maxFontSizeMultiplier={1}
      >
        {title}
      </Text>

      {/* Spacer to keep title centered */}
      <View style={styles.rightSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    marginBottom: spacing.md,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.display,
  },
  headerIconBtn: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  headerIconPressed: {
    opacity: 0.72,
  },
  headerIconSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightSpacer: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
  },
});
