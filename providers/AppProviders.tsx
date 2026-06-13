import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';

import { AppToastProvider } from '@/components/ui/AppToast';
import { colors } from '@/constants/colors';
import { getConfiguredOffpayAttestationAdapter } from '@/lib/bootstrap/attestation';
import { PrivyAppProvider } from '@/lib/privy';
import { queryClient } from '@/lib/cache/query-client';
import { OffpayBootstrapProvider } from '@/providers/OffpayBootstrapProvider';
import { OffpayLaunchProvider } from '@/providers/OffpayLaunchProvider';

type AppProvidersRuntime = 'full' | 'lock';

interface AppProvidersProps {
  children: React.ReactNode;
  runtime?: AppProvidersRuntime;
}

/**
 * Application-level providers wrapper.
 * Add new providers here (auth, theme, etc.) to keep the root layout clean.
 */
const offpayAttestationAdapter = getConfiguredOffpayAttestationAdapter();

export function AppProviders({
  children,
  runtime = 'full',
}: AppProvidersProps): React.JSX.Element {
  if (runtime === 'lock') {
    return (
      <SafeAreaProvider style={styles.provider}>
        <QueryClientProvider client={queryClient}>
          <AppToastProvider>{children}</AppToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={styles.provider}>
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <PrivyAppProvider>
            <OffpayBootstrapProvider attestationAdapter={offpayAttestationAdapter}>
              <OffpayLaunchProvider>{children}</OffpayLaunchProvider>
            </OffpayBootstrapProvider>
          </PrivyAppProvider>
        </AppToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  provider: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: colors.backgroundGradient.base,
  },
});
