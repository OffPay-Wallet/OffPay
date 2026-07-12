import {
  derivePlaneMotion,
  deriveTimeline,
} from '@/components/features/chat/TransactionTimeline';

jest.mock('react-native-reanimated', () => {
  const animation = {
    damping: () => animation,
    duration: () => animation,
    mass: () => animation,
    springify: () => animation,
    stiffness: () => animation,
  };

  return {
    __esModule: true,
    default: { View: 'AnimatedView' },
    Easing: { cubic: () => 0, out: (easing: unknown) => easing },
    ZoomIn: animation,
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useAnimatedStyle: jest.fn(),
    useReducedMotion: () => false,
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});

describe('transaction timeline progression', () => {
  it('moves from broadcast to confirmation and keeps the result on success', () => {
    const broadcasting = deriveTimeline('submitting', false, 'transfer', null);
    const confirming = deriveTimeline('submitting', true, 'transfer', null);
    const confirmed = deriveTimeline('submitted', true, 'transfer', null);

    expect(broadcasting).toMatchObject({ frontier: 1 });
    expect(broadcasting.steps[1]).toMatchObject({ key: 'broadcast', state: 'active' });
    expect(confirming).toMatchObject({ frontier: 2 });
    expect(confirming.steps[2]).toMatchObject({ key: 'settle', state: 'active' });
    expect(derivePlaneMotion('submitting', true, confirming.frontier)).toMatchObject({
      target: 1.92,
      duration: 20_000,
      completesSuccess: false,
    });
    expect(derivePlaneMotion('submitted', true, confirmed.frontier)).toMatchObject({
      target: 2,
      duration: 260,
      completesSuccess: true,
    });
    expect(confirmed.steps[2]).toMatchObject({
      key: 'settle',
      state: 'success',
      hostsResult: true,
    });
  });
});
