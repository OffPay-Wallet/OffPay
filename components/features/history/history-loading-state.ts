export interface HistoryLoadingStateInput {
  rowCount: number;
  itemRowCount: number;
  isInitialDataPending: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  visibleFillTarget?: number;
  maxWarmTopOffRows?: number;
}

export interface HistoryLoadingState {
  showInitialLoader: boolean;
  showWarmTopOffLoader: boolean;
  warmTopOffRowCount: number;
}

const DEFAULT_VISIBLE_FILL_TARGET = 8;
const DEFAULT_MAX_WARM_TOP_OFF_ROWS = 4;

export function getHistoryLoadingState({
  rowCount,
  itemRowCount,
  isInitialDataPending,
  isFetching,
  isFetchingNextPage,
  visibleFillTarget = DEFAULT_VISIBLE_FILL_TARGET,
  maxWarmTopOffRows = DEFAULT_MAX_WARM_TOP_OFF_ROWS,
}: HistoryLoadingStateInput): HistoryLoadingState {
  const showInitialLoader = rowCount === 0 && isInitialDataPending;
  const missingWarmRows = Math.max(0, visibleFillTarget - itemRowCount);
  const showWarmTopOffLoader =
    !showInitialLoader &&
    itemRowCount > 0 &&
    missingWarmRows > 0 &&
    isFetching &&
    !isFetchingNextPage;

  return {
    showInitialLoader,
    showWarmTopOffLoader,
    warmTopOffRowCount: showWarmTopOffLoader
      ? Math.max(1, Math.min(maxWarmTopOffRows, missingWarmRows))
      : 0,
  };
}
