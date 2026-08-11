// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createInitialWorkspace } from "../../../domain/morpho/workspace";
import type { ContinuityRecordEntry, MorphoWorkspace } from "../../../domain/morpho/types";
import { OverlayDrawers } from "./OverlayDrawers";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("OverlayDrawers project records", () => {
  it("defaults to current project memory and keeps history controls in a separate tab", () => {
    const seedWorkspace = createInitialWorkspace();
    const workspace = withContinuityEntries(
      {
        ...seedWorkspace,
        objects: {
          ...seedWorkspace.objects,
          "image-soft-rail-v2": {
            ...seedWorkspace.objects["image-soft-rail-v2"],
            visibility: "hidden"
          }
        }
      },
      [
      makeSemanticEntry({
        id: "continuity-visible",
        summary: "明确偏好：夜间识别感优先",
        sourceRefs: [
          {
            kind: "message",
            id: "ai-user-1",
            snapshot: {
              title: "用户表达",
              summarySnippet: "夜间识别感优先",
              createdAt: "2026-06-30T09:00:00.000Z"
            },
            sourceAvailability: "active"
          },
          {
            kind: "object",
            id: "image-soft-rail-v2",
            snapshot: {
              title: "柔光轨道 v2",
              objectType: "image",
              summarySnippet: "当前主方向产品图"
            },
            sourceAvailability: "hidden"
          },
          {
            kind: "object",
            id: "missing-source",
            snapshot: {
              title: "旧候选图",
              objectType: "image",
              visibility: "deleted",
              summarySnippet: "已删除来源的轻量快照"
            },
            sourceAvailability: "missing"
          }
        ]
      })
    ]);

    const html = renderToStaticMarkup(
      createElement(OverlayDrawers, {
        mode: "records",
        workspace,
        highlightedRecordIds: ["continuity-visible"],
        onClose: () => undefined,
        onFocusArea: () => undefined,
        onRestoreObject: () => undefined,
        onLocateObject: () => undefined,
        onSetContinuityEntryManualState: () => undefined
      })
    );

    expect(html).toContain("项目记录");
    expect(html).toContain("当前项目记忆");
    expect(html).toContain("阶段记录");
    expect(html).toContain("历史与来源");
    expect(html).toContain("项目概览");
    expect(html).toContain("设计定义");
    expect(html).toContain("continuity-record-summary");
    expect(html).toContain("continuity-source-list");
    expect(html).toContain("continuity-source-kind");
    expect(html).not.toContain("designDefinitionOperation");
    expect(html).not.toContain("不再适用");
    expect(html).not.toContain("撤回记录");
  });

  it("opens project search with an empty query and no preset example results", () => {
    const html = renderToStaticMarkup(
      createElement(OverlayDrawers, {
        mode: "search",
        workspace: createInitialWorkspace(),
        highlightedRecordIds: [],
        onClose: () => undefined,
        onFocusArea: () => undefined,
        onRestoreObject: () => undefined,
        onLocateObject: () => undefined,
        onSetContinuityEntryManualState: () => undefined
      })
    );

    expect(html).toContain('value=""');
    expect(html).toContain("输入关键词后搜索");
    expect(html).not.toContain("暖光");
  });

  it("does not silently hide assets after the first ten", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(OverlayDrawers, {
        mode: "assets",
        workspace: {
          ...workspace,
          assets: Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => [
              `asset-extra-${index}`,
              {
                id: `asset-extra-${index}`,
                fileName: `补充资产 ${index + 1}.png`,
                mimeType: "image/png",
                size: 1000 + index,
                createdAt: "2026-07-03T10:00:00.000Z",
                storageKey: `blob:asset-extra-${index}`,
                sourceType: "originalImage" as const
              }
            ])
          )
        },
        highlightedRecordIds: [],
        onClose: () => undefined,
        onFocusArea: () => undefined,
        onRestoreObject: () => undefined,
        onLocateObject: () => undefined,
        onSetContinuityEntryManualState: () => undefined
      })
    );

    expect(html).toContain("共 12 项");
    expect(html).toContain("显示全部");
  });

  it("renders drawer rows as user-facing metadata instead of inert action copy", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(OverlayDrawers, {
        mode: "hidden",
        workspace: {
          ...workspace,
          objects: {
            ...workspace.objects,
            "image-soft-rail-v2": {
              ...workspace.objects["image-soft-rail-v2"],
              visibility: "hidden"
            }
          }
        },
        highlightedRecordIds: [],
        onClose: () => undefined,
        onFocusArea: () => undefined,
        onRestoreObject: () => undefined,
        onLocateObject: () => undefined,
        onSetContinuityEntryManualState: () => undefined
      })
    );

    expect(html).not.toContain("查看来源");
    expect(html).not.toContain("查看版本");
    expect(html).not.toContain("查看用于哪里");
  });

  it("disables hidden restore and continuity manual-state actions in read-only mode", async () => {
    const seedWorkspace = createInitialWorkspace();
    const workspace = withContinuityEntries(
      {
        ...seedWorkspace,
        objects: {
          ...seedWorkspace.objects,
          "image-soft-rail-v2": {
            ...seedWorkspace.objects["image-soft-rail-v2"],
            visibility: "hidden"
          }
        }
      },
      [makeSemanticEntry({ id: "continuity-readonly" })]
    );

    const hiddenHtml = renderToStaticMarkup(
      createElement(OverlayDrawers, {
        mode: "hidden",
        workspace,
        canMutateWorkspace: false,
        highlightedRecordIds: [],
        onClose: () => undefined,
        onFocusArea: () => undefined,
        onRestoreObject: () => undefined,
        onLocateObject: () => undefined,
        onSetContinuityEntryManualState: () => undefined
      })
    );
    expect(hiddenHtml).toMatch(/<button[^>]*disabled=""[^>]*>恢复并定位<\/button>/);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(OverlayDrawers, {
          mode: "records",
          workspace,
          canMutateWorkspace: false,
          highlightedRecordIds: [],
          onClose: () => undefined,
          onFocusArea: () => undefined,
          onRestoreObject: () => undefined,
          onLocateObject: () => undefined,
          onSetContinuityEntryManualState: () => undefined
        })
      );
    });

    const historyTab = [...container.querySelectorAll("button")].find((button) => button.textContent === "历史与来源");
    expect(historyTab).toBeDefined();
    await act(async () => {
      historyTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const manualStateButtons = [...container.querySelectorAll("button")].filter((button) =>
      ["不再适用", "撤回记录", "恢复为当前有效"].includes(button.textContent ?? "")
    );
    expect(manualStateButtons.length).toBeGreaterThan(0);
    expect(manualStateButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});

function withContinuityEntries(workspace: MorphoWorkspace, entries: ContinuityRecordEntry[]): MorphoWorkspace {
  return {
    ...workspace,
    projectContinuity: {
      ...workspace.projectContinuity,
      recordEntries: [...workspace.projectContinuity.recordEntries, ...entries]
    }
  };
}

function makeSemanticEntry(patch: Partial<ContinuityRecordEntry>): ContinuityRecordEntry {
  return {
    id: "continuity-test",
    dedupeKey: "conversationSemanticPatch:test",
    origin: "conversationSemanticPatch",
    manualState: "active",
    semanticKind: "preference",
    sourceMessageId: "ai-user-1",
    evidenceQuote: "夜间识别感优先",
    scope: "project",
    stage: "directionAndVisual",
    category: "preference",
    summary: "明确偏好：夜间识别感优先",
    sourceRefs: [],
    createdAt: "2026-06-30T09:00:00.000Z",
    updatedAt: "2026-06-30T09:00:00.000Z",
    validity: "current",
    ...patch
  };
}
