import { useEffect, useMemo, useState } from 'react';

const COUNTDOWN_INTERVAL_MS = 1000;

function getQuoteExpiryCountdown(expiresAt: number | null | undefined, now: number): string | null {
  if (expiresAt == null) return null;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return 'Expired';
  return `${Math.ceil(remainingMs / 1000)}s`;
}

export function useQuoteExpiryCountdown(
  expiresAt: number | null | undefined,
  options?: {
    enabled?: boolean;
    fallbackLabel?: string;
  },
): string {
  const enabled = options?.enabled ?? true;
  const fallbackLabel = options?.fallbackLabel ?? 'No live quote';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || expiresAt == null) return undefined;

    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, COUNTDOWN_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, expiresAt]);

  return useMemo(
    () => getQuoteExpiryCountdown(enabled ? expiresAt : null, now) ?? fallbackLabel,
    [enabled, expiresAt, fallbackLabel, now],
  );
}

export function useQuoteExpiryDetailLabel(
  baseLabel: string,
  expiresAt: number | null | undefined,
  options?: {
    enabled?: boolean;
  },
): string {
  const countdown = useQuoteExpiryCountdown(expiresAt, {
    enabled: options?.enabled,
    fallbackLabel: '',
  });

  if (countdown.length === 0) return baseLabel;
  return `${baseLabel} · ${countdown}`;
}
