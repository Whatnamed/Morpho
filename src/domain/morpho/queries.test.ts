import { describe, expect, it } from "vitest";

import type { DocumentFragmentObject, MorphoWorkspace, ObjectVisibility } from "./types";
import { createBlankWorkspace, createDeliveryReference, createInitialWorkspace, hideObject } from "./workspace";
import { importUrlObject } from "./imports";
import { getWorkspaceAssetItems, searchWorkspace } from "./queries";

describe("Morpho workspace query helpers", () => {
  it("searches hidden objects and marks them without adding them to renderable canvas content", () => {
    const workspace = hideObject(createInitialWorkspace(), "image-soft-rail-v2");

    const results = searchWorkspace(workspace, "柔光轨道 v2");

    expect(results.some((result) => result.kind === "object" && result.objectId === "image-soft-rail-v2" && result.hidden)).toBe(
      true
    );
  });

  it("searches stable delivery reference snapshots after source changes", () => {
    const created = createDeliveryReference(createInitialWorkspace(), {
      deliveryObjectId: "delivery-board-a1",
      sourceObjectId: "insight-continuous-support",
      caption: "交付摘要：连续支持比单点扶手更符合真实动作路径。"
    });

    if (created.status !== "updated") {
      throw new Error("Expected delivery reference creation.");
    }

    const results = searchWorkspace(created.workspace, "交付摘要");

    expect(results.some((result) => result.kind === "deliveryReference" && result.referenceId === created.deliveryReferenceId)).toBe(
      true
    );
  });

  it("keeps search result summaries user-facing without internal ids or enum fields", () => {
    const results = searchWorkspace(createInitialWorkspace(), "v2");
    const imageResult = results.find((result) => result.kind === "object" && result.objectId === "image-soft-rail-v2");

    expect(imageResult?.summary).not.toContain("primaryVisual");
    expect(imageResult?.summary).not.toContain("direction-soft-rail");
    expect(imageResult?.summary).not.toContain("visual-branch");
  });

  it("does not match private object ids as search terms", () => {
    const results = searchWorkspace(createInitialWorkspace(), "visual-branch-soft-rail-core");

    expect(results).toEqual([]);
  });

  it("finds a document fragment by Chinese body text and reports its source document", () => {
    const workspace = withDocumentFragment(createInitialWorkspace(), {
      body: "夜间起夜时，走廊照明的第一段亮度必须低于卧室阈值，否则使用者会被强光唤醒。"
    });

    const result = searchWorkspace(workspace, "走廊照明").find(
      (item) => item.kind === "object" && item.objectId === "document-fragment-test"
    );

    expect(result).toBeDefined();
    expect(result?.kind === "object" ? result.source : undefined).toMatchObject({
      fileObjectId: "file-course-brief",
      fileTitle: "课程要求.pdf",
      fileName: "课程要求.pdf",
      status: "active"
    });
  });

  it("finds a document fragment by English body text, source title, and source file name", () => {
    const workspace = withDocumentFragment(createInitialWorkspace(), {
      body: "Night lighting must stay below the bedroom wake threshold.",
      fileTitle: "Course brief",
      fileName: "course-brief.pdf"
    });

    for (const query of ["wake threshold", "Course brief", "course-brief.pdf"]) {
      expect(
        searchWorkspace(workspace, query).some(
          (item) => item.kind === "object" && item.objectId === "document-fragment-test"
        )
      ).toBe(true);
    }
  });

  it("keeps a hidden document fragment searchable, marked hidden, and restorable", () => {
    const workspace = withDocumentFragment(createInitialWorkspace(), {
      body: "低施工改造要求所有安装点位避开承重墙。",
      visibility: "hidden"
    });

    const result = searchWorkspace(workspace, "承重墙").find(
      (item) => item.kind === "object" && item.objectId === "document-fragment-test"
    );

    expect(result).toMatchObject({ kind: "object", hidden: true });
  });

  it("reports an unavailable fragment source instead of offering a broken source location", () => {
    const base = withDocumentFragment(createInitialWorkspace(), { body: "夜间照明阈值说明。" });
    const hiddenSource = hideObject(base, "file-course-brief");
    const missingSource = withDocumentFragment(createInitialWorkspace(), {
      body: "夜间照明阈值说明。",
      fileObjectId: "file-removed"
    });

    const hiddenResult = searchWorkspace(hiddenSource, "照明阈值").find(
      (item) => item.kind === "object" && item.objectId === "document-fragment-test"
    );
    const missingResult = searchWorkspace(missingSource, "照明阈值").find(
      (item) => item.kind === "object" && item.objectId === "document-fragment-test"
    );

    expect(hiddenResult?.kind === "object" ? hiddenResult.source?.status : undefined).toBe("hidden");
    expect(missingResult?.kind === "object" ? missingResult.source?.status : undefined).toBe("missing");
  });

  it("summarizes a long fragment body around the match instead of dumping the whole body", () => {
    const body = `${"前置说明。".repeat(200)}关键约束是夜间亮度上限。${"后续说明。".repeat(200)}`;
    const workspace = withDocumentFragment(createInitialWorkspace(), { body });

    const result = searchWorkspace(workspace, "夜间亮度上限").find(
      (item) => item.kind === "object" && item.objectId === "document-fragment-test"
    );

    expect(result?.summary).toContain("夜间亮度上限");
    expect(result?.summary.length).toBeLessThan(200);
    expect(result?.summary.length).toBeLessThan(body.length);
  });

  it("lists original link assets without turning process objects into assets", () => {
    const imported = importUrlObject(createBlankWorkspace("project-assets"), {
      url: "https://example.com/reference",
      position: { x: 0, y: 0 }
    }).workspace;

    const items = getWorkspaceAssetItems(imported);

    expect(items).toHaveLength(1);
    expect(items[0]?.asset.sourceType).toBe("originalLink");
    expect(items[0]?.objects[0]?.type).toBe("link");
  });
});

function withDocumentFragment(
  workspace: MorphoWorkspace,
  input: {
    body: string;
    visibility?: ObjectVisibility;
    fileObjectId?: string;
    fileTitle?: string;
    fileName?: string;
  }
): MorphoWorkspace {
  const fragment: DocumentFragmentObject = {
    id: "document-fragment-test",
    type: "documentFragment",
    title: "课程要求片段",
    summary: "课程要求.pdf / parsed blocks 1-2",
    body: input.body,
    createdBy: "user",
    visibility: input.visibility ?? "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    source: {
      fileObjectId: input.fileObjectId ?? "file-course-brief",
      fileTitle: input.fileTitle ?? "课程要求.pdf",
      fileName: input.fileName ?? "课程要求.pdf",
      sourceExtractAssetId: "asset-course-brief-extract",
      startOffset: 0,
      endOffset: input.body.length,
      blockIds: ["block-1", "block-2"]
    }
  };

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [fragment.id]: fragment
    }
  };
}
