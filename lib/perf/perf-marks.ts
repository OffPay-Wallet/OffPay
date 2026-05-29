/**
 * Lightweight, dev-only performance instrumentation.
 *
 * The agent-side report flagged crypto, signing, API auth, and swap-quote
 * fetches as the suspected JS-thread hot paths. Before changing any behavior
 * we want measured numbers, not feel. This module exposes three primitives:
 *
 *   - `mark(name)`         records a timestamp under `name`
 *   - `measure(name, since)` returns `Date.now() - since` and logs the delta
 *   - `timed(name, fn)`    wraps a sync or async function and logs its duration
 *
 * In production builds (`__DEV__ === false`) every helper is a no-op and the
 * `timed` wrapper passes the callback through verbatim. The helpers are
 * intentionally side-effect free in production so accidentally leaving an
 * instrumentation call in shipping code costs zero.
 *
 * The output format is a single tagged log line per measurement so it's
 * trivial to grep and to ingest into any external profiler later. The tag is
 * `[perf]` so it doesn't collide with the existing `[wallet-activity-stream]`
 * style logs in the codebase.
 */

const PERF_TAG = '[perf]';

/** True when running under Metro/Hermes in development. */
const isDev = typeof __DEV__ === 'boolean' && __DEV__;

/** Best-effort high-resolution clock; falls back to `Date.now()` in Hermes. */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Capture a timestamp for the start of a measured operation.
 *
 * Pair it with `measure(name, mark())` to log the delta. In production this
 * still returns a real number so the caller code does not need to branch on
 * `__DEV__`, but no log line is emitted later.
 */
export function mark(): number {
  return now();
}

/**
 * Log the elapsed time since a previous `mark()` value.
 *
 * `payload` is appended verbatim to the log line and is meant for short
 * structured fields (e.g. `{ network: 'mainnet', method: 'sign' }`). Avoid
 * passing wallet addresses, mnemonics, signatures, or any other secret-bearing
 * value. Returns the elapsed milliseconds for callers that want to forward
 * the number into their own metrics.
 */
export function measure(
  name: string,
  since: number,
  payload?: Record<string, string | number | boolean | null>,
): number {
  const elapsed = now() - since;
  if (!isDev) return elapsed;
  const ms = elapsed.toFixed(elapsed < 10 ? 2 : 1);
  if (payload == null) {
    console.log(`${PERF_TAG} ${name} ${ms}ms`);
  } else {
    console.log(`${PERF_TAG} ${name} ${ms}ms`, payload);
  }
  return elapsed;
}

/**
 * Wrap a sync or async callback with a `mark`/`measure` pair.
 *
 * Use this when the operation is a single self-contained function call. The
 * wrapper always returns the underlying result and rethrows the underlying
 * error after logging. Errors include their `Error.message` in the log so we
 * can correlate slow paths with failure modes.
 */
export function timed<T>(
  name: string,
  fn: () => T,
  payload?: Record<string, string | number | boolean | null>,
): T;
export function timed<T>(
  name: string,
  fn: () => Promise<T>,
  payload?: Record<string, string | number | boolean | null>,
): Promise<T>;
export function timed<T>(
  name: string,
  fn: () => T | Promise<T>,
  payload?: Record<string, string | number | boolean | null>,
): T | Promise<T> {
  if (!isDev) return fn();
  const startedAt = now();
  const finalize = (success: boolean, error?: unknown): void => {
    const elapsed = now() - startedAt;
    const ms = elapsed.toFixed(elapsed < 10 ? 2 : 1);
    const status = success ? 'ok' : 'err';
    if (success) {
      if (payload == null) {
        console.log(`${PERF_TAG} ${name} ${ms}ms ${status}`);
      } else {
        console.log(`${PERF_TAG} ${name} ${ms}ms ${status}`, payload);
      }
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (payload == null) {
      console.log(`${PERF_TAG} ${name} ${ms}ms ${status} ${message}`);
    } else {
      console.log(`${PERF_TAG} ${name} ${ms}ms ${status} ${message}`, payload);
    }
  };
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (error) {
    finalize(false, error);
    throw error;
  }
  if (result != null && typeof (result as Promise<T>).then === 'function') {
    return (result as Promise<T>).then(
      (value) => {
        finalize(true);
        return value;
      },
      (error) => {
        finalize(false, error);
        throw error;
      },
    );
  }
  finalize(true);
  return result;
}
