import { InteractionManager } from 'react-native';

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

type RequestIdleCallbackHandle = number;
type RequestIdleCallbackFn = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number },
) => RequestIdleCallbackHandle;
type CancelIdleCallbackFn = (handle: RequestIdleCallbackHandle) => void;

type InteractionTask = {
  cancel: () => void;
};

interface IdleCapableGlobal {
  requestIdleCallback?: RequestIdleCallbackFn;
  cancelIdleCallback?: CancelIdleCallbackFn;
}

export interface ScheduledUiWork {
  cancel: () => void;
}

type ScheduledUiTask = () => void | Promise<void>;

function requestUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    const frameGlobal = globalThis as typeof globalThis & {
      requestAnimationFrame?: typeof requestAnimationFrame;
    };
    const requestFrame =
      typeof frameGlobal.requestAnimationFrame === 'function'
        ? frameGlobal.requestAnimationFrame.bind(frameGlobal)
        : (callback: FrameRequestCallback) => {
            setTimeout(() => callback(Date.now()), 0);
          };

    requestFrame(() => resolve());
  });
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function yieldToUi(): Promise<void> {
  await requestUiFrame();
  await yieldToEventLoop();
}

export async function yieldToUiIfNeeded(startedAt: number, budgetMs = 8): Promise<number> {
  if (Date.now() - startedAt < budgetMs) return startedAt;
  await yieldToUi();
  return Date.now();
}

/**
 * Threshold below which a JSON parse / stringify can run synchronously
 * without a perceivable hitch. The `yieldToUi()` round-trip costs a
 * frame (~16ms+) on every call, so paying that price for a 200-byte
 * `getSlot` reply is pure latency. Tiny RPC reads (`getBalance`,
 * `getSlot`, `getSignatureStatuses`, etc.) parse in well under a
 * millisecond on-device — no need to yield.
 *
 * The threshold targets responses up to ~16 KB, which covers nearly
 * every read-style RPC payload. Heavy responses
 * (`getTransaction` with full meta, `getTokenAccountsByOwner` for
 * busy wallets) routinely exceed this and continue to use the
 * yielding path so the parse doesn't block frames.
 */
const JSON_YIELD_BYTES_THRESHOLD = 16 * 1024;

/**
 * Read a `Response` body as JSON, yielding to the UI thread only when
 * the body is large enough to benefit. For small responses we run the
 * parse synchronously after `await response.text()` resolves, saving a
 * frame of latency per RPC.
 */
export async function readJsonResponseAdaptive(response: Response): Promise<unknown> {
  if (typeof response.text !== 'function') {
    if (typeof response.json !== 'function') return null;
    return response.json();
  }
  const text = await response.text();
  if (text.length === 0) return null;
  if (text.length > JSON_YIELD_BYTES_THRESHOLD) {
    await yieldToUi();
    const parsed = JSON.parse(text);
    await yieldToEventLoop();
    return parsed;
  }
  return JSON.parse(text);
}

/**
 * Stringify a JSON-serializable value, yielding to the UI thread only
 * after the result exceeds the size threshold. Most RPC request bodies
 * are tiny ({"jsonrpc":"2.0","id":...,"method":"getSlot","params":[...]})
 * and don't benefit from yielding — but a batch enrichment body or a
 * signed transaction submission can be megabytes. The body length is
 * cheap to measure; we only yield when it's worth the frame cost.
 */
export async function stringifyJsonAdaptive(value: unknown): Promise<string> {
  const body = JSON.stringify(value);
  if (body.length > JSON_YIELD_BYTES_THRESHOLD) {
    await yieldToEventLoop();
  }
  return body;
}

export function scheduleUiWorkAfterFirstPaint(
  task: ScheduledUiTask,
  options?: {
    timeoutMs?: number;
    fallbackDelayMs?: number;
  },
): ScheduledUiWork {
  let cancelled = false;
  let frameHandle: number | null = null;
  let idleHandle: RequestIdleCallbackHandle | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let interactionTask: InteractionTask | null = null;
  let didRun = false;

  const run = () => {
    if (cancelled || didRun) return;
    didRun = true;

    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    void Promise.resolve(task()).catch(() => undefined);
  };

  const frameGlobal = globalThis as typeof globalThis & {
    requestAnimationFrame?: typeof requestAnimationFrame;
    cancelAnimationFrame?: typeof cancelAnimationFrame;
  };
  const requestFrame =
    typeof frameGlobal.requestAnimationFrame === 'function'
      ? frameGlobal.requestAnimationFrame.bind(frameGlobal)
      : (callback: FrameRequestCallback) =>
          setTimeout(() => callback(Date.now()), 0) as unknown as number;
  const cancelFrame =
    typeof frameGlobal.cancelAnimationFrame === 'function'
      ? frameGlobal.cancelAnimationFrame.bind(frameGlobal)
      : (handle: number) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);

  frameHandle = requestFrame(() => {
    frameHandle = null;
    if (cancelled) return;

    const idleGlobal = globalThis as typeof globalThis & IdleCapableGlobal;
    if (typeof idleGlobal.requestIdleCallback === 'function') {
      idleHandle = idleGlobal.requestIdleCallback(
        () => {
          idleHandle = null;
          run();
        },
        { timeout: options?.timeoutMs ?? 2500 },
      );
      return;
    }

    if (typeof InteractionManager.runAfterInteractions === 'function') {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        interactionTask = null;
        run();
      }) as InteractionTask;

      timeoutHandle = setTimeout(() => {
        timeoutHandle = null;
        interactionTask?.cancel();
        interactionTask = null;
        run();
      }, options?.fallbackDelayMs ?? 300);
      return;
    }

    timeoutHandle = setTimeout(() => {
      timeoutHandle = null;
      run();
    }, options?.fallbackDelayMs ?? 300);
  });

  return {
    cancel: () => {
      cancelled = true;

      if (frameHandle != null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }

      if (idleHandle != null) {
        const idleGlobal = globalThis as typeof globalThis & IdleCapableGlobal;
        idleGlobal.cancelIdleCallback?.(idleHandle);
        idleHandle = null;
      }

      if (timeoutHandle != null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      interactionTask?.cancel();
      interactionTask = null;
    },
  };
}
