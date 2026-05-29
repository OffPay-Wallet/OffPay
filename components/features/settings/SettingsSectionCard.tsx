import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

interface SettingsSectionCardProps {
  children: React.ReactNode;
}

const GRADIENT_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const CARD_SHADOW =
  '0 2px 8px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)';

export function SettingsSectionCard({ children }: SettingsSectionCardProps): React.JSX.Element {
  return (
    <View style={styles.shell}>
      <LinearGradient
        colors={[...GRADIENT_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {children}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: CARD_SHADOW,
  },
  gradient: {
    paddingVertical: spacing.xs,
    backgroundColor: colors.glass.strongFill,
  },
});
