/**
 * Privy auth error classification.
 *
 * Privy throws a small family of error types from `@privy-io/expo`:
 *  - `PrivyClientError` — client-side categorised failure with a
 *    machine-readable `code`. Cancellation, "no passkey found", and
 *    OAuth provider errors all surface here.
 *  - `PrivyApiError` — server-side error with a `code` + HTTP status.
 *  - Plain `Error` — anything else (network blips, native bridge
 *    rejections from `react-native-passkeys`, dismissed Custom Tabs
 *    on Android via `expo-web-browser`).
 *
 * The onboarding UX needs to:
 *   1. Stay silent when the user cancels (no error toast on a
 *      dismissed sheet).
 *   2. Show an actionable message when the auth genuinely failed.
 *   3. Distinguish "passkey not yet registered" from a hard error so
 *      the hook can fall back to signup transparently.
 */
import { PrivyApiError, PrivyClientError } from '@privy-io/expo';

export type PrivyAuthFailure =
  | 'cancelled'
  | 'no-passkey'
  | 'passkey-creation-failed'
  | 'oauth-failed'
  | 'session-expired'
  | 'configuration-error'
  | 'network-error'
  | 'rate-limited'
  | 'unknown';

export interface ClassifiedPrivyError {
  /** Stable category — drives UX (silent vs. toast) and routing. */
  kind: PrivyAuthFailure;
  /** Privy's machine-readable code, when available. */
  code?: string;
  /** Sanitised, user-friendly message. Never echoes internal stack data. */
  message: string;
  /** Whether the surface should suppress the toast (true for cancel). */
  silent: boolean;
}

/**
 * `react-native-passkeys` rejections + `expo-web-browser` dismissals
 * surface as plain `Error`s with a small set of recognisable
 * substrings. Match against them before falling back to "unknown".
 */
const CANCEL_HINT_PATTERNS = [
  /user(?:\s|_)?cancel/i,
  /\bcancel(?:l?ed)?\b/i,
  /\bdismiss(?:ed)?\b/i,
  /not\s*allowed/i,
  /aborted/i,
  /closed by the user/i,
  /no result/i,
] as const;

const NETWORK_HINT_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /timeout/i,
  /timed out/i,
  /econn/i,
] as const;

const CONFIGURATION_HINT_PATTERNS = [
  /redirect url scheme is not allowed/i,
  /app url scheme is not registered/i,
  /url scheme is not registered/i,
  /^NotConfigured$/i,
  /digital asset links/i,
  /assetlinks/i,
  /get_login_creds/i,
  /credential provider configuration/i,
] as const;

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

function readErrorCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

/** Returns `true` for Privy/native error patterns that mean "user dismissed". */
function isCancellation(error: unknown, message: string): boolean {
  const code = readErrorCode(error) ?? '';

  if (
    code === 'mfa_canceled' ||
    code === 'farcaster_polling_canceled' ||
    code.endsWith('_was_cancelled_by_user')
  ) {
    return true;
  }

  return CANCEL_HINT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Classifies any thrown value from a Privy auth call into the small
 * `PrivyAuthFailure` taxonomy. Always returns a value — never throws.
 */
export function classifyPrivyError(error: unknown): ClassifiedPrivyError {
  const message = readErrorMessage(error);
  const code = readErrorCode(error);

  if (CONFIGURATION_HINT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      kind: 'configuration-error',
      code,
      message: 'Sign-in is misconfigured for this build. Contact support.',
      silent: false,
    };
  }

  if (isCancellation(error, message)) {
    return {
      kind: 'cancelled',
      code,
      message: 'Sign-in cancelled.',
      silent: true,
    };
  }

  if (error instanceof PrivyClientError) {
    switch (error.code) {
      case 'no_passkey_found_for_challenge':
        return {
          kind: 'no-passkey',
          code: error.code,
          message: 'No passkey found on this device. Set up a new one to continue.',
          silent: true,
        };
      case 'failed_to_create_passkey':
      case 'invalid_passkey_response':
        return {
          kind: 'passkey-creation-failed',
          code: error.code,
          message:
            'We could not register a passkey on this device. Try again, or pick another sign-in option.',
          silent: false,
        };
      case 'oauth_session_failed':
      case 'oauth_session_timeout':
      case 'failed_to_complete_login_with_oauth':
      case 'failed_to_complete_link_with_oauth':
      case 'login_with_oauth_returned_with_invalid_credentials':
        return {
          kind: 'oauth-failed',
          code: error.code,
          message: 'Sign-in could not be completed. Please try again.',
          silent: false,
        };
      case 'configuration_error':
      case 'invalid_native_app_id':
      case 'unsupported_chain_type':
        return {
          kind: 'configuration-error',
          code: error.code,
          message: 'Sign-in is misconfigured for this build. Contact support.',
          silent: false,
        };
      case 'pkce_state_code_mismatch':
        return {
          kind: 'session-expired',
          code: error.code,
          message: 'Sign-in expired. Try again.',
          silent: false,
        };
      default:
        return {
          kind: 'unknown',
          code: error.code,
          message: 'Sign-in failed. Please try again.',
          silent: false,
        };
    }
  }

  if (error instanceof PrivyApiError) {
    if (error.code === 'invalid_credentials' && /invalid request/i.test(message)) {
      return {
        kind: 'configuration-error',
        code: error.code,
        message: 'Passkey sign-in is misconfigured for this build. Contact support.',
        silent: false,
      };
    }

    if (error.status === 429) {
      return {
        kind: 'rate-limited',
        code: error.code,
        message: 'Too many attempts. Please wait a moment and try again.',
        silent: false,
      };
    }
    if (error.status >= 500) {
      return {
        kind: 'network-error',
        code: error.code,
        message: 'Privy is unreachable right now. Please try again shortly.',
        silent: false,
      };
    }
    return {
      kind: 'unknown',
      code: error.code,
      message: 'Sign-in failed. Please try again.',
      silent: false,
    };
  }

  if (NETWORK_HINT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      kind: 'network-error',
      code,
      message: 'No network connection. Please check your internet and try again.',
      silent: false,
    };
  }

  return {
    kind: 'unknown',
    code,
    message: 'Sign-in failed. Please try again.',
    silent: false,
  };
}
