import { describe, expect, it, vi } from "vitest";

import {
  IMAGE_GENERATION_MAX_CONCURRENCY,
  buildImageGenerationProgressMessage,
  mapWithConcurrency
} from "./imageGenerationConcurrency";

describe("imageGenerationConcurrency", () => {
  it("caps default concurrency at four", () => {
    expect(IMAGE_GENERATION_MAX_CONCURRENCY).toBe(4);
  });

  it("preserves result order while limiting in-flight work", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];

    const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (item) => {
      started.push(item);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20 + (5 - item) * 2));
      inFlight -= 1;
      return item * 10;
    });

    expect(results).toEqual([0, 10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(started.slice(0, 3).sort()).toEqual([0, 1, 2]);
  });

  it("runs empty input without workers", async () => {
    const worker = vi.fn(async (item: number) => item);
    await expect(mapWithConcurrency([], 4, worker)).resolves.toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it("builds concurrent progress copy", () => {
    expect(
      buildImageGenerationProgressMessage({ total: 6, completed: 2, inFlight: 4, concurrency: 4 })
    ).toContain("完成 2/6");
    expect(buildImageGenerationProgressMessage({ total: 1, completed: 0, inFlight: 1, concurrency: 4 })).toContain(
      "正在生成"
    );
  });
});
