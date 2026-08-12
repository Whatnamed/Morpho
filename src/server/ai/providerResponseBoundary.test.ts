import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProviderRequestBudget,
  ProviderResponseBoundaryError,
  readBoundedProviderDiagnostic,
  readBoundedProviderJson
} from "./providerResponseBoundary";

describe("provider response transport boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads valid JSON below and exactly at the byte limit", async () => {
    for (const value of ["{}", '{"ok":true}']) {
      const budget = createProviderRequestBudget(undefined, 10_000);
      try {
        await expect(readBoundedProviderJson(new Response(value), budget, value.length)).resolves.toEqual(JSON.parse(value));
      } finally {
        budget.dispose();
      }
    }
  });

  it("fails early from an oversized Content-Length and cancels the body", async () => {
    const cancelled = vi.fn();
    const response = responseFromChunks(["{}"], cancelled, { "Content-Length": "11" });
    const budget = createProviderRequestBudget(undefined, 10_000);
    try {
      await expect(readBoundedProviderJson(response, budget, 10)).rejects.toMatchObject({
        code: "provider_response_too_large"
      });
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      budget.dispose();
    }
  });

  it("counts actual chunked bytes, cancels on overflow, and never parses the oversized JSON", async () => {
    const cancelled = vi.fn();
    const response = responseFromChunks(['{"value":"', "0123456789", '"}'], cancelled);
    const budget = createProviderRequestBudget(undefined, 10_000);
    try {
      await expect(readBoundedProviderJson(response, budget, 12)).rejects.toMatchObject({
        code: "provider_response_too_large"
      });
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      budget.dispose();
    }
  });

  it("surfaces invalid JSON under the limit without converting it to a size failure", async () => {
    const budget = createProviderRequestBudget(undefined, 10_000);
    try {
      await expect(readBoundedProviderJson(new Response("{invalid"), budget, 64)).rejects.toBeInstanceOf(SyntaxError);
    } finally {
      budget.dispose();
    }
  });

  it("reads only bounded diagnostic bytes and cancels the remaining body", async () => {
    const cancelled = vi.fn();
    const response = responseFromChunks(["diagnostic-", "must-not-be-fully-read"], cancelled);
    const budget = createProviderRequestBudget(undefined, 10_000);
    try {
      await expect(readBoundedProviderDiagnostic(response, budget, 11)).resolves.toBe("diagnostic-");
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      budget.dispose();
    }
  });

  it("keeps the exposed diagnostic within 800 characters even when the byte budget is larger", async () => {
    const cancelled = vi.fn();
    const response = responseFromChunks(["x".repeat(2_000)], cancelled);
    const budget = createProviderRequestBudget(undefined, 10_000);
    try {
      const diagnostic = await readBoundedProviderDiagnostic(response, budget, 1_024);
      expect(diagnostic).toHaveLength(800);
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      budget.dispose();
    }
  });

  it("cleans its deadline timer and external abort listener on dispose", () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const budget = createProviderRequestBudget(external.signal, 100);
    expect(vi.getTimerCount()).toBe(1);

    budget.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("keeps external cancellation distinct from the internal deadline", async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const budget = createProviderRequestBudget(external.signal, 100);
    const pending = budget.race(new Promise<never>(() => undefined));

    external.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    budget.dispose();
  });

  it("returns the stable internal deadline error for a pending operation", async () => {
    vi.useFakeTimers();
    const budget = createProviderRequestBudget(undefined, 100);
    const pending = budget.race(new Promise<never>(() => undefined));
    const rejected = expect(pending).rejects.toEqual(
      new ProviderResponseBoundaryError("provider_deadline_exceeded")
    );

    await vi.advanceTimersByTimeAsync(100);

    await rejected;
    budget.dispose();
  });

  it("keeps the first abort cause authoritative when external cancellation races the deadline", async () => {
    vi.useFakeTimers();

    const externalFirst = new AbortController();
    const externalBudget = createProviderRequestBudget(externalFirst.signal, 100);
    const externallyCancelled = externalBudget.race(new Promise<never>(() => undefined));
    const externalRejection = expect(externallyCancelled).rejects.toMatchObject({ name: "AbortError" });
    externalFirst.abort();
    await vi.advanceTimersByTimeAsync(100);
    await externalRejection;
    externalBudget.dispose();

    const deadlineFirst = new AbortController();
    const deadlineBudget = createProviderRequestBudget(deadlineFirst.signal, 100);
    const internallyTimedOut = deadlineBudget.race(new Promise<never>(() => undefined));
    const deadlineRejection = expect(internallyTimedOut).rejects.toMatchObject({
      code: "provider_deadline_exceeded"
    });
    await vi.advanceTimersByTimeAsync(100);
    deadlineFirst.abort();
    await deadlineRejection;
    deadlineBudget.dispose();
  });
});

function responseFromChunks(
  chunks: string[],
  cancelled: () => void,
  headers?: HeadersInit
): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
    },
    cancel: cancelled
  }), { headers });
}
