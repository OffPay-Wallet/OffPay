import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';

interface ModalBackdropScrimProps {
  opacity?: number;
}

export function ModalBackdropScrim({ opacity = 0.78 }: ModalBackdropScrimProps): React.JSX.Element {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.scrim,
        { backgroundColor: `rgba(0, 2, 5, ${opacity})` },
      ]}
    >
      <View style={styles.softFocus} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: colors.surface.background,
  },
  softFocus: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backgroundGradient.blobBlue,
  },
});
