describe('scheduleUiWorkAfterFirstPaint', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalRequestIdleCallback = globalThis.requestIdleCallback;
  const originalCancelIdleCallback = globalThis.cancelIdleCallback;

  let nextFrameHandle = 0;
  let frameCallbacks = new Map<number, FrameRequestCallback>();
  let mockCancelInteraction: jest.Mock;
  let mockRunAfterInteractions: jest.Mock;
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
    mockCancelInteraction = jest.fn();
    mockRunAfterInteractions = jest.fn(() => ({ cancel: mockCancelInteraction }));

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

    jest.doMock('react-native', () => ({
      InteractionManager: {
        runAfterInteractions: mockRunAfterInteractions,
      },
    }));

    ({ scheduleUiWorkAfterFirstPaint } =
      require('@/lib/perf/ui-work-scheduler') as typeof import('@/lib/perf/ui-work-scheduler'));
  });

  afterEach(() => {
    jest.dontMock('react-native');
    jest.useRealTimers();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.requestIdleCallback = originalRequestIdleCallback;
    globalThis.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('uses the fallback delay when InteractionManager never flushes', () => {
    const task = jest.fn();

    scheduleUiWorkAfterFirstPaint(task, { fallbackDelayMs: 50 });

    flushFrame();
    expect(mockRunAfterInteractions).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();

    jest.advanceTimersByTime(49);
    expect(task).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(mockCancelInteraction).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not run twice when InteractionManager flushes before the fallback', () => {
    const task = jest.fn();
    let interactionCallback: (() => void) | null = null;
    mockRunAfterInteractions.mockImplementation((callback: () => void) => {
      interactionCallback = callback;
      return { cancel: mockCancelInteraction };
    });

    scheduleUiWorkAfterFirstPaint(task, { fallbackDelayMs: 50 });

    flushFrame();
    if (interactionCallback == null) {
      throw new Error('InteractionManager callback was not registered.');
    }
    (interactionCallback as unknown as () => void)();
    jest.advanceTimersByTime(50);

    expect(task).toHaveBeenCalledTimes(1);
    expect(mockCancelInteraction).not.toHaveBeenCalled();
  });

  it('cancels the frame, interaction task, and fallback timer', () => {
    const task = jest.fn();
    const scheduled = scheduleUiWorkAfterFirstPaint(task, { fallbackDelayMs: 50 });

    flushFrame();
    scheduled.cancel();
    jest.advanceTimersByTime(50);

    expect(mockCancelInteraction).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
  });
});
