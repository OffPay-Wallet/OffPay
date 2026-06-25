import { getHistoryLoadingState } from '@/components/features/history/history-loading-state';

describe('history loading state', () => {
  it('shows the full skeleton only when there are no rows and initial data is pending', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 0,
        itemRowCount: 0,
        isInitialDataPending: true,
        isFetching: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({
      showInitialLoader: true,
      showWarmTopOffLoader: false,
      warmTopOffRowCount: 0,
    });
  });

  it('keeps partial cached rows visible while topping off the first viewport', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 6,
        itemRowCount: 4,
        isInitialDataPending: false,
        isFetching: true,
        isFetchingNextPage: false,
      }),
    ).toEqual({
      showInitialLoader: false,
      showWarmTopOffLoader: true,
      warmTopOffRowCount: 4,
    });
  });

  it('does not replace existing rows with a full skeleton during a deep fetch', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 6,
        itemRowCount: 4,
        isInitialDataPending: true,
        isFetching: true,
        isFetchingNextPage: false,
      }).showInitialLoader,
    ).toBe(false);
  });

  it('does not show a top-off skeleton while fetching the next page', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 6,
        itemRowCount: 4,
        isInitialDataPending: false,
        isFetching: true,
        isFetchingNextPage: true,
      }).showWarmTopOffLoader,
    ).toBe(false);
  });
});
