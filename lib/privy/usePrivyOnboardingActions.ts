/**
 * Bridge between OffPay's onboarding screen and Privy's auth hooks.
 *
 * Returns a single, low-friction surface for the three onboarding
 * CTAs: Google, X (Twitter), and passkey signup. Each handler
 * tracks its own busy state so the UI can disable just the active
 * button while another flow is running.
 *
 * Error policy:
 *  - User cancellations resolve as `{ outcome: 'cancelled' }` and are
 *    silent at the UI layer (no toast).
 *  - Real failures resolve as `{ outcome: 'failed', error }` so the UI
 *    can decide which surface to use (toast, inline message, etc.).
 *  - Successful sign-ins resolve as `{ outcome: 'success' }`. Privy
 *    auto-creates the embedded Solana wallet via the provider config.
 *
 * Reference:
 *  - OAuth: https://docs.privy.io/authentication/user-authentication/login-methods/oauth
 *  - Passkey: https://docs.privy.io/basics/react-native/advanced/setup-passkeys
 */
import { useCallback, useState } from 'react';
import { useLoginWithOAuth, usePrivy } from '@privy-io/expo';
import { useSignupWithPasskey } from '@privy-io/expo/passkey';
import * as Linking from 'expo-linking';

import { isPrivyConfigured } from './config';
import { classifyPrivyError, type ClassifiedPrivyError } from './errors';

/**
 * Passkey relying-party URL.
 *
 * Must point at a domain that serves a Digital Asset Links file
 * matching the Android package + signing certificate. The file must
 * include both `delegate_permission/common.handle_all_urls` and
 * `delegate_permission/common.get_login_creds`; the latter is what
 * Android Credential Manager uses for passkeys. OffPay serves this
 * file directly from `https://www.offpay.app/.well-known/assetlinks.json`;
 * the bare domain redirects, so the relying party must use `www`.
 */
const PRIVY_RELYING_PARTY = 'https://www.offpay.app';
const OAUTH_REDIRECT_PATH = '/oauth/callback';

export type PrivyOnboardingProvider = 'google' | 'x' | 'passkey';
type PrivyOAuthProvider = 'google' | 'twitter';
type PrivyLinkedAccountType = 'google_oauth' | 'twitter_oauth' | 'passkey';

type LinkedAccountCandidate = {
  type?: unknown;
};

type PrivyUserCandidate = {
  linked_accounts?: unknown;
};

/**
 * Discriminated outcome for every onboarding action. Cancellation is
 * a first-class state so the UI can suppress error toasts when the
 * user backs out of a sheet, while still distinguishing it from a
 * successful sign-in.
 */
export type PrivyOnboardingOutcome =
  | { outcome: 'success' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; error: ClassifiedPrivyError };

export interface PrivyOnboardingActions {
  /** Whether the Privy provider is mounted and the hooks can be used. */
  isAvailable: boolean;
  /** Which provider is currently running, if any. */
  busyProvider: PrivyOnboardingProvider | null;
  /** Last classified error, kept for inline messages. Cleared on next run. */
  lastError: ClassifiedPrivyError | null;
  /** Sign in via Google OAuth. */
  loginWithGoogle: () => Promise<PrivyOnboardingOutcome>;
  /** Sign in via X (Twitter) OAuth. */
  loginWithX: () => Promise<PrivyOnboardingOutcome>;
  /**
   * Create a new Privy user with a passkey from the onboarding CTA.
   * If the current Privy session is already authenticated with a
   * passkey, it is reused. Otherwise stale sessions are cleared before
   * registration starts.
   */
  loginOrSignupWithPasskey: () => Promise<PrivyOnboardingOutcome>;
}

function getOAuthLinkedAccountType(provider: PrivyOAuthProvider): PrivyLinkedAccountType {
  return provider === 'google' ? 'google_oauth' : 'twitter_oauth';
}

function hasLinkedAccountType(user: unknown, type: PrivyLinkedAccountType): boolean {
  if (user == null || typeof user !== 'object') return false;

  const linkedAccounts = (user as PrivyUserCandidate).linked_accounts;
  if (!Array.isArray(linkedAccounts)) return false;

  return linkedAccounts.some((account) => {
    if (account == null || typeof account !== 'object') return false;
    return (account as LinkedAccountCandidate).type === type;
  });
}

function readLinkedAccountTypes(user: unknown): string[] {
  if (user == null || typeof user !== 'object') return [];

  const linkedAccounts = (user as PrivyUserCandidate).linked_accounts;
  if (!Array.isArray(linkedAccounts)) return [];

  return linkedAccounts.flatMap((account): string[] => {
    if (account == null || typeof account !== 'object') return [];
    const type = (account as LinkedAccountCandidate).type;
    return typeof type === 'string' ? [type] : [];
  });
}

