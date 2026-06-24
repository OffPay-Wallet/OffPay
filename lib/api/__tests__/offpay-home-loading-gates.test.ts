import {
  shouldOpenHomeSnapshotFallbackGate,
  shouldWaitForDashboardData,
} from '@/lib/api/offpay-home-loading-gates';

describe('OffPay home loading gates', () => {
  it('opens the snapshot fallback after the deadline even if display cache is still pending', () => {
    expect(
      shouldOpenHomeSnapshotFallbackGate({
        canCoordinate: true,
        canUseNetwork: true,
        isNetworkAccessSuspended: false,
        fallbackGateOpen: false,
        hasDashboardData: false,
        displayCacheStatus: 'pending',
        fallbackDeadlineStatus: 'elapsed',
      }),
    ).toBe(true);
  });

  it('keeps the snapshot fallback closed when display cache already hit', () => {
    expect(
      shouldOpenHomeSnapshotFallbackGate({
        canCoordinate: true,
        canUseNetwork: true,
        isNetworkAccessSuspended: false,
        fallbackGateOpen: false,
        hasDashboardData: false,
        displayCacheStatus: 'hit',
        fallbackDeadlineStatus: 'elapsed',
      }),
    ).toBe(false);
  });

  it('does not open the snapshot fallback before the deadline', () => {
    expect(
      shouldOpenHomeSnapshotFallbackGate({
        canCoordinate: true,
        canUseNetwork: true,
        isNetworkAccessSuspended: false,
        fallbackGateOpen: false,
        hasDashboardData: false,
        displayCacheStatus: 'miss',
        fallbackDeadlineStatus: 'pending',
      }),
    ).toBe(false);
  });

  it('allows home fallbacks to ignore an in-flight dashboard request', () => {
    expect(
      shouldWaitForDashboardData({
        waitForDashboard: false,
        dashboardFetching: true,
      }),
    ).toBe(false);
  });

  it('keeps dashboard waiting enabled for callers that request it', () => {
    expect(
      shouldWaitForDashboardData({
        waitForDashboard: true,
        dashboardFetching: true,
      }),
    ).toBe(true);
  });
});
