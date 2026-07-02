import { describe, expect, it } from "vitest";

import {
  buildDeliveryOutputMarkdown,
  createDeliveryOutputManifest,
  validateDeliveryOutputManifest,
  type CreateDeliveryOutputManifestResult,
  type DeliveryOutputManifest
} from "./deliveryOutput";
import { createBlankWorkspace } from "./workspace";
import type { AssetRecord, DeliveryObject, MorphoWorkspace } from "./types";

const NOW = "2026-07-02T09:00:00.000Z";

describe("delivery output manifest", () => {
  it("builds a ready output manifest only from the selected delivery package", () => {
    const workspace = createOutputFixtureWorkspace();

    const result = createDeliveryOutputManifest(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW
    });

    expect(result.status).toBe("warning");
    const manifest = expectManifest(result);
    expect(manifest.format).toBe("morpho-delivery-output");
    expect(manifest.outputVersion).toBe("1");
    expect(manifest.delivery.id).toBe("delivery-a");
    expect(manifest.sections.map((section) => section.id)).toEqual(["section-a-1", "section-a-2"]);
    expect(manifest.references.map((reference) => reference.referenceId)).toEqual([
      "ref-hero",
      "ref-detail",
      "ref-conclusion",
      "ref-link"
    ]);
    expect(manifest.references.some((reference) => reference.referenceId === "ref-other-delivery")).toBe(false);
    expect(manifest.assets).toHaveLength(2);
    expect(manifest.assets.find((asset) => asset.assetId === "asset-hero")?.referencedBy).toEqual([
      "ref-hero",
      "ref-detail"
    ]);
    expect(JSON.stringify(manifest)).not.toContain("storage:");

    const markdown = buildDeliveryOutputMarkdown(manifest);
    expect(markdown["delivery-outline.md"]).toContain("稳定引用");
    expect(markdown["delivery-outline.md"]).toContain("Stable hero snapshot");
    expect(markdown["captions-and-copy.md"]).toContain("Applied narrative");
    expect(markdown["captions-and-copy.md"]).toContain("Hero caption");
    expect(markdown["captions-and-copy.md"]).not.toContain("Draft narrative must stay pending");
    expect(markdown["gaps-and-next-steps.md"]).toContain("尚未应用，不代表当前交付内容");
    expect(markdown["gaps-and-next-steps.md"]).toContain("Draft narrative must stay pending");
    expect(markdown["source-map.json"]).toContain("Stable hero snapshot");
  });

  it("keeps stable reference snapshots when the live source object changed or disappeared", () => {
    const workspace = createOutputFixtureWorkspace();
    const changedSource = workspace.objects["image-hero"];
    if (!changedSource || changedSource.type !== "image") {
      throw new Error("Expected fixture image.");
    }
    const changed: MorphoWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        "image-hero": {
          ...changedSource,
          title: "Live source changed after stable reference",
          summary: "This must not replace the delivery snapshot."
        }
      }
    };
    const missingSource: MorphoWorkspace = {
      ...workspace,
      objects: Object.fromEntries(Object.entries(workspace.objects).filter(([id]) => id !== "image-hero"))
    };

    const changedResult = createDeliveryOutputManifest(changed, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW
    });
    const missingResult = createDeliveryOutputManifest(missingSource, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW
    });

    const changedManifest = expectManifest(changedResult);
    const missingManifest = expectManifest(missingResult);
    expect(changedManifest.references.find((reference) => reference.referenceId === "ref-hero")?.snapshot.title).toBe(
      "Stable hero snapshot"
    );
    expect(JSON.stringify(changedManifest)).not.toContain("Live source changed");
    expect(missingResult.status).toBe("warning");
    expect(missingManifest.integrity.diagnostics.some((diagnostic) => diagnostic.code === "delivery_output_source_unavailable")).toBe(
      true
    );
    expect(missingManifest.references.find((reference) => reference.referenceId === "ref-hero")?.snapshot.title).toBe(
      "Stable hero snapshot"
    );
  });

  it("classifies image, file, link, text and conclusion references without creating fake asset files", () => {
    const workspace = createOutputFixtureWorkspace();

    const result = createDeliveryOutputManifest(workspace, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW
    });

    expect(result.status).toBe("warning");
    const manifest = expectManifest(result);
    expect(manifest.references.find((reference) => reference.referenceId === "ref-hero")?.availability).toBe("missingBinary");
    expect(manifest.references.find((reference) => reference.referenceId === "ref-link")?.availability).toBe("referenceOnly");
    expect(manifest.references.find((reference) => reference.referenceId === "ref-conclusion")?.availability).toBe(
      "noBinaryExpected"
    );
    expect(manifest.references.find((reference) => reference.referenceId === "ref-link")?.outputAssetPath).toBeUndefined();
    expect(manifest.references.find((reference) => reference.referenceId === "ref-conclusion")?.outputAssetPath).toBeUndefined();
  });

  it("blocks missing targets, non-delivery targets, delivery without sections, and invalid manifests", () => {
    const workspace = createOutputFixtureWorkspace();
    const noSectionDelivery = workspace.objects["delivery-a"] as DeliveryObject;
    const withoutSections: MorphoWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        "delivery-a": {
          ...noSectionDelivery,
          sections: []
        }
      }
    };

    expect(createDeliveryOutputManifest(workspace, { deliveryObjectId: "missing", createdAt: NOW }).status).toBe("blocked");
    expect(createDeliveryOutputManifest(workspace, { deliveryObjectId: "image-hero", createdAt: NOW }).status).toBe("blocked");
    expect(createDeliveryOutputManifest(withoutSections, { deliveryObjectId: "delivery-a", createdAt: NOW }).status).toBe(
      "blocked"
    );

    const manifest = expectManifest(createDeliveryOutputManifest(workspace, { deliveryObjectId: "delivery-a", createdAt: NOW }));
    expect(validateDeliveryOutputManifest(manifest).status).toBe("ok");

    expect(validateDeliveryOutputManifest({ ...manifest, format: "morpho-project-bundle" }).status).toBe("failed");
    expect(validateDeliveryOutputManifest({ ...manifest, outputVersion: "2" }).status).toBe("failed");
    expect(
      validateDeliveryOutputManifest({
        ...manifest,
        references: [{ ...manifest.references[0], sectionId: "unknown-section" }]
      }).status
    ).toBe("failed");
    expect(
      validateDeliveryOutputManifest({
        ...manifest,
        assets: manifest.assets.map((asset) => ({ ...asset, outputAssetPath: "assets/duplicated.png" }))
      }).status
    ).toBe("failed");
    expect(
      validateDeliveryOutputManifest({
        ...manifest,
        leaked: { storageKey: "storage:secret" }
      }).status
    ).toBe("failed");
  });

  it("allows a text-only delivery with warnings for no stable material", () => {
    const base = createOutputFixtureWorkspace();
    const delivery = base.objects["delivery-a"] as DeliveryObject;
    const textOnly: MorphoWorkspace = {
      ...base,
      objects: {
        ...base.objects,
        [delivery.id]: {
          ...delivery,
          references: [],
          sections: [
            {
              id: "section-text-only",
              title: "Only narrative",
              order: 0,
              referenceIds: [],
              narrative: "The package still has a confirmed story.",
              createdAt: NOW,
              updatedAt: NOW
            }
          ]
        }
      }
    };

    const result = createDeliveryOutputManifest(textOnly, {
      deliveryObjectId: "delivery-a",
      createdAt: NOW
    });

    expect(result.status).toBe("warning");
    const manifest = expectManifest(result);
    expect(manifest.references).toEqual([]);
    expect(manifest.assets).toEqual([]);
    expect(manifest.integrity.diagnostics.some((diagnostic) => diagnostic.code === "delivery_output_no_references")).toBe(
      true
    );
    expect(buildDeliveryOutputMarkdown(manifest)["README.md"]).toContain("当前没有可带走的稳定素材");
  });
});

