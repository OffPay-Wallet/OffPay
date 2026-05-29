import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@/constants/colors';

// `GradientBackground` is rendered on most screens and never receives
// props. Memoising the component lets React skip re-rendering the
// `<LinearGradient>` tree on every parent update; the static color stops
// trigger a single mount and stay alive for the life of the screen.
//
// Recipe: a calm top-to-bottom Arctic Mist fade. Saturated arctic cyan
// holds across the upper field, eases through the softer arctic tint and
// frost, then resolves to clear snow at the bottom where content sheets,
// lists, and the tab bar sit. Vertical (not diagonal) and monotonic — it
// never loops back to saturated cyan — so foreground glass stays readable
// and the screen reads quiet rather than busy. All stops are existing
// palette tokens.
export const GradientBackground = memo(function GradientBackground(): React.JSX.Element {
  return (
    <View style={styles.container} pointerEvents="none">
      <LinearGradient
        colors={[
          colors.brand.azureCyan,
          colors.surface.backgroundAlt,
          colors.brand.iceBlue,
          colors.brand.whiteStream,
        ]}
        locations={[0, 0.45, 0.72, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
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
