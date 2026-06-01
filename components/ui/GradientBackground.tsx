import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';

// `GradientBackground` is rendered on most screens and never receives
// props. Memoising the component lets React skip re-rendering the
// background on every parent update.
//
// Recipe: a plain solid dark base. Gloss is handled by foreground
// surfaces with borders and inset shadows, not background gradients.
export const GradientBackground = memo(function GradientBackground(): React.JSX.Element {
  return <View style={styles.container} pointerEvents="none" />;
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backgroundGradient.base,
    zIndex: 0,
  },
});
