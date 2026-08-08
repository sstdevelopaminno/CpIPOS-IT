export async function mapWithConcurrency<TInput, TOutput>(args: {
  items: TInput[];
  concurrency: number;
  worker: (item: TInput, index: number) => Promise<TOutput>;
}): Promise<TOutput[]> {
  const { items, worker } = args;
  const concurrency = Math.max(1, Math.trunc(args.concurrency || 1));
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}
