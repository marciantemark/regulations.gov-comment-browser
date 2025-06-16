export async function runPool<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number, total: number) => Promise<void>
) {
  const queue = [...items];
  let processed = 0;

  async function worker() {
    while (true) {
      const item = queue.shift();
      if (!item) break;
      const index = ++processed;
      await handler(item, index, items.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );
} 