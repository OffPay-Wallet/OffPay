/**
 * Horizontal safe area only — apply `paddingTop` / `paddingBottom` from `useSafeAreaInsets` per screen.
 */
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { GradientBackground } from '@/components/ui/GradientBackground';

import type { Edge } from 'react-native-safe-area-context';

/** Horizontal insets only — top/bottom are applied per screen for predictable layouts. */
const ROOT_SAFE_AREA_EDGES: Edge[] = ['left', 'right'];

interface GlobalGradientShellProps {
  children: React.ReactNode;
}

export function GlobalGradientShell({ children }: GlobalGradientShellProps): React.JSX.Element {
  return (
    <View style={styles.screenFrame}>
      <GradientBackground />
      <SafeAreaView edges={ROOT_SAFE_AREA_EDGES} style={styles.screenContent}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenFrame: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: colors.backgroundGradient.base,
    overflow: 'hidden',
  },
  screenContent: {
    flex: 1,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
});