export function usePrivyOnboardingActions(): PrivyOnboardingActions {
  // Privy hooks must always be called — bail out at the result
  // boundary instead, otherwise the rules-of-hooks would break across
  // configured/unconfigured renders.
  const { user: existingUser, logout } = usePrivy();
  const oauthFlow = useLoginWithOAuth();
  const passkeySignup = useSignupWithPasskey();

  const [busyProvider, setBusyProvider] = useState<PrivyOnboardingProvider | null>(null);
  const [lastError, setLastError] = useState<ClassifiedPrivyError | null>(null);

  const runOAuth = useCallback(
    async (
      provider: PrivyOAuthProvider,
      tag: PrivyOnboardingProvider,
    ): Promise<PrivyOnboardingOutcome> => {
      if (busyProvider != null) {
        return { outcome: 'cancelled' };
      }

      setBusyProvider(tag);
      setLastError(null);

      const loginWithSelectedProvider = async (): Promise<PrivyOnboardingOutcome> => {
        const resolvedRedirectUrl = Linking.createURL(OAUTH_REDIRECT_PATH);

        if (__DEV__) {
          console.info('[PrivyOAuth] start', {
            provider,
            redirectUri: OAUTH_REDIRECT_PATH,
            resolvedRedirectUrl,
          });
        }

        const user = await oauthFlow.login({
          provider,
          redirectUri: OAUTH_REDIRECT_PATH,
        });

        if (user == null) {
          throw new Error('Privy OAuth completed without returning a user.');
        }

        if (__DEV__) {
          console.info('[PrivyOAuth] success', {
            provider,
            userId: user.id,
          });
        }

        return { outcome: 'success' };
      };

      try {
        if (existingUser != null) {
          const requestedAccountType = getOAuthLinkedAccountType(provider);
          if (hasLinkedAccountType(existingUser, requestedAccountType)) {
            if (__DEV__) {
              console.info('[PrivyOAuth] existing session', {
                provider,
                userId: existingUser.id,
                linkedAccountTypes: readLinkedAccountTypes(existingUser),
              });
            }

            return { outcome: 'success' };
          }

          if (__DEV__) {
            console.info('[PrivyOAuth] switching existing session', {
              provider,
              userId: existingUser.id,
              linkedAccountTypes: readLinkedAccountTypes(existingUser),
            });
          }

          await logout();
        }

        return await loginWithSelectedProvider();
      } catch (error: unknown) {
        const code =
          error != null &&
          typeof error === 'object' &&
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined;

        if (code === 'attempted_login_with_oauth_while_already_logged_in') {
          const requestedAccountType = getOAuthLinkedAccountType(provider);
          if (hasLinkedAccountType(existingUser, requestedAccountType)) {
            if (__DEV__) {
              console.info('[PrivyOAuth] continuing matching existing session', {
                provider,
                linkedAccountTypes: readLinkedAccountTypes(existingUser),
              });
            }

            return { outcome: 'success' };
          }

          if (__DEV__) {
            console.info('[PrivyOAuth] retrying after stale existing session', {
              provider,
              linkedAccountTypes: readLinkedAccountTypes(existingUser),
            });
          }

          try {
            await logout();
            return await loginWithSelectedProvider();
          } catch (retryError: unknown) {
            const classified = classifyPrivyError(retryError);
            if (__DEV__) {
              console.info('[PrivyOAuth] failed', {
                provider,
                code: classified.code,
                kind: classified.kind,
                message: classified.message,
                rawMessage:
                  retryError instanceof Error ? retryError.message : String(retryError),
              });
            }

            if (classified.kind === 'cancelled') {
              return { outcome: 'cancelled' };
            }
            setLastError(classified);
            return { outcome: 'failed', error: classified };
          }
        }

        const classified = classifyPrivyError(error);
        if (__DEV__) {
          console.info('[PrivyOAuth] failed', {
            provider,
            code: classified.code,
            kind: classified.kind,
            message: classified.message,
            rawMessage:
              error instanceof Error ? error.message : String(error),
          });
        }

        if (classified.kind === 'cancelled') {
          return { outcome: 'cancelled' };
        }
        setLastError(classified);
        return { outcome: 'failed', error: classified };
      } finally {
        setBusyProvider(null);
      }
    },
    [busyProvider, existingUser, logout, oauthFlow],
  );

  const loginWithGoogle = useCallback(
    async (): Promise<PrivyOnboardingOutcome> => runOAuth('google', 'google'),
    [runOAuth],
  );

  const loginWithX = useCallback(
    async (): Promise<PrivyOnboardingOutcome> => runOAuth('twitter', 'x'),
    [runOAuth],
  );

  const loginOrSignupWithPasskey = useCallback(
    async (): Promise<PrivyOnboardingOutcome> => {
      if (busyProvider != null) {
        return { outcome: 'cancelled' };
      }

      setBusyProvider('passkey');
      setLastError(null);

      try {
        if (existingUser != null) {
          if (!hasLinkedAccountType(existingUser, 'passkey')) {
            if (__DEV__) {
              console.info('[PrivyPasskey] switching existing session', {
                userId: existingUser.id,
                linkedAccountTypes: readLinkedAccountTypes(existingUser),
              });
            }

            await logout();
          } else {
            if (__DEV__) {
              console.info('[PrivyPasskey] existing session', {
                userId: existingUser.id,
                linkedAccountTypes: readLinkedAccountTypes(existingUser),
              });
            }

            return { outcome: 'success' };
          }
        }

        if (__DEV__) {
          console.info('[PrivyPasskey] signup start', {
            relyingParty: PRIVY_RELYING_PARTY,
          });
        }

        await passkeySignup.signupWithPasskey({ relyingParty: PRIVY_RELYING_PARTY });

        if (__DEV__) {
          console.info('[PrivyPasskey] signup success');
        }

        return { outcome: 'success' };
      } catch (signupError: unknown) {
        const signupClassified = classifyPrivyError(signupError);
        if (__DEV__) {
          console.info('[PrivyPasskey] failed', {
            code: signupClassified.code,
            kind: signupClassified.kind,
            message: signupClassified.message,
            rawMessage: signupError instanceof Error ? signupError.message : String(signupError),
          });
        }

        if (signupClassified.kind === 'cancelled') {
          return { outcome: 'cancelled' };
        }
        setLastError(signupClassified);
        return { outcome: 'failed', error: signupClassified };
      } finally {
        setBusyProvider(null);
      }
    },
    [busyProvider, existingUser, logout, passkeySignup],
  );

  return {
    isAvailable: isPrivyConfigured(),
    busyProvider,
    lastError,
    loginWithGoogle,
    loginWithX,
    loginOrSignupWithPasskey,
  };
}
