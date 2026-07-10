import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildConceptDirectionLineageDetail,
  buildRelatedDetailRows,
  buildSourceDetailRows,
  buildVersionDetailRows,
  buildConceptDirectionVersionDetail,
  BottomDetailBar,
  getAvailableDetailTabs,
  getDocumentReaderActionState,
  buildDesignDefinitionInfoMeta,
  buildDesignDefinitionVersionDetail
} from "./BottomDetailBar";
import { createInitialWorkspace } from "../../../domain/morpho/workspace";
import { createGeneratedImageFromAsset } from "../../../domain/morpho/generation";

describe("BottomDetailBar design definition text", () => {
  it("shows the revision-draft badge only when a pending revision draft exists", () => {
    expect(buildDesignDefinitionInfoMeta(true)).toBe("有修订草稿");
    expect(buildDesignDefinitionInfoMeta(false)).toBeUndefined();
  });

  it("keeps version detail neutral unless a pending revision draft exists", () => {
    expect(buildDesignDefinitionVersionDetail(2, true)).toBe("当前设计定义共有 2 个修订，当前有修订草稿待应用。");
    expect(buildDesignDefinitionVersionDetail(2, false)).toBe("当前设计定义共有 2 个修订。");
  });
});

describe("BottomDetailBar concept direction text", () => {
  it("shows current revision count and current revision id", () => {
    expect(buildConceptDirectionVersionDetail(["direction-a-r1", "direction-a-r2"], "direction-a-r2")).toBe(
      "当前方向共有 2 个修订，当前修订为 direction-a-r2。"
    );
  });

  it("summarizes lineage records connected to the selected direction", () => {
    expect(
      buildConceptDirectionLineageDetail("direction-merged", [
        {
          id: "lineage-a",
          kind: "mergedFromDirection",
          fromDirectionId: "direction-a",
          toDirectionId: "direction-merged",
          createdAt: "2026-06-26T00:00:00.000Z",
          note: "方向 AB 合并了方向 A。"
        },
        {
          id: "lineage-b",
          kind: "mergedFromDirection",
          fromDirectionId: "direction-b",
          toDirectionId: "direction-merged",
          createdAt: "2026-06-26T00:00:00.000Z",
          note: "方向 AB 合并了方向 B。"
        }
      ])
    ).toBe("mergedFromDirection：方向 AB 合并了方向 A。 mergedFromDirection：方向 AB 合并了方向 B。");
  });
});

describe("BottomDetailBar relationship tabs", () => {
  it("shows only tabs with real direct detail for a selected image", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    if (image.type !== "image") {
      throw new Error("seed image missing");
    }

    expect(
      getAvailableDetailTabs({
        workspace,
        object: image,
        relations: workspace.relations.filter(
          (relation) => relation.fromObjectId === image.id || relation.toObjectId === image.id
        ),
        decisionRecords: [],
        selectedCount: 1
      })
    ).toEqual(["信息", "版本", "关联"]);
  });

  it("renders direct source rows once per source object instead of repeating relation notes", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    if (image.type !== "image") {
      throw new Error("seed image missing");
    }
    const rows = buildSourceDetailRows({
      workspace,
      object: image,
      relations: [
        {
          id: "source-1",
          kind: "source",
          fromObjectId: "image-soft-rail-preview",
          toObjectId: image.id,
          note: "GrsAI 视觉发展使用该图作为本次明确来源。"
        },
        {
          id: "source-duplicate",
          kind: "source",
          fromObjectId: "image-soft-rail-preview",
          toObjectId: image.id,
          note: "GrsAI 视觉发展使用该图作为本次明确来源。"
        }
      ]
    });

    expect(rows).toEqual([
      {
        id: "image-soft-rail-preview",
        label: "起始图",
        title: "柔光轨道预览",
        meta: "预览"
      }
    ]);
  });

  it("shows a one-layer version view with parent, current object, and direct children", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    if (image.type !== "image") {
      throw new Error("seed image missing");
    }

    expect(
      buildVersionDetailRows({
        workspace,
        object: image,
        relations: workspace.relations.filter(
          (relation) => relation.fromObjectId === image.id || relation.toObjectId === image.id
        )
      })
    ).toEqual([
      {
        id: "image-soft-rail-preview",
        label: "父版本",
        title: "柔光轨道预览",
        meta: "预览"
      },
      {
        id: image.id,
        label: "当前对象",
        title: "柔光轨道 v2",
        meta: "后续默认参考"
      },
      {
        id: "image-rail-detail",
        label: "子版本",
        title: "转角连接与触感截面",
        meta: "细节研究"
      },
      {
        id: "image-night-scenario",
        label: "子版本",
        title: "夜间使用场景",
        meta: "场景视觉"
      }
    ]);
  });

  it("keeps association detail separate from source and version relationships", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    if (image.type !== "image") {
      throw new Error("seed image missing");
    }

    expect(
      buildRelatedDetailRows({
        workspace,
        object: image,
        relations: workspace.relations.filter(
          (relation) => relation.fromObjectId === image.id || relation.toObjectId === image.id
        )
      })
    ).toEqual([
      {
        id: "direction-soft-rail",
        label: "后续默认参考",
        title: "方向 A：柔光轨道",
        meta: "主方向"
      },
      {
        id: "delivery-board-a1",
        label: "已用于交付",
        title: "A1 展板 / 核心方案",
        meta: "交付准备"
      }
    ]);
  });
});

describe("BottomDetailBar document reader action", () => {
  it("enables reading only for a parsed file with an extract asset id", () => {
    expect(
      getDocumentReaderActionState({
        id: "file-1",
        type: "file",
        title: "brief.pdf",
        summary: "",
        createdBy: "user",
        visibility: "active",
        fileKind: "pdf",
        sourceLabel: "用户导入",
        parseStatus: "parsed",
        extractedAssetId: "asset-extract"
      },
      {
        "asset-extract": {
          id: "asset-extract",
          fileName: "brief.extract.txt",
          mimeType: "text/plain",
          size: 12,
          createdAt: "2026-07-01T00:00:00.000Z",
          storageKey: "blob:extract",
          sourceType: "documentExtract"
        }
      })
    ).toEqual({
      visible: true,
      disabled: false,
      label: "阅读解析内容",
      message: "打开本地解析文本阅读面板"
    });
  });

  it("keeps unavailable file states explicit instead of pretending they are readable", () => {
    const base = {
      id: "file-1",
      type: "file" as const,
      title: "brief.pdf",
      summary: "",
      createdBy: "user" as const,
      visibility: "active" as const,
      fileKind: "pdf" as const,
      sourceLabel: "用户导入"
    };

    expect(getDocumentReaderActionState({ ...base, parseStatus: "unparsed" })).toMatchObject({
      visible: true,
      disabled: true,
      message: "该文件尚未生成可读的本地解析文本"
    });
    expect(getDocumentReaderActionState({ ...base, parseStatus: "parsing" })).toMatchObject({
      disabled: true,
      message: "正在解析，完成后可阅读"
    });
    expect(getDocumentReaderActionState({ ...base, parseStatus: "failed", parseError: "扫描件没有文本" })).toMatchObject({
      disabled: true,
      message: "扫描件没有文本"
    });
    expect(getDocumentReaderActionState({ ...base, parseStatus: "parsed" })).toMatchObject({
      disabled: true,
      message: "本地解析文本资源不可用，当前无法阅读"
    });
    expect(
      getDocumentReaderActionState(
        { ...base, parseStatus: "parsed", extractedAssetId: "asset-original" },
        {
          "asset-original": {
            id: "asset-original",
            fileName: "brief.pdf",
            mimeType: "application/pdf",
            size: 12,
            createdAt: "2026-07-01T00:00:00.000Z",
            storageKey: "blob:original",
            sourceType: "originalFile"
          }
        }
      )
    ).toMatchObject({
      disabled: true,
      message: "本地解析文本资源不可用，当前无法阅读"
    });
  });
});

describe("BottomDetailBar selected object surface", () => {
  it("renders multi-reference images without a fabricated version tab or repeated provider notes", () => {
    const workspace = createInitialWorkspace();
    const generated = createGeneratedImageFromAsset(workspace, {
      asset: {
        id: "asset-bottom-detail-multi-source",
        fileName: "multi-source.png",
        mimeType: "image/png",
        size: 4096,
        createdAt: "2026-07-10T00:00:00.000Z",
        storageKey: "blob:asset-bottom-detail-multi-source",
        sourceType: "aiGeneratedImage"
      },
      generation: {
        modelId: "nano-banana-2-lite",
        modelLabel: "nano-banana-2-lite",
        aspectRatio: "1:1",
        prompt: "结合两张图生成说明预览",
        referenceObjectIds: ["image-soft-rail-v2", "image-rail-detail"],
        createdAt: "2026-07-10T00:00:00.000Z"
      },
      sourceObjectIds: ["image-soft-rail-v2", "image-rail-detail"]
    });
    const image = generated.workspace.objects[generated.createdObjectId];
    if (!image) {
      throw new Error("generated image missing");
    }
    const html = renderToStaticMarkup(
      createElement(BottomDetailBar, {
        workspace: generated.workspace,
        selectedObjects: [image],
        assets: generated.workspace.assets,
        hasPendingDesignDefinitionRevisionDraft: false,
        relations: generated.workspace.relations,
        directionLineage: generated.workspace.directionLineage,
        visualBranches: generated.workspace.visualBranches,
        decisionRecords: [],
        activeDesignTrace: null,
        onRenameVisualBranch: () => undefined,
        onArchiveVisualBranch: () => undefined,
        onRestoreVisualBranch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onSaveKeyConclusionFromResearchItem: () => undefined,
        onCopyItemToDraft: () => undefined,
        onContinueQuestion: () => undefined
      })
    );

    expect(html).toContain("来源");
    expect(html).toContain("关联");
    expect(html).not.toContain(">版本<");
    expect(html).not.toContain("GrsAI 视觉发展使用该图作为本次明确来源");
  });

  it("renders object information without canvas action tools", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(BottomDetailBar, {
        workspace,
        selectedObjects: [workspace.objects["image-soft-rail-v2"]],
        assets: workspace.assets,
        hasPendingDesignDefinitionRevisionDraft: false,
        relations: workspace.relations,
        directionLineage: workspace.directionLineage,
        visualBranches: workspace.visualBranches,
        decisionRecords: workspace.decisionRecords,
        activeDesignTrace: null,
        onRenameVisualBranch: () => undefined,
        onArchiveVisualBranch: () => undefined,
        onRestoreVisualBranch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onSaveKeyConclusionFromResearchItem: () => undefined,
        onCopyItemToDraft: () => undefined,
        onContinueQuestion: () => undefined
      })
    );

    expect(html).toContain("后续默认参考");
    expect(html).not.toContain("询问 AI");
    expect(html).not.toContain("隐藏");
    expect(html).not.toContain("删除");
    expect(html).not.toContain("设为后续默认参考");
  });

  it("renders parsed document reader as a real detail action", () => {
    const workspace = createInitialWorkspace();
    const parsedFile = {
      id: "file-brief",
      type: "file" as const,
      title: "brief.pdf",
      summary: "",
      createdBy: "user" as const,
      visibility: "active" as const,
      fileKind: "pdf" as const,
      sourceLabel: "用户导入",
      parseStatus: "parsed" as const,
      extractedAssetId: "asset-extract"
    };
    const html = renderToStaticMarkup(
      createElement(BottomDetailBar, {
        workspace,
        selectedObjects: [parsedFile],
        assets: {
          "asset-extract": {
            id: "asset-extract",
            fileName: "brief.extract.txt",
            mimeType: "text/plain",
            size: 12,
            createdAt: "2026-07-01T00:00:00.000Z",
            storageKey: "blob:extract",
            sourceType: "documentExtract"
          }
        },
        hasPendingDesignDefinitionRevisionDraft: false,
        relations: [],
        directionLineage: [],
        visualBranches: {},
        decisionRecords: [],
        activeDesignTrace: null,
        onRenameVisualBranch: () => undefined,
        onArchiveVisualBranch: () => undefined,
        onRestoreVisualBranch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onSaveKeyConclusionFromResearchItem: () => undefined,
        onCopyItemToDraft: () => undefined,
        onContinueQuestion: () => undefined
      })
    );

    expect(html).toContain("detail-inline-action");
    expect(html).toContain("阅读解析内容");
    expect(html).toContain("打开本地解析文本阅读面板");
  });

  it("keeps concept direction information compact instead of embedding full revision details", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-soft-rail"];
    if (direction.type !== "conceptDirection") {
      throw new Error("seed direction missing");
    }
    const detailedWorkspace = {
      ...workspace,
      directionRevisions: {
        ...workspace.directionRevisions,
        [direction.currentRevisionId]: {
          ...workspace.directionRevisions[direction.currentRevisionId]!,
          conceptStatement: "A stable concept statement for review.",
          strategy: "Use fixed nodes as a resilient warning network.",
          differentiators: ["Stable deployment", "Clear system boundary"],
          visualSignals: ["Vertical anchor", "Modular shell"],
          risks: ["Needs maintenance proof"],
          openQuestions: ["How often should the node be serviced?"]
        }
      }
    };

    const html = renderToStaticMarkup(
      createElement(BottomDetailBar, {
        workspace: detailedWorkspace,
        selectedObjects: [direction],
        assets: detailedWorkspace.assets,
        hasPendingDesignDefinitionRevisionDraft: false,
        relations: detailedWorkspace.relations,
        directionLineage: detailedWorkspace.directionLineage,
        visualBranches: detailedWorkspace.visualBranches,
        decisionRecords: detailedWorkspace.decisionRecords,
        activeDesignTrace: null,
        onRenameVisualBranch: () => undefined,
        onArchiveVisualBranch: () => undefined,
        onRestoreVisualBranch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onSaveKeyConclusionFromResearchItem: () => undefined,
        onCopyItemToDraft: () => undefined,
        onContinueQuestion: () => undefined
      })
    );

    expect(html).toContain(direction.summary);
    expect(html).toContain("状态：主方向");
    expect(html).toContain("修订 1");
    expect(html).not.toContain("A stable concept statement for review.");
    expect(html).not.toContain("Use fixed nodes as a resilient warning network.");
  });
});
