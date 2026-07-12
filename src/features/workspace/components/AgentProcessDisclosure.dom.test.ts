// @vitest-environment happy-dom

import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessagePart, AgentTrace } from "@/domain/morpho/types";
import { applyAgentStreamEventsToTrace } from "../agentMessageTrace";
import { createAgentStreamEventBatcher } from "../agentStreamClient";
import { AgentProcessDisclosure } from "./AgentProcessDisclosure";

const roots = new Set<Root>();
let reducedMotion = false;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reducedMotion = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      media: query,
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true
    })
  });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (callback) => window.setTimeout(() => callback(performance.now()), 16)
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => window.clearTimeout(handle));
});

afterEach(() => {
  act(() => {
    roots.forEach((root) => root.unmount());
  });
  roots.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AgentProcessDisclosure DOM behavior", () => {
  it("auto-opens streaming parts and updates reasoning, tool state, and commentary in source order", async () => {
    const trace = streamingTrace([
      reasoning("reasoning-1", "核对当前材料。", "streaming"),
      activity("tool-1", "搜索 Responses reasoning summary", "running")
    ]);
    const mounted = await mountDisclosure(trace);

    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("true");
    expect(mounted.container.textContent).toContain("核对当前材料。");
    expect(mounted.container.querySelector('[data-state="running"]')).not.toBeNull();

    const updated = streamingTrace([
      reasoning("reasoning-1", "核对当前材料与事件顺序。", "done"),
      activity("tool-1", "搜索 Responses reasoning summary", "done"),
      commentary("commentary-1", "资料足以继续。", "streaming")
    ]);
    await mounted.render(updated);

    expect(mounted.container.querySelector('[data-state="running"]')).toBeNull();
    expect(mounted.container.querySelector('[data-state="done"]')).not.toBeNull();
    const html = mounted.container.innerHTML;
    expect(html.indexOf("核对当前材料与事件顺序。")).toBeLessThan(html.indexOf("搜索 Responses reasoning summary"));
    expect(html.indexOf("搜索 Responses reasoning summary")).toBeLessThan(html.indexOf("资料足以继续。"));
  });

  it("keeps final body outside the collapsible region and toggles chevron state", async () => {
    const mounted = await mountDisclosure(streamingTrace([reasoning("reasoning-1", "过程内容", "streaming")]), "最终正文");
    const button = trigger(mounted.container);
    expect(button.querySelector("svg")?.classList.contains("is-open")).toBe(true);

    await click(button);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.querySelector("svg")?.classList.contains("is-open")).toBe(false);
    const final = mounted.container.querySelector('[data-testid="final-body"]');
    expect(final?.textContent).toBe("最终正文");
    expect(final?.closest(".agent-process-collapse")).toBeNull();
  });

  it("auto-collapses 800ms after completion", async () => {
    vi.useFakeTimers();
    const mounted = await mountDisclosure(streamingTrace([reasoning("reasoning-1", "过程内容", "streaming")]));
    await mounted.render(doneTrace([reasoning("reasoning-1", "过程内容", "done")]));

    await advance(799);
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("true");
    await advance(1);
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("false");
  });

  it("honors a manual close while streaming and does not reopen for later deltas", async () => {
    const mounted = await mountDisclosure(streamingTrace([reasoning("reasoning-1", "第一段", "streaming")]));
    await click(trigger(mounted.container));
    await mounted.render(streamingTrace([reasoning("reasoning-1", "第一段，随后新增。", "streaming")]));

    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("false");
    expect(mounted.container.textContent).toContain("随后新增");
  });

  it("honors a manual open and does not auto-close it after completion", async () => {
    vi.useFakeTimers();
    const mounted = await mountDisclosure(doneTrace([reasoning("reasoning-1", "历史过程", "done")]));
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("false");
    await click(trigger(mounted.container));
    await advance(1_200);
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("true");
  });

  it("uses an internal scroll viewport, follows the bottom, and respects user scroll-up", async () => {
    vi.useFakeTimers();
    let scrollHeight = 600;
    let scrollTop = 0;
    const mounted = await mountDisclosure(streamingTrace(longReasoningParts(18)));
    const viewport = mounted.container.querySelector<HTMLElement>(".agent-process-parts");
    if (!viewport) {
      throw new Error("Expected the process scroll viewport.");
    }
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - 200));
        }
      }
    });

    viewport.scrollTop = 400;
    await dispatchScroll(viewport);
    scrollHeight = 660;
    await mounted.render(streamingTrace(longReasoningParts(19)));
    await advance(16);
    expect(scrollTop).toBe(460);

    viewport.scrollTop = 80;
    await dispatchScroll(viewport);
    expect(mounted.container.querySelector(".agent-process-fade.is-top.is-visible")).not.toBeNull();
    expect(mounted.container.querySelector(".agent-process-fade.is-bottom.is-visible")).not.toBeNull();
    scrollHeight = 720;
    await mounted.render(streamingTrace(longReasoningParts(20)));
    await advance(16);
    expect(scrollTop).toBe(80);
  });

  it("marks reduced-motion mode while preserving running information", async () => {
    reducedMotion = true;
    const mounted = await mountDisclosure(streamingTrace([activity("tool-1", "生成 2 张视觉方向", "running")]));
    const process = mounted.container.querySelector(".agent-process");

    expect(process?.classList.contains("is-reduced-motion")).toBe(true);
    expect(process?.getAttribute("data-reduced-motion")).toBe("true");
    expect(mounted.container.querySelector('[data-state="running"]')?.textContent).toContain("生成 2 张视觉方向");
  });

  it.each(["failed", "cancelled"] as const)("keeps a %s trace expandable", async (status) => {
    const trace: AgentTrace = {
      ...doneTrace([reasoning("reasoning-1", "保留的过程", "done")]),
      status
    };
    const mounted = await mountDisclosure(trace);
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("false");
    await click(trigger(mounted.container));
    expect(trigger(mounted.container).getAttribute("aria-expanded")).toBe("true");
    expect(mounted.container.textContent).toContain("保留的过程");
  });

  it("renders only the running title when no visible parts have arrived", async () => {
    const mounted = await mountDisclosure(streamingTrace([]));
    expect(mounted.container.textContent).toContain("思考中…");
    expect(mounted.container.querySelector(".agent-process-collapse")).toBeNull();
  });

  it("renders complete text after 100 deltas are batched into one DOM update", async () => {
    vi.useFakeTimers();
    let trace = streamingTrace([reasoning("reasoning-1", "", "streaming")]);
    let commits = 0;
    const batcher = createAgentStreamEventBatcher({
      onFlush: (events) => {
        commits += 1;
        trace = {
          ...trace,
          parts: applyAgentStreamEventsToTrace(trace, events, "2026-07-13T00:00:01.000Z").parts
        };
      }
    });
    for (let index = 0; index < 100; index += 1) {
      batcher.push({ type: "reasoning-delta", partId: "reasoning-1", delta: String(index % 10) });
    }
    await advance(48);
    const mounted = await mountDisclosure(trace);

    expect(commits).toBe(1);
    expect(mounted.container.textContent).toContain(
      Array.from({ length: 100 }, (_, index) => String(index % 10)).join("")
    );
  });

  it("cleans timers and observers on unmount without a state-update warning", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mounted = await mountDisclosure(streamingTrace([reasoning("reasoning-1", "过程", "streaming")]));
    await mounted.render(doneTrace([reasoning("reasoning-1", "过程", "done")]));
    await mounted.unmount();
    await advance(1_000);

    expect(
      consoleError.mock.calls.some((call) => String(call[0]).toLowerCase().includes("state update"))
    ).toBe(false);
  });
});

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

