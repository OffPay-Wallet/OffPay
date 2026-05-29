import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@/constants/colors';

// `GradientBackground` is rendered on most screens and never receives
// props. Memoising the component lets React skip re-rendering the
// `<LinearGradient>` tree on every parent update; the static color stops
// trigger a single mount and stay alive for the life of the screen.
export const GradientBackground = memo(function GradientBackground(): React.JSX.Element {
  return (
    <View style={styles.container} pointerEvents="none">
      <LinearGradient
        colors={[
          colors.backgroundGradient.base,
          colors.backgroundGradient.blobTopSoft,
          colors.brand.whiteStream,
          colors.brand.iceBlue,
          colors.backgroundGradient.base,
        ]}
        locations={[0, 0.34, 0.58, 0.78, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backgroundGradient.base,
    zIndex: 0,
  },
});
