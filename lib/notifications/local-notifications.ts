import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type {
  OffpayDisplayTransactionType,
  OffpayRecentActivityView,
} from '@/lib/api/offpay-wallet-data';

/**
 * Thin wrapper around `expo-notifications` so the rest of the app can
 * fire a local OS notification without coupling to the Expo module
 * directly. This is intentionally separate from the in-app toast and
 * notification-center stores: wallet activity should be allowed to
 * surface as an OS notification even when no toast is shown.
 */

const ANDROID_TRANSACTION_CHANNELS: Record<
  OffpayDisplayTransactionType | 'default',
  {
    id: string;
    name: string;
  }
> = {
  receive: {
    id: 'offpay.transactions.received',
    name: 'Received payments',
  },
  send: {
    id: 'offpay.transactions.sent',
    name: 'Sent payments',
  },
  swap: {
    id: 'offpay.transactions.swaps',
    name: 'Swaps',
  },
  default: {
    id: 'offpay.transactions',
    name: 'Transactions',
  },
};
const PRESENTED_NOTIFICATION_IDS_LIMIT = 200;

let configurePromise: Promise<void> | null = null;
let permissionPromise: Promise<boolean> | null = null;
const presentedNotificationIds = new Set<string>();

function stripAmountSign(value: string): string {
  return value.replace(/^[+-]\s*/, '').trim();
}

function getTransactionChannelId(type: OffpayDisplayTransactionType | null | undefined): string {
  return ANDROID_TRANSACTION_CHANNELS[type ?? 'default'].id;
}

function rememberPresentedNotificationId(identifier: string): boolean {
  if (presentedNotificationIds.has(identifier)) return false;
  presentedNotificationIds.add(identifier);
  while (presentedNotificationIds.size > PRESENTED_NOTIFICATION_IDS_LIMIT) {
    const oldest = presentedNotificationIds.values().next().value;
    if (oldest == null) break;
    presentedNotificationIds.delete(oldest);
  }

  return true;
}

export function buildWalletTransactionNotificationContent(
  activity: Pick<
    OffpayRecentActivityView,
    'amountLabel' | 'secondaryAmountLabel' | 'subtitle' | 'type'
  >,
): {
  title: string;
  body: string | null;
} {
  const primaryAmount = activity.amountLabel == null ? null : stripAmountSign(activity.amountLabel);
  if (activity.type === 'swap') {
    return {
      title: primaryAmount == null ? 'Swapped' : `Swapped ${primaryAmount}`,
      body: null,
    };
  }

  if (activity.type === 'receive') {
    return {
      title: primaryAmount == null ? 'Received' : `Received ${primaryAmount}`,
      body: null,
    };
  }

  return {
    title: primaryAmount == null ? 'Sent' : `Sent ${primaryAmount}`,
    body: null,
  };
}

async function configureNotifications(): Promise<void> {
  if (configurePromise != null) return configurePromise;

  configurePromise = (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Promise.all(
        Object.values(ANDROID_TRANSACTION_CHANNELS).map((channel) =>
          Notifications.setNotificationChannelAsync(channel.id, {
            name: channel.name,
            importance: Notifications.AndroidImportance.HIGH,
            showBadge: true,
            enableVibrate: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          }),
        ),
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
    if (current.canAskAgain === false && current.status === Notifications.PermissionStatus.DENIED) {
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
  body?: string | null;
}

export interface WalletTransactionNotificationInput {
  /** Stable identifier so re-fires for the same transaction are de-duped. */
  identifier: string;
  title: string;
  body?: string | null;
  type?: OffpayDisplayTransactionType;
  signature?: string | null;
}

export interface WalletTransactionEventNotificationInput {
  /** Stable identifier so re-fires for the same transaction are de-duped. */
  identifier: string;
  type: OffpayDisplayTransactionType;
  amountLabel?: string | null;
  secondaryAmountLabel?: string | null;
  signature?: string | null;
}

/**
 * Schedule a local OS notification for wallet transaction activity.
 *
 * Permission is requested lazily on first call. Failures are silent;
 * a missing notification permission is not a hard error for the rest
 * of the app.
 */
export async function presentWalletTransactionNotification(
  input: WalletTransactionNotificationInput,
): Promise<void> {
  try {
    await configureNotifications();
    const granted = await ensurePermission();
    if (!granted) return;
    if (!rememberPresentedNotificationId(input.identifier)) return;

    const data: Record<string, string> = {
      offpayNotificationType: 'wallet-transaction',
    };
    if (input.type != null) data.transactionType = input.type;
    if (input.signature != null) data.signature = input.signature;

    await Notifications.scheduleNotificationAsync({
      identifier: input.identifier,
      content: {
        title: input.title,
        body: input.body ?? null,
        sound: 'default',
        data,
        ...(Platform.OS === 'android' ? { channelId: getTransactionChannelId(input.type) } : {}),
      },
      // Fire immediately. `null` trigger is documented as
      // "deliver as soon as possible" by Expo.
      trigger: null,
    });
  } catch (error: unknown) {
    console.warn('[local-notifications] schedule failed:', error);
  }
}

export function presentWalletTransactionEventNotification(
  input: WalletTransactionEventNotificationInput,
): Promise<void> {
  const content = buildWalletTransactionNotificationContent({
    type: input.type,
    amountLabel: input.amountLabel ?? null,
    secondaryAmountLabel: input.secondaryAmountLabel ?? null,
    subtitle: '',
  });

  return presentWalletTransactionNotification({
    identifier: input.identifier,
    title: content.title,
    body: content.body,
    type: input.type,
    signature: input.signature,
  });
}

export function presentIncomingTransferNotification(
  input: IncomingTransferNotificationInput,
): Promise<void> {
  return presentWalletTransactionNotification({ ...input, type: 'receive' });
}

/**
 * Best-effort permission pre-warm during the splash window so the
 * first wallet-activity notification doesn't pay for the prompt
 * inline.
 */
export function prewarmWalletTransactionNotificationPermission(): void {
  void configureNotifications()
    .then(ensurePermission)
    .catch(() => undefined);
}

export const prewarmIncomingTransferPermission = prewarmWalletTransactionNotificationPermission;