function expectManifest(result: CreateDeliveryOutputManifestResult): DeliveryOutputManifest {
  if (result.status === "blocked") {
    throw new Error(result.reason);
  }
  return result.manifest;
}

function createOutputFixtureWorkspace(): MorphoWorkspace {
  const base = createBlankWorkspace("project-output");
  const heroAsset = asset("asset-hero", "night-beacon.png", "image/png", "originalImage", 11);
  const fileAsset = asset("asset-file", "brief.pdf", "application/pdf", "originalFile", 10);
  const linkAsset: AssetRecord = {
    ...asset("asset-link", "source.url", "text/uri-list", "originalLink", 0),
    url: "https://example.com/reference",
    domain: "example.com"
  };

  return {
    ...base,
    project: {
      ...base.project,
      title: "Output Fixture",
      subtitle: "Delivery output boundary"
    },
    assets: {
      [heroAsset.id]: heroAsset,
      [fileAsset.id]: fileAsset,
      [linkAsset.id]: linkAsset,
      "asset-unrelated": asset("asset-unrelated", "unused.png", "image/png", "originalImage", 99)
    },
    objects: {
      ...base.objects,
      "image-hero": {
        id: "image-hero",
        type: "image",
        title: "Current hero object",
        summary: "Current source object summary",
        createdBy: "ai",
        visibility: "active",
        role: "primaryVisual",
        imageVariant: "rail",
        assetId: "asset-hero",
        createdAt: NOW,
        updatedAt: NOW
      },
      "file-brief": {
        id: "file-brief",
        type: "file",
        title: "Brief file",
        summary: "A referenced file.",
        createdBy: "user",
        visibility: "active",
        fileKind: "pdf",
        sourceLabel: "upload",
        assetId: "asset-file",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        size: 10,
        createdAt: NOW,
        updatedAt: NOW
      },
      "link-source": {
        id: "link-source",
        type: "link",
        title: "Reference link",
        summary: "A link-only source.",
        createdBy: "user",
        visibility: "active",
        url: "https://example.com/reference",
        domain: "example.com",
        assetId: "asset-link",
        createdAt: NOW,
        updatedAt: NOW
      },
      "conclusion-support": {
        id: "conclusion-support",
        type: "keyConclusion",
        title: "Stable conclusion",
        summary: "Conclusion summary",
        body: "Conclusion body for copy only.",
        createdBy: "user",
        visibility: "active",
        state: "active",
        confidence: "supported",
        sourceObjectIds: [],
        citationIds: [],
        confirmedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW
      },
      "delivery-a": {
        id: "delivery-a",
        type: "delivery",
        title: "A1 Output",
        summary: "Selected output package",
        createdBy: "user",
        visibility: "active",
        format: "board",
        sections: [
          {
            id: "section-a-1",
            title: "First section",
            purpose: "Explain the first section.",
            order: 1,
            referenceIds: ["ref-hero", "ref-detail"],
            narrative: "Applied narrative",
            createdAt: NOW,
            updatedAt: NOW
          },
          {
            id: "section-a-2",
            title: "Second section",
            order: 2,
            referenceIds: ["ref-conclusion", "ref-link"],
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        references: ["ref-hero", "ref-detail", "ref-conclusion", "ref-link"],
        gaps: [
          {
            id: "gap-open",
            label: "Need installation diagram",
            sectionId: "section-a-1",
            status: "open",
            origin: "manual",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        createdAt: NOW,
        updatedAt: NOW
      },
      "delivery-b": {
        id: "delivery-b",
        type: "delivery",
        title: "Other Output",
        summary: "Must not be exported when delivery-a is selected.",
        createdBy: "user",
        visibility: "active",
        format: "presentation",
        sections: [
          {
            id: "section-b-1",
            title: "Other section",
            order: 0,
            referenceIds: ["ref-other-delivery"],
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        references: ["ref-other-delivery"],
        gaps: [],
        createdAt: NOW,
        updatedAt: NOW
      }
    },
    deliveryReferences: {
      "ref-hero": {
        id: "ref-hero",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-1",
        order: 0,
        sourceObjectId: "image-hero",
        sourceAssetId: "asset-hero",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "image",
          title: "Stable hero snapshot",
          summary: "Frozen summary",
          previewAsset: { assetId: "asset-hero", alt: "Hero stable preview" }
        },
        editorial: {
          caption: "Hero caption",
          note: "Hero note"
        }
      },
      "ref-detail": {
        id: "ref-detail",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-1",
        order: 1,
        sourceObjectId: "file-brief",
        sourceAssetId: "asset-hero",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "file",
          title: "Stable detail snapshot",
          summary: "Uses the same asset for dedupe",
          previewAsset: { assetId: "asset-hero", alt: "Same asset" }
        }
      },
      "ref-conclusion": {
        id: "ref-conclusion",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-2",
        order: 0,
        sourceObjectId: "conclusion-support",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "keyConclusion",
          title: "Stable conclusion snapshot",
          body: "Stable conclusion body",
          bodyKind: "complete"
        }
      },
      "ref-link": {
        id: "ref-link",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-2",
        order: 1,
        sourceObjectId: "link-source",
        sourceAssetId: "asset-link",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "link",
          title: "Stable link snapshot",
          summary: "Link summary"
        }
      },
      "ref-other-delivery": {
        id: "ref-other-delivery",
        deliveryObjectId: "delivery-b",
        sectionId: "section-b-1",
        order: 0,
        sourceObjectId: "image-hero",
        sourceAssetId: "asset-file",
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "file",
          title: "Other package reference"
        }
      }
    },
    deliverySectionDrafts: {
      "draft-a": {
        id: "draft-a",
        deliveryObjectId: "delivery-a",
        sectionId: "section-a-1",
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        referenceIds: ["ref-hero"],
        sourceFingerprints: {},
        title: "Draft title",
        narrative: "Draft narrative must stay pending",
        captions: [{ referenceId: "ref-hero", caption: "Draft caption" }],
        suggestedGaps: [{ label: "Draft gap" }],
        status: "pending",
        createdAt: NOW,
        updatedAt: NOW
      }
    }
  };
}

function asset(
  id: string,
  fileName: string,
  mimeType: string,
  sourceType: AssetRecord["sourceType"],
  size: number
): AssetRecord {
  return {
    id,
    fileName,
    mimeType,
    sourceType,
    size,
    storageKey: `storage:${id}`,
    createdAt: NOW
  };
}
