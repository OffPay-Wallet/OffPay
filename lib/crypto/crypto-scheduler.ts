/**
 * Centralized async wrapper for CPU-bound crypto work.
 *
 * Why this exists:
 *   The Noble curves and hashes libraries run entirely on the JS thread. A
 *   single Ed25519 sign or PBKDF2 derivation can hold the bridge for tens of
 *   milliseconds and starve frame production. Most call sites already live
 *   inside async functions, but invoke the sync sign helpers directly,
 *   meaning the JS thread doesn't get a chance to render between the await
 *   that landed us in the function and the sync work that follows.
 *
 *   `runCryptoTask` plugs that gap. It yields once before the work, runs the
 *   sync callback, then logs the duration. We deliberately do NOT yield
 *   afterwards — the next `await` in the caller (network fetch, secure-store
 *   read, etc.) gives the thread its frame back without the extra ~16ms
 *   round-trip a second `yieldToUi()` would cost.
 *
 *   The helper is a strict superset of `mark`/`measure` from
 *   `lib/perf-marks`: every wrapped call automatically logs in dev. Callers
 *   should not also wrap with `timed()` to avoid duplicate output.
 *
 * What this is NOT:
 *   - It does not move work off the JS thread. Noble still runs on the same
 *     runtime. Yielding only changes scheduling, not arithmetic.
 *   - It does not change the public signatures of sync helpers like
 *     `signOffpayMessage` or `signSerializedTransactionWithSeed`. Sync
 *     primitives stay sync; this wrapper is for async call sites that want
 *     a frame break before invoking them.
 *   - It does not retry, abort, or memoize. It is a one-shot scheduler with
 *     instrumentation.
 */
import { mark, measure } from '@/lib/perf/perf-marks';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';

/**
 * Yield to the UI thread once, run a sync crypto callback, and log the
 * elapsed time under `name`. Returns the callback's value verbatim.
 *
 * `payload` is appended to the log line and is meant for short structured
 * fields (e.g. `{ network: 'mainnet' }`). Avoid passing wallet addresses,
 * mnemonics, signatures, or any other secret-bearing value.
 *
 * Errors are rethrown after measurement so the call site can handle them
 * normally. The measurement runs in a `finally` block so failed runs still
 * appear in the perf log, which is useful when a slow path also fails.
 */
export async function runCryptoTask<T>(
  name: string,
  fn: () => T,
  payload?: Record<string, string | number | boolean | null>,
): Promise<T> {
  await yieldToUi();
  const startedAt = mark();
  try {
    return fn();
  } finally {
    measure(name, startedAt, payload);
  }
}
