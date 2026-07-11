const executingActionIds = new Set<string>();

/**
 * Synchronously claims an action before any React state update or async wallet
 * work begins. A null result means another confirmation/cancellation path
 * already owns the same action.
 */
export function tryAcquireAgenticActionExecution(actionId: string): (() => void) | null {
  if (executingActionIds.has(actionId)) return null;

  executingActionIds.add(actionId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    executingActionIds.delete(actionId);
  };
}

export function isAgenticActionExecutionLocked(actionId: string): boolean {
  return executingActionIds.has(actionId);
}
