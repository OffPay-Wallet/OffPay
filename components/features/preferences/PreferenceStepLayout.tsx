import React from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/constants/spacing';

interface PreferenceStepLayoutProps {
  children: React.ReactNode;
}

/** Shared spacing for wallet mode, network, and other preference substeps. */
export function PreferenceStepLayout({
  children,
}: PreferenceStepLayoutProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.stack}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  stack: {
    gap: spacing.md,
  },
});
