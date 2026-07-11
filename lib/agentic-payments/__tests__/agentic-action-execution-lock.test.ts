import {
  isAgenticActionExecutionLocked,
  tryAcquireAgenticActionExecution,
} from '@/lib/agentic-payments/action-execution-lock';

describe('agentic action execution lock', () => {
  it('allows only one owner for an action until release', () => {
    const release = tryAcquireAgenticActionExecution('action-1');

    expect(release).not.toBeNull();
    expect(isAgenticActionExecutionLocked('action-1')).toBe(true);
    expect(tryAcquireAgenticActionExecution('action-1')).toBeNull();

    release?.();
    expect(isAgenticActionExecutionLocked('action-1')).toBe(false);

    const releaseAgain = tryAcquireAgenticActionExecution('action-1');
    expect(releaseAgain).not.toBeNull();
    releaseAgain?.();
  });

  it('does not let a duplicate release clear a later owner', () => {
    const releaseFirst = tryAcquireAgenticActionExecution('action-2');
    releaseFirst?.();

    const releaseSecond = tryAcquireAgenticActionExecution('action-2');
    releaseFirst?.();

    expect(isAgenticActionExecutionLocked('action-2')).toBe(true);
    releaseSecond?.();
    expect(isAgenticActionExecutionLocked('action-2')).toBe(false);
  });
});
