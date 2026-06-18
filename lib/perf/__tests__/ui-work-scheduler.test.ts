describe('scheduleUiWorkAfterFirstPaint', () => {
  type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalRequestIdleCallback = globalThis.requestIdleCallback;
  const originalCancelIdleCallback = globalThis.cancelIdleCallback;

  let nextFrameHandle = 0;
  let frameCallbacks = new Map<number, FrameRequestCallback>();
  let scheduleUiWorkAfterFirstPaint: (typeof import('@/lib/perf/ui-work-scheduler'))['scheduleUiWorkAfterFirstPaint'];

  function flushFrame(): void {
    const callbacks = Array.from(frameCallbacks.values());
    frameCallbacks.clear();
    callbacks.forEach((callback) => callback(Date.now()));
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    nextFrameHandle = 0;
    frameCallbacks = new Map();

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      nextFrameHandle += 1;
      frameCallbacks.set(nextFrameHandle, callback);
      return nextFrameHandle;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((handle: number): void => {
      frameCallbacks.delete(handle);
    }) as typeof cancelAnimationFrame;
    Object.defineProperty(globalThis, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelIdleCallback', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    ({ scheduleUiWorkAfterFirstPaint } =
      require('@/lib/perf/ui-work-scheduler') as typeof import('@/lib/perf/ui-work-scheduler'));
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.requestIdleCallback = originalRequestIdleCallback;
    globalThis.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('uses the fallback delay when requestIdleCallback is unavailable', () => {
    const task = jest.fn();

    scheduleUiWorkAfterFirstPaint(task, { fallbackDelayMs: 50 });

    flushFrame();
    expect(task).not.toHaveBeenCalled();

    jest.advanceTimersByTime(49);
    expect(task).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('uses requestIdleCallback when available', () => {
    const task = jest.fn();
    let idleCallback: ((deadline: IdleDeadlineLike) => void) | null = null;
    const requestIdleCallback = jest.fn(
      (callback: (deadline: IdleDeadlineLike) => void, _options?: { timeout?: number }) => {
        idleCallback = callback;
        return 10;
      },
    );
    const cancelIdleCallback = jest.fn();
    Object.defineProperty(globalThis, 'requestIdleCallback', {
      configurable: true,
      value: requestIdleCallback,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelIdleCallback', {
      configurable: true,
      value: cancelIdleCallback,
      writable: true,
    });

    scheduleUiWorkAfterFirstPaint(task, { timeoutMs: 500, fallbackDelayMs: 50 });

    flushFrame();
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
    expect(task).not.toHaveBeenCalled();

    const runIdleCallback = idleCallback as ((deadline: IdleDeadlineLike) => void) | null;
    if (runIdleCallback == null) {
      throw new Error('Idle callback was not registered.');
    }
    runIdleCallback({ didTimeout: false, timeRemaining: () => 8 });
    jest.advanceTimersByTime(50);

    expect(task).toHaveBeenCalledTimes(1);
    expect(cancelIdleCallback).not.toHaveBeenCalled();
  });

  it('cancels the frame and fallback timer', () => {
    const task = jest.fn();
    const scheduled = scheduleUiWorkAfterFirstPaint(task, { fallbackDelayMs: 50 });

    flushFrame();
    scheduled.cancel();
    jest.advanceTimersByTime(50);

    expect(task).not.toHaveBeenCalled();
  });
});
