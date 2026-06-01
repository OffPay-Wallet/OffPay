import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

interface SettingsSectionCardProps {
  children: React.ReactNode;
}

export function SettingsSectionCard({ children }: SettingsSectionCardProps): React.JSX.Element {
  const rows = React.Children.toArray(children);

  return (
    <View style={styles.shell}>
      {rows.map((row, index) => (
        <React.Fragment key={`settings-row-${index}`}>
          {row}
          {index < rows.length - 1 ? <View style={styles.divider} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.brand.whiteStream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surface.backgroundAlt,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing['4xl'],
    backgroundColor: colors.surface.backgroundAlt,
  },
});
