import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';

export type LocalNotificationVariant = 'success' | 'error' | 'warning' | 'info';

export interface LocalNotification {
  id: string;
  title: string;
  message: string;
  variant: LocalNotificationVariant;
  createdAt: number;
  read: boolean;
}

interface NotificationState {
  notifications: LocalNotification[];
  unreadCount: number;
  addNotification: (
    notification: Omit<LocalNotification, 'id' | 'createdAt' | 'read'> & {
      id?: string;
      createdAt?: number;
    },
  ) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

const NOTIFICATION_DEDUPE_WINDOW_MS = 4000;
const MAX_NOTIFICATION_TITLE_CHARS = 34;
const MAX_NOTIFICATION_MESSAGE_CHARS = 58;

function createNotificationId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function unreadCount(notifications: readonly LocalNotification[]): number {
  return notifications.reduce((total, notification) => total + (notification.read ? 0 : 1), 0);
}

function compactNotificationText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isOfflineSlotSetupNotification(notification: Pick<LocalNotification, 'id' | 'title'>) {
  return (
    notification.id.startsWith('offline-slots-setup-') ||
    notification.title === 'Slots preparing' ||
    notification.title === 'Slots finalizing' ||
    notification.title === 'Offline slots ready'
  );
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: [],
      unreadCount: 0,
      addNotification: (notification) =>
        set((state) => {
          const title = compactNotificationText(notification.title, MAX_NOTIFICATION_TITLE_CHARS);
          const message = compactNotificationText(
            notification.message,
            MAX_NOTIFICATION_MESSAGE_CHARS,
          );
          const createdAt = notification.createdAt ?? Date.now();
          const duplicate = state.notifications.find(
            (item) =>
              item.title === title &&
              item.message === message &&
              item.variant === notification.variant &&
              Math.abs(createdAt - item.createdAt) < NOTIFICATION_DEDUPE_WINDOW_MS,
          );

          if (duplicate != null) {
            return state;
          }

          const nextNotification: LocalNotification = {
            id: notification.id ?? createNotificationId(),
            title,
            message,
            variant: notification.variant,
            createdAt,
            read: false,
          };
          const replacesSlotSetup = isOfflineSlotSetupNotification(nextNotification);
          const notifications = [
            nextNotification,
            ...state.notifications.filter(
              (item) =>
                item.id !== nextNotification.id &&
                (!replacesSlotSetup || !isOfflineSlotSetupNotification(item)),
            ),
          ].slice(0, 50);

          return {
            notifications,
            unreadCount: unreadCount(notifications),
          };
        }),
      markAllRead: () =>
        set((state) => {
          const notifications = state.notifications.map((notification) => ({
            ...notification,
            read: true,
          }));
          return { notifications, unreadCount: 0 };
        }),
      removeNotification: (id) =>
        set((state) => {
          const notifications = state.notifications.filter(
            (notification) => notification.id !== id,
          );
          return { notifications, unreadCount: unreadCount(notifications) };
        }),
      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),
    }),
    {
      name: 'offpay-local-notifications',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);
