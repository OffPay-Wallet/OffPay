export type HomeDisplayCacheStatus = 'idle' | 'pending' | 'hit' | 'miss';
export type HomeFallbackDeadlineStatus = 'idle' | 'pending' | 'elapsed';

export function shouldOpenHomeSnapshotFallbackGate({
  canCoordinate,
  canUseNetwork,
  isNetworkAccessSuspended,
  fallbackGateOpen,
  hasDashboardData,
  displayCacheStatus,
  fallbackDeadlineStatus,
}: {
  canCoordinate: boolean;
  canUseNetwork: boolean;
  isNetworkAccessSuspended: boolean;
  fallbackGateOpen: boolean;
  hasDashboardData: boolean;
  displayCacheStatus: HomeDisplayCacheStatus;
  fallbackDeadlineStatus: HomeFallbackDeadlineStatus;
}): boolean {
  if (!canCoordinate || !canUseNetwork || isNetworkAccessSuspended) return false;
  if (fallbackGateOpen || hasDashboardData) return false;
  if (fallbackDeadlineStatus !== 'elapsed') return false;
  return displayCacheStatus !== 'hit';
}

export function shouldWaitForDashboardData({
  waitForDashboard,
  dashboardFetching,
}: {
  waitForDashboard: boolean;
  dashboardFetching: boolean;
}): boolean {
  return waitForDashboard && dashboardFetching;
}
