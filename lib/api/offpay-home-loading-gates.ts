export type HomeDisplayCacheStatus = 'idle' | 'pending' | 'hit' | 'miss';
export type HomeFallbackDeadlineStatus = 'idle' | 'pending' | 'elapsed';

export function shouldOpenHomeSnapshotFallbackGate({
  canCoordinate,
  canUseNetwork,
  isNetworkAccessSuspended,
  fallbackGateOpen,
  hasDashboardData,
  dashboardFetching,
  hasUsableTransactions,
  fallbackDeadlineStatus,
}: {
  canCoordinate: boolean;
  canUseNetwork: boolean;
  isNetworkAccessSuspended: boolean;
  fallbackGateOpen: boolean;
  hasDashboardData: boolean;
  dashboardFetching: boolean;
  hasUsableTransactions: boolean;
  displayCacheStatus: HomeDisplayCacheStatus;
  fallbackDeadlineStatus: HomeFallbackDeadlineStatus;
}): boolean {
  if (!canCoordinate || !canUseNetwork || isNetworkAccessSuspended) return false;
  if (fallbackGateOpen || hasDashboardData || dashboardFetching || hasUsableTransactions)
    return false;
  if (fallbackDeadlineStatus !== 'elapsed') return false;
  return true;
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

export function shouldEnableHomeForegroundFetch({
  canCoordinate,
  canUseNetwork,
  isNetworkAccessSuspended,
  fallbackGateOpen,
  hasDashboardData,
}: {
  canCoordinate: boolean;
  canUseNetwork: boolean;
  isNetworkAccessSuspended: boolean;
  fallbackGateOpen: boolean;
  hasDashboardData: boolean;
}): boolean {
  return (
    canCoordinate &&
    canUseNetwork &&
    !isNetworkAccessSuspended &&
    (fallbackGateOpen || hasDashboardData)
  );
}