async function mountDisclosure(initialTrace: AgentTrace, finalBody?: string) {
  const container = document.createElement("div");
  container.className = "ai-scroll";
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  const render = async (trace: AgentTrace) => {
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(AgentProcessDisclosure, { trace, renderText: renderPlainText }),
          finalBody ? createElement("div", { "data-testid": "final-body" }, finalBody) : null
        )
      );
      await Promise.resolve();
    });
  };
  await render(initialTrace);
  return {
    container,
    render,
    unmount: async () => {
      await act(async () => root.unmount());
      roots.delete(root);
    }
  };
}

function renderPlainText(text: string): ReactNode {
  return createElement("p", null, text);
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function dispatchScroll(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

function trigger(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(".agent-process-trigger");
  if (!button) {
    throw new Error("Expected the Agent process trigger.");
  }
  return button;
}

function streamingTrace(parts: AgentMessagePart[]): AgentTrace {
  return {
    startedAt: "2026-07-13T00:00:00.000Z",
    status: "streaming",
    parts
  };
}

function doneTrace(parts: AgentMessagePart[]): AgentTrace {
  return {
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:00:06.000Z",
    status: "done",
    parts
  };
}

function reasoning(id: string, text: string, state: "streaming" | "done"): AgentMessagePart {
  return { id, type: "reasoning", text, state, createdAt: "2026-07-13T00:00:00.000Z" };
}

function commentary(id: string, text: string, state: "streaming" | "done"): AgentMessagePart {
  return { id, type: "commentary", text, state, createdAt: "2026-07-13T00:00:00.000Z" };
}

function activity(id: string, label: string, state: "running" | "done" | "failed"): AgentMessagePart {
  return {
    id,
    type: "toolActivity",
    toolCallId: id,
    toolName: "search_web_evidence",
    activityKind: "webSearch",
    label,
    state,
    startedAt: "2026-07-13T00:00:00.000Z",
    ...(state === "running" ? {} : { completedAt: "2026-07-13T00:00:01.000Z" })
  };
}

function longReasoningParts(count: number): AgentMessagePart[] {
  return Array.from({ length: count }, (_, index) =>
    reasoning(`reasoning-${index}`, `第 ${index + 1} 段推理内容`, index === count - 1 ? "streaming" : "done")
  );
}
