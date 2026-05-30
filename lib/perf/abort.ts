/**
 * Runtime-safe abort helpers.
 *
 * React Native's Hermes engine does not expose a global `DOMException`, so
 * `new DOMException(..., 'AbortError')` and `error instanceof DOMException`
 * both throw `ReferenceError: Property 'DOMException' doesn't exist`. These
 * helpers create and detect cancellation errors using a plain `Error` whose
 * `name` is `'AbortError'`, which matches the convention used by
 * `AbortController` / `fetch` and works on every JS runtime.
 */

/** An abort/cancellation error tagged with `name === 'AbortError'`. */
export function createAbortError(message = 'The operation was aborted.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * True for any cancellation error — our own `createAbortError`, a DOM-style
 * `AbortError`, or a native `DOMException` on platforms that have it. Detection
 * is by `name`, so it never references the (possibly missing) `DOMException`
 * global.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** Throws an `AbortError` when the signal is already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw createAbortError();
  }
}
