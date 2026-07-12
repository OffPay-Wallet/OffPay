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
    withSequence: (...animations: number[]) => animations[animations.length - 1],
    withTiming: (value: number) => value,
  };
});

describe('transaction timeline progression', () => {
  it('moves between two nodes until backend confirmation completes the arrival', () => {
    const confirmingWithoutSignature = deriveTimeline('submitting', false, 'transfer', null);
    const confirming = deriveTimeline('submitting', true, 'transfer', null);
    const confirmed = deriveTimeline('submitted', true, 'transfer', null);

    expect(confirmingWithoutSignature.steps).toHaveLength(2);
    expect(confirmingWithoutSignature.steps[1]).toMatchObject({
      key: 'settle',
      title: 'Confirmation',
      state: 'active',
    });
    expect(confirming).toMatchObject({ frontier: 1 });
    expect(confirming.steps[1]).toMatchObject({
      key: 'settle',
      state: 'active',
      subtitle: 'Finalizing on-chain',
    });
    expect(derivePlaneMotion('submitting')).toMatchObject({
      target: 0.92,
      duration: 40_000,
      completesSuccess: false,
    });
    expect(derivePlaneMotion('submitted')).toMatchObject({
      target: 1,
      duration: 1_200,
      completesSuccess: true,
    });
    expect(confirmed.steps).toHaveLength(2);
    expect(confirmed.steps[1]).toMatchObject({
      key: 'settle',
      state: 'success',
      hostsResult: true,
    });
  });
});
