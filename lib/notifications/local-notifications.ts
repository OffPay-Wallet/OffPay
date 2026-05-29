import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Thin wrapper around `expo-notifications` so the rest of the app can
 * fire a local OS notification without coupling to the Expo module
 * directly. The wrapper also handles the foreground/background dedup
 * the in-app toaster relies on:
 *
 * - When the app is in the foreground, the toaster already paints the
 *   message in-product. We do not also fire a system notification.
 * - When the app is in the background, the toaster cannot reach the
 *   user; we schedule a local notification instead so the OS surfaces
 *   the deposit alert on the lock/home screen.
 */

const ANDROID_INCOMING_TRANSFER_CHANNEL_ID = 'offpay.incoming-transfers';
const ANDROID_INCOMING_TRANSFER_CHANNEL_NAME = 'Incoming transfers';

let configurePromise: Promise<void> | null = null;
let permissionPromise: Promise<boolean> | null = null;

async function configureNotifications(): Promise<void> {
  if (configurePromise != null) return configurePromise;

  configurePromise = (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // We never *need* the OS to surface a notification while the
        // user is actively viewing the app — the toaster already
        // does. Returning `false` here makes Expo skip the alert /
        // sound / badge for foreground events.
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(
        ANDROID_INCOMING_TRANSFER_CHANNEL_ID,
        {
          name: ANDROID_INCOMING_TRANSFER_CHANNEL_NAME,
          importance: Notifications.AndroidImportance.HIGH,
          showBadge: true,
          enableVibrate: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        },
      );
    }
  })();

  return configurePromise;
}

async function ensurePermission(): Promise<boolean> {
  if (permissionPromise != null) return permissionPromise;

  permissionPromise = (async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (
      current.canAskAgain === false &&
      current.status === Notifications.PermissionStatus.DENIED
    ) {
      return false;
    }
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowSound: true,
        allowBadge: false,
      },
    });
    return requested.granted;
  })();

  return permissionPromise;
}

export interface IncomingTransferNotificationInput {
  /** Stable identifier so re-fires for the same transfer are de-duped. */
  identifier: string;
  title: string;
  body: string;
}

/**
 * Schedule a local notification for an incoming transfer when the app
 * is currently backgrounded. Foreground events are ignored because the
 * in-app toaster already covers them.
 *
 * Permission is requested lazily on first call. Failures are silent;
 * a missing notification permission is not a hard error for the rest
 * of the app.
 */
export async function presentIncomingTransferNotification(
  input: IncomingTransferNotificationInput,
): Promise<void> {
  if (AppState.currentState === 'active') return;

  try {
    await configureNotifications();
    const granted = await ensurePermission();
    if (!granted) return;

    await Notifications.scheduleNotificationAsync({
      identifier: input.identifier,
      content: {
        title: input.title,
        body: input.body,
        sound: 'default',
        ...(Platform.OS === 'android'
          ? { channelId: ANDROID_INCOMING_TRANSFER_CHANNEL_ID }
          : {}),
      },
      // Fire immediately. `null` trigger is documented as
      // "deliver as soon as possible" by Expo.
      trigger: null,
    });
  } catch (error: unknown) {
    console.warn('[local-notifications] schedule failed:', error);
  }
}

/**
 * Best-effort permission pre-warm during the splash window so the
 * first incoming-transfer notification doesn't pay for the prompt
 * inline.
 */
export function prewarmIncomingTransferPermission(): void {
  void configureNotifications().then(ensurePermission).catch(() => undefined);
}
