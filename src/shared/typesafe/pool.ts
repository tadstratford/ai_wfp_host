// A small bounded concurrency pool. Runs `worker` over `items` with up to
// `concurrency` in flight, invoking `onResult` as each finishes (not
// necessarily in input order). Returns the results in completion order.

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  onResult?: (result: R, item: T) => void,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const limit = Math.max(1, concurrency);

  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      const result = await worker(item);
      results.push(result);
      if (onResult) onResult(result, item);
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => lane());
  await Promise.all(lanes);
  return results;
}
