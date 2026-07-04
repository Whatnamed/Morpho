import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createInitialWorkspace } from "../../../domain/morpho/workspace";
import type { ContinuityRecordEntry, MorphoWorkspace } from "../../../domain/morpho/types";
import { OverlayDrawers } from "./OverlayDrawers";

describe("OverlayDrawers project records", () => {
  it("renders semantic entries with quote, source availability, message source, and manual actions", () => {
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

    expect(html).toContain("来自明确对话 · 偏好");
    expect(html).toContain("夜间识别感优先");
    expect(html).toContain("来源已隐藏");
    expect(html).toContain("来源不可用");
    expect(html).toContain("用户表达");
    expect(html).not.toContain("当前没有待复核或来源不可用的连续性记录。");
    expect(html).toContain("不再适用");
    expect(html).toContain("撤回记录");
    expect(html).toContain("恢复为当前有效");
    expect(html).toContain("highlighted-record");
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
