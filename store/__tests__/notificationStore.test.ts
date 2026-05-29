import { useNotificationStore } from '@/store/notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
    });
  });

  it('dedupes identical notifications created by repeated event loops', () => {
    useNotificationStore.getState().addNotification({
      title: 'Unsupported token',
      message: 'USDC or USDT only.',
      variant: 'warning',
      createdAt: 1000,
    });
    useNotificationStore.getState().addNotification({
      title: 'Unsupported token',
      message: 'USDC or USDT only.',
      variant: 'warning',
      createdAt: 2000,
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });

  it('allows the same notification again after the dedupe window', () => {
    useNotificationStore.getState().addNotification({
      title: 'Unsupported token',
      message: 'USDC or USDT only.',
      variant: 'warning',
      createdAt: 1000,
    });
    useNotificationStore.getState().addNotification({
      title: 'Unsupported token',
      message: 'USDC or USDT only.',
      variant: 'warning',
      createdAt: 6000,
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(2);
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it('stores compact notification text for the modal rows', () => {
    useNotificationStore.getState().addNotification({
      title: 'A very long notification title that should not flood the modal row',
      message:
        'This is a very long notification message that should be shortened before it reaches the notification center UI.',
      variant: 'info',
      createdAt: 1000,
    });

    const [notification] = useNotificationStore.getState().notifications;
    expect(notification?.title).toBe('A very long notification title th…');
    expect(notification?.message).toBe(
      'This is a very long notification message that should be s…',
    );
  });

  it('replaces stale offline slot setup notifications', () => {
    useNotificationStore.getState().addNotification({
      title: 'Slots finalizing',
      message: '10 slots are still preparing.',
      variant: 'info',
      createdAt: 1000,
    });
    useNotificationStore.getState().addNotification({
      id: 'offline-slots-setup-devnet-wallet',
      title: 'Offline slots ready',
      message: '10/10 ready',
      variant: 'success',
      createdAt: 7000,
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]).toMatchObject({
      id: 'offline-slots-setup-devnet-wallet',
      title: 'Offline slots ready',
      message: '10/10 ready',
    });
  });

  it('removes one notification and recalculates unread count', () => {
    useNotificationStore.getState().addNotification({
      id: 'first',
      title: 'First',
      message: 'Ready.',
      variant: 'success',
      createdAt: 1000,
    });
    useNotificationStore.getState().addNotification({
      id: 'second',
      title: 'Second',
      message: 'Failed.',
      variant: 'error',
      createdAt: 2000,
    });

    useNotificationStore.getState().removeNotification('first');

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]?.id).toBe('second');
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });
});
