import { shouldRunLoopingProgress } from '@/hooks/useLoopingProgress';

describe('looping progress animation policy', () => {
  it('runs while active when reduced motion is disabled', () => {
    expect(shouldRunLoopingProgress(true, false)).toBe(true);
  });

  it('stops when its consumer is inactive', () => {
    expect(shouldRunLoopingProgress(false, false)).toBe(false);
  });

  it('respects the system reduced-motion setting', () => {
    expect(shouldRunLoopingProgress(true, true)).toBe(false);
  });
});
