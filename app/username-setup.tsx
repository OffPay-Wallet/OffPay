import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UsernameSetupForm } from '@/components/features/onboarding/username-setup-form';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { useAppStore } from '@/store/app';

function getSource(value: string | string[] | undefined): 'accounts' | 'onboarding' {
  const source = Array.isArray(value) ? value[0] : value;
  return source === 'accounts' ? 'accounts' : 'onboarding';
}

export default function UsernameSetupScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ source?: string | string[] }>();
  const username = useAppStore((state) => state.username);
  const setHasOnboarded = useAppStore((state) => state.setHasOnboarded);
  const setUsername = useAppStore((state) => state.setUsername);
  const source = getSource(params.source);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback((nextUsername: string): void => {
    if (submitting) return;
    setSubmitting(true);
    setUsername(nextUsername);

    requestAnimationFrame(() => {
      if (source === 'accounts') {
        router.dismissTo('/accounts');
        return;
      }

      setHasOnboarded(true);
      router.replace('/(tabs)');
    });
  }, [setHasOnboarded, setUsername, source, submitting]);

  const handleBack = useCallback((): void => {
    if (submitting) return;
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/onboarding');
  }, [submitting]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing['3xl'],
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic"
    >
      <UsernameSetupForm
        initialUsername={username}
        onSubmit={handleSubmit}
        onBack={handleBack}
        submitting={submitting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    // Flat frosty surface — matches the rest of the onboarding flow
    // (welcome → security-setup → create-wallet → username-setup).
    // No gradient, no shadow.
    backgroundColor: colors.brand.iceBlue,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing['3xl'],
  },
});
