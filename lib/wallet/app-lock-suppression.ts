const DEFAULT_SUPPRESSION_MS = 5 * 60_000;
const RELEASE_GRACE_MS = 1_200;

let activeSuppressionCount = 0;
let suppressedUntil = 0;

function normalizeSuppression(now = Date.now()): void {
  if (activeSuppressionCount > 0 && now >= suppressedUntil) {
    activeSuppressionCount = 0;
  }
}

export function beginAppLockSuppression(durationMs = DEFAULT_SUPPRESSION_MS): () => void {
  const now = Date.now();
  normalizeSuppression(now);

  activeSuppressionCount += 1;
  suppressedUntil = Math.max(suppressedUntil, now + durationMs);

  let released = false;
  return () => {
    if (released) return;
    released = true;

    activeSuppressionCount = Math.max(0, activeSuppressionCount - 1);
    if (activeSuppressionCount === 0) {
      suppressedUntil = Date.now() + RELEASE_GRACE_MS;
    }
  };
}

export function getAppLockSuppressionRemainingMs(now = Date.now()): number {
  normalizeSuppression(now);
  return Math.max(0, suppressedUntil - now);
}
