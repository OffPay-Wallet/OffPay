export function shouldSyncCommittedTabVisual(
  pendingOriginalIndex: number | null,
  committedOriginalIndex: number,
): boolean {
  return pendingOriginalIndex == null || pendingOriginalIndex === committedOriginalIndex;
}
