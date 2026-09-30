/**
 * Sliding-window concurrency limiters.
 *
 * Prefer these over `Promise.allSettled` on fixed slices. Slicing waits for the
 * slowest member of each batch before starting the next, so one slow call leaves
 * the rest of the window idle; a sliding window starts the next item the moment
 * a slot frees up. Same request rate, less waiting.
 */

/**
 * Run `fn` over `items` with at most `concurrency` in flight, preserving order.
 * Rejects on the first error — use `pMapSettled` when individual failures are
 * expected and should not abort the rest.
 */
export function pMap<T, R>(
  items: T[],
  fn: (item: T, i: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  return new Promise((resolve, reject) => {
    if (items.length === 0) { resolve([]); return; }

    const results = new Array<R>(items.length);
    let nextIndex = 0;
    let completed = 0;
    let rejected = false;

    function runNext() {
      if (rejected || nextIndex >= items.length) return;
      const idx = nextIndex++;
      fn(items[idx], idx)
        .then((r) => {
          results[idx] = r;
          completed++;
          if (completed === items.length) resolve(results);
          else runNext();
        })
        .catch((e) => {
          rejected = true;
          reject(e);
        });
    }

    for (let i = 0; i < Math.min(concurrency, items.length); i++) runNext();
  });
}

/**
 * Like `pMap`, but a rejected item yields `undefined` instead of aborting the
 * run. Matches the failure tolerance of `Promise.allSettled`, which the discover
 * pipeline relies on — one bad Google lookup must not lose the whole batch.
 */
export function pMapSettled<T, R>(
  items: T[],
  fn: (item: T, i: number) => Promise<R>,
  concurrency: number,
  onError?: (error: unknown, item: T, i: number) => void,
): Promise<(R | undefined)[]> {
  return pMap<T, R | undefined>(
    items,
    async (item, i) => {
      try {
        return await fn(item, i);
      } catch (e) {
        onError?.(e, item, i);
        return undefined;
      }
    },
    concurrency,
  );
}
