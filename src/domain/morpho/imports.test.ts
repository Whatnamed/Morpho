import { describe, expect, it } from "vitest";

import { importAssetBackedObjects } from "./imports";
import { createBlankWorkspace } from "./workspace";

describe("Morpho import helpers", () => {
  it("uses intrinsic asset ratio when placing imported images", () => {
    const workspace = createBlankWorkspace("project-import-test");
    const result = importAssetBackedObjects(workspace, {
      assets: [
        {
          id: "asset-wide",
          fileName: "wide.png",
          mimeType: "image/png",
          size: 1000,
          createdAt: "2026-06-24T00:00:00.000Z",
          storageKey: "blob:asset-wide",
          sourceType: "originalImage",
          width: 1920,
          height: 1080,
          aspectRatio: 16 / 9
        }
      ],
      position: { x: 10, y: 20 }
    });

    const instance = result.workspace.canvas.instances.find((item) => item.objectId === result.objectIds[0]);

    expect(instance?.size).toEqual({ w: 320, h: 180 });
  });
});
