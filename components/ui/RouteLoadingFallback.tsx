import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';

export function RouteLoadingFallback(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <LazyLoadingSpinner size={24} color={colors.text.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundGradient.base,
  },
});
