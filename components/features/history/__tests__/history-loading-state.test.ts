import { getHistoryLoadingState } from '@/components/features/history/history-loading-state';

describe('history loading state', () => {
  it('shows the full skeleton only when there are no rows and initial data is pending', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 0,
        isInitialDataPending: true,
      }),
    ).toEqual({
      showInitialLoader: true,
    });
  });

  it('keeps partial rows visible without adding top-off skeletons', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 6,
        isInitialDataPending: false,
      }),
    ).toEqual({
      showInitialLoader: false,
    });
  });

  it('does not replace existing rows with a full skeleton during a refresh', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 6,
        isInitialDataPending: true,
      }).showInitialLoader,
    ).toBe(false);
  });

  it('does not show the initial skeleton while paginating existing rows', () => {
    expect(
      getHistoryLoadingState({
        rowCount: 6,
        isInitialDataPending: false,
      }).showInitialLoader,
    ).toBe(false);
  });
});
