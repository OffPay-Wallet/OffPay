import { scheduleUiWorkAfterFirstPaint, type ScheduledUiWork } from '@/lib/perf/ui-work-scheduler';

export type WorkSecurityClass = 'public' | 'walletScoped' | 'localSecret';

export type WorkOffloadTarget =
  | 'client:userBlocking'
  | 'client:afterFirstPaint'
  | 'client:idle'
  | 'native:localCpu'
  | 'worker:publicOnly';

export interface ClientWorkOptions {
  name: string;
  target: Exclude<WorkOffloadTarget, 'worker:publicOnly'>;
  security: WorkSecurityClass;
  timeoutMs?: number;
  fallbackDelayMs?: number;
}

export interface WorkerCandidateOptions {
  name: string;
  security: Exclude<WorkSecurityClass, 'localSecret'>;
  reason: string;
}

export interface WorkOffloadDecision {
  name: string;
  target: WorkOffloadTarget;
  security: WorkSecurityClass;
  reason?: string;
}

const SECURE_LOCAL_ONLY_RULE =
  'Seed phrases, private keys, signing seeds, local signatures, biometric/passcode checks, Umbra private witnesses, and encrypted backup keys must stay on-device.';

export function getSecureLocalOnlyRule(): string {
  return SECURE_LOCAL_ONLY_RULE;
}

export function classifyClientWork(options: ClientWorkOptions): WorkOffloadDecision {
  return {
    name: options.name,
    target: options.target,
    security: options.security,
  };
}

export function classifyWorkerCandidate(options: WorkerCandidateOptions): WorkOffloadDecision {
  return {
    name: options.name,
    target: 'worker:publicOnly',
    security: options.security,
    reason: options.reason,
  };
}

export function assertWorkerCandidateSafe(decision: WorkOffloadDecision): void {
  if (decision.target !== 'worker:publicOnly') return;
  if (decision.security !== 'localSecret') return;

  throw new Error(
    `[work-offload] Refusing to classify "${decision.name}" as worker work. ${SECURE_LOCAL_ONLY_RULE}`,
  );
}

export function scheduleClientWork(
  options: ClientWorkOptions,
  task: () => void | Promise<void>,
): ScheduledUiWork {
  const decision = classifyClientWork(options);

  if (decision.target === 'client:userBlocking' || decision.target === 'native:localCpu') {
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (!cancelled) return task();
        return undefined;
      })
      .catch(() => undefined);
    return {
      cancel: () => {
        cancelled = true;
      },
    };
  }

  const fallbackDelayMs =
    options.fallbackDelayMs ?? (decision.target === 'client:idle' ? 600 : undefined);

  return scheduleUiWorkAfterFirstPaint(task, {
    timeoutMs: options.timeoutMs,
    fallbackDelayMs,
  });
}

export function runClientWork<T>(
  options: ClientWorkOptions,
  task: () => T | Promise<T>,
): Promise<T> {
  const decision = classifyClientWork(options);

  if (decision.target === 'client:userBlocking' || decision.target === 'native:localCpu') {
    return Promise.resolve().then(task);
  }

  return new Promise<T>((resolve, reject) => {
    scheduleClientWork(options, () => {
      void Promise.resolve().then(task).then(resolve, reject);
    });
  });
}
