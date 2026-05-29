/**
 * Privy SDK configuration.
 *
 * Reads the public app ID + client ID from `EXPO_PUBLIC_PRIVY_*` env vars
 * (set in `.env`) and exposes a small typed accessor so the rest of the
 * app can opt out of the Privy provider when keys are missing — useful
 * for early local builds where Privy hasn't been provisioned yet.
 *
 * Reference: https://docs.privy.io/basics/react-native/setup
 */

const RAW_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim();
const RAW_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim();

export interface PrivyEnvironment {
  appId: string;
  clientId: string;
}

/**
 * Returns the Privy environment when both `EXPO_PUBLIC_PRIVY_APP_ID`
 * and `EXPO_PUBLIC_PRIVY_CLIENT_ID` are configured. Returns `null`
 * otherwise so the app can render without the provider tree.
 */
export function getPrivyEnvironment(): PrivyEnvironment | null {
  if (
    RAW_APP_ID == null ||
    RAW_APP_ID.length === 0 ||
    RAW_CLIENT_ID == null ||
    RAW_CLIENT_ID.length === 0
  ) {
    return null;
  }

  return {
    appId: RAW_APP_ID,
    clientId: RAW_CLIENT_ID,
  };
}

/** Throws when Privy env is missing — call from sites that require it. */
export function getRequiredPrivyEnvironment(): PrivyEnvironment {
  const environment = getPrivyEnvironment();
  if (environment == null) {
    throw new Error(
      'Privy is not configured. Set EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID in `.env` and restart the bundler.',
    );
  }
  return environment;
}

/**
 * Whether the app should mount the Privy provider tree at all.
 *
 * Wallet-store consumers don't need Privy by default — only the
 * onboarding social and passkey CTAs do — so the provider is gated on
 * having real env values rather than crashing on an empty App ID.
 */
export function isPrivyConfigured(): boolean {
  return getPrivyEnvironment() != null;
}
