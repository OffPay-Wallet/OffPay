import { shouldSyncCommittedTabVisual } from '@/components/navigation/tab-bar-state';

describe('tab bar navigation visual state', () => {
  it('syncs to committed navigation when there is no pending press', () => {
    expect(shouldSyncCommittedTabVisual(null, 3)).toBe(true);
  });

  it('settles once the requested tab commits', () => {
    expect(shouldSyncCommittedTabVisual(3, 3)).toBe(true);
  });

  it('keeps the latest optimistic target while an earlier route commits', () => {
    expect(shouldSyncCommittedTabVisual(6, 3)).toBe(false);
  });
});
