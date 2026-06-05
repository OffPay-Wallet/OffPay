/**
 * Privy provider wrapper.
 *
 * Renders the Privy SDK provider when the env is configured, falls
 * back to the children alone when Privy is not yet provisioned. This
 * keeps the OffPay app bootable in environments where the Privy keys
 * are missing (CI, fresh clones, screenshot/test builds) without
 * crashing on a hard `appId` requirement.
 *
 * The Privy provider auto-creates a Solana embedded wallet on the
 * first login for users who don't already have one. We never
 * auto-create on Ethereum because OffPay is Solana-only today.
 *
 * Reference: https://docs.privy.io/basics/react-native/setup
 */
import { PrivyProvider } from '@privy-io/expo';
import type { ReactNode } from 'react';

import { getPrivyEnvironment } from './config';
import { PrivySolanaSigningBridge } from './PrivySolanaSigningBridge';

interface PrivyAppProviderProps {
  children: ReactNode;
}

export function PrivyAppProvider({ children }: PrivyAppProviderProps): React.JSX.Element {
  const environment = getPrivyEnvironment();

  if (environment == null) {
    if (__DEV__) {
      console.warn(
        '[Privy] EXPO_PUBLIC_PRIVY_APP_ID / EXPO_PUBLIC_PRIVY_CLIENT_ID missing — social and passkey login are disabled.',
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={environment.appId}
      clientId={environment.clientId}
      config={{
        embedded: {
          // Auto-provision a Solana embedded wallet on first login
          // for any user that doesn't already have one. This means a
          // social- or passkey-authenticated user lands in the app
          // with a usable Solana address with no extra prompts.
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <PrivySolanaSigningBridge />
      {children}
    </PrivyProvider>
  );
}
