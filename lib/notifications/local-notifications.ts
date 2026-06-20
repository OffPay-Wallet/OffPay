import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { beginAppLockSuppression } from '@/lib/wallet/app-lock-suppression';
import { useNotificationStore } from '@/store/notificationStore';

import type {
  OffpayDisplayTransactionType,
  OffpayUmbraWalletActivityType,
  OffpayRecentActivityView,
} from '@/lib/api/offpay-wallet-data';
import type { LocalNotificationVariant } from '@/store/notificationStore';

/**
 * Thin wrapper around `expo-notifications` so the rest of the app can
 * fire a local OS notification without coupling to the Expo module
 * directly. Wallet events are also mirrored into the in-app
 * notification center here so the bell UI does not depend on a toast
 * being shown or the OS notification permission being granted.
 */

type OffpayNotificationChannelType = OffpayDisplayTransactionType | 'privacy';

const ANDROID_TRANSACTION_CHANNELS: Record<
  OffpayNotificationChannelType | 'default',
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
  privacy: {
    id: 'offpay.transactions.privacy',
    name: 'Private payments',
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

function getTransactionChannelId(type: OffpayNotificationChannelType | null | undefined): string {
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

function getNotificationCenterVariant(
  type: OffpayNotificationChannelType | null | undefined,
): LocalNotificationVariant {
  return type === 'receive' ? 'success' : 'info';
}

function persistWalletTransactionNotificationToCenter(
  input: WalletTransactionNotificationInput,
): void {
  try {
    const notificationStore = useNotificationStore.getState();
    const alreadyPersisted = notificationStore.notifications.some(
      (notification) => notification.id === input.identifier,
    );

    if (alreadyPersisted) return;

    notificationStore.addNotification({
      id: input.identifier,
      title: input.title,
      message: input.body ?? '',
      variant: getNotificationCenterVariant(input.type),
    });
  } catch (error: unknown) {
    if (__DEV__) {
      console.warn('[local-notifications] notification center persist failed:', error);
    }
  }
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

function formatPrivatePaymentCount(count: number | null | undefined): string {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return 'private payment';
  }

  const normalized = Math.trunc(count);
  return normalized === 1 ? '1 private payment' : `${normalized} private payments`;
}

export function buildUmbraTransactionNotificationContent(input: {
  action: OffpayUmbraWalletActivityType;
  amountLabel?: string | null;
  claimedCount?: number | null;
  setupStatus?: 'ready' | 'submitted' | null;
}): {
  title: string;
  body: string | null;
} {
  const amount = input.amountLabel == null ? null : stripAmountSign(input.amountLabel);

  switch (input.action) {
    case 'setup':
      return {
        title: input.setupStatus === 'submitted' ? 'Umbra setup submitted' : 'Umbra vault ready',
        body: null,
      };
    case 'shield':
      return { title: amount == null ? 'Shielded funds' : `Shielded ${amount}`, body: null };
    case 'withdraw':
      return { title: amount == null ? 'Withdrew funds' : `Withdrew ${amount}`, body: null };
    case 'claim':
      return { title: `Claimed ${formatPrivatePaymentCount(input.claimedCount)}`, body: null };
    case 'private-p2p':
      return {
        title: amount == null ? 'Sent private payment' : `Sent private payment ${amount}`,
        body: null,
      };
    case 'repair':
      return { title: 'Umbra key repaired', body: null };
    default:
      return { title: 'Umbra updated', body: null };
  }
}

export function buildUmbraTransactionNotificationIdentifier(input: {
  network: string;
  action: OffpayUmbraWalletActivityType;
  signature?: string | null;
  fallbackId?: string | number | null;
}): string {
  const action = input.action === 'setup' ? 'setup' : input.action;
  return `umbra-${action}-${input.network}-${input.signature ?? input.fallbackId ?? 'unknown'}`;
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

  try {
    return await configurePromise;
  } catch (error) {
    configurePromise = null;
    throw error;
  }
}

async function ensurePermission(): Promise<boolean> {
  if (permissionPromise != null) return permissionPromise;

  permissionPromise = (async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false && current.status === Notifications.PermissionStatus.DENIED) {
      return false;
    }

    // The OS permission sheet can briefly background/inactivate the
    // app. Suppress app-lock while it is open so approving
    // notifications does not clear the unlocked wallet and leave the
    // root shell blank.
    const releaseAppLockSuppression = beginAppLockSuppression();
    try {
      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowSound: true,
          allowBadge: false,
        },
      });
      return requested.granted;
    } finally {
      releaseAppLockSuppression();
    }
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
  type?: OffpayNotificationChannelType;
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

export interface UmbraTransactionNotificationInput {
  /** Stable identifier so re-fires for the same transaction are de-duped. */
  identifier: string;
  action: OffpayUmbraWalletActivityType;
  amountLabel?: string | null;
  claimedCount?: number | null;
  setupStatus?: 'ready' | 'submitted' | null;
  signature?: string | null;
}

/**
 * Schedule a local OS notification for wallet transaction activity.
 *
 * Permission is normally requested during launch prewarm. This call
 * still guards the permission path so direct event triggers remain
 * safe if launch prewarm has not completed yet. Failures are silent;
 * a missing notification permission is not a hard error for the rest
 * of the app.
 */
export async function presentWalletTransactionNotification(
  input: WalletTransactionNotificationInput,
): Promise<void> {
  persistWalletTransactionNotificationToCenter(input);

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

export function presentUmbraTransactionNotification(
  input: UmbraTransactionNotificationInput,
): Promise<void> {
  const content = buildUmbraTransactionNotificationContent({
    action: input.action,
    amountLabel: input.amountLabel ?? null,
    claimedCount: input.claimedCount ?? null,
    setupStatus: input.setupStatus ?? null,
  });

  return presentWalletTransactionNotification({
    identifier: input.identifier,
    title: content.title,
    body: content.body,
    type: 'privacy',
    signature: input.signature,
  });
}

export function presentIncomingTransferNotification(
  input: IncomingTransferNotificationInput,
): Promise<void> {
  return presentWalletTransactionNotification({ ...input, type: 'receive' });
}

/**
 * Best-effort notification setup after first paint. Requesting the
 * permission here prevents the first send/receive/swap event from
 * paying for the OS permission prompt inline.
 */
export function prewarmWalletTransactionNotificationPermission(): void {
  void (async () => {
    await configureNotifications();
    await ensurePermission();
  })().catch(() => undefined);
}

export const prewarmIncomingTransferPermission = prewarmWalletTransactionNotificationPermission;
