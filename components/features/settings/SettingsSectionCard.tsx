import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

interface SettingsSectionCardProps {
  children: React.ReactNode;
  /** Divider inset from the left edge — defaults to settings-row icon alignment. */
  dividerInset?: number;
}

export function SettingsSectionCard({
  children,
  dividerInset,
}: SettingsSectionCardProps): React.JSX.Element {
  const rows = React.Children.toArray(children);

  return (
    <View style={styles.shell}>
      {rows.map((row, index) => (
        <React.Fragment key={`settings-row-${index}`}>
          {row}
          {index < rows.length - 1 ? (
            <View
              style={[
                styles.divider,
                dividerInset != null ? { marginLeft: dividerInset } : undefined,
              ]}
            />
          ) : null}
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
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 10px 22px rgba(0, 0, 0, 0.34)',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing['4xl'],
    backgroundColor: colors.glass.rimSubtle,
  },
});
