/**
 * Bounded-concurrency variant of `Promise.allSettled`. Useful when
 * fanning out many independent network calls — for example, fetching
 * a price quote per token mint — without saturating the JS thread or
 * the upstream rate limiter.
 *
 * The result preserves the input order. Each promise resolves to the
 * standard `PromiseSettledResult` shape so callers can keep their
 * existing fulfilled/rejected branching.
 */
export async function pooledAllSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const total = items.length;
  if (total === 0) return [];

  const cap = Math.max(1, Math.min(limit, total));
  const results = new Array<PromiseSettledResult<R>>(total);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      try {
        const value = await fn(items[index]!, index);
        results[index] = { status: 'fulfilled', value };
      } catch (error: unknown) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }

  await Promise.all(Array.from({ length: cap }, worker));
  return results;
}
