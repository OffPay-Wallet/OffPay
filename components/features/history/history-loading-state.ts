export interface HistoryLoadingStateInput {
  rowCount: number;
  isInitialDataPending: boolean;
}

export interface HistoryLoadingState {
  showInitialLoader: boolean;
}

export function getHistoryLoadingState({
  rowCount,
  isInitialDataPending,
}: HistoryLoadingStateInput): HistoryLoadingState {
  return {
    showInitialLoader: rowCount === 0 && isInitialDataPending,
  };
}
