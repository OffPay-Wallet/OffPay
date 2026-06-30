/**
 * Privy SDK configuration.
 *
 * Reads the public app ID + client ID from `EXPO_PUBLIC_PRIVY_*` env vars
 * (set in `.env`) and exposes typed accessors. Missing values are allowed
 * in dev/test only; production-like builds must mount the Privy provider
 * so embedded-wallet signing cannot silently disappear.
 *
 * Reference: https://docs.privy.io/basics/react-native/setup
 */

const RAW_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim();
const RAW_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim();

export const MISSING_PRIVY_ENVIRONMENT_MESSAGE =
  'Privy is not configured. Set EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID before shipping this build.';

export interface PrivyEnvironment {
  appId: string;
  clientId: string;
}

/**
 * Returns the Privy environment when both `EXPO_PUBLIC_PRIVY_APP_ID`
 * and `EXPO_PUBLIC_PRIVY_CLIENT_ID` are configured. Returns `null`
 * otherwise; callers decide whether that is acceptable for the runtime.
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
    throw new Error(MISSING_PRIVY_ENVIRONMENT_MESSAGE);
  }
  return environment;
}

export function shouldRequirePrivyEnvironment(): boolean {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  const devRuntime = typeof __DEV__ !== 'undefined' && __DEV__;

  return !devRuntime && nodeEnv !== 'test';
}

/**
 * Whether the app has enough config to mount the Privy provider tree.
 */
export function isPrivyConfigured(): boolean {
  return getPrivyEnvironment() != null;
}
