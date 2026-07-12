/** Max parallel GrsAI image requests for a multi-item visual plan. */
export const IMAGE_GENERATION_MAX_CONCURRENCY = 4;

/**
 * Run async work over items with a fixed concurrency limit.
 * Results keep input order. Workers pull the next index when free.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options: {
    onSettled?: (result: R, index: number) => void;
  } = {}
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      const result = await worker(items[index]!, index);
      results[index] = result;
      options.onSettled?.(result, index);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export function buildImageGenerationProgressMessage(input: {
  total: number;
  completed: number;
  inFlight: number;
  concurrency: number;
}): string {
  const { total, completed, inFlight, concurrency } = input;
  if (total <= 1) {
    return inFlight > 0 ? "正在生成图像…" : "图像任务处理中…";
  }
  return `并发生成中：完成 ${completed}/${total}，进行中 ${inFlight}（最多 ${concurrency} 路）`;
}
