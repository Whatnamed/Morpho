import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";

import {
  applyResearchExtractionSelection,
  getResearchExtractionCardSize,
  getResearchExtractionItems,
  getResearchExtractionKey,
  getResearchExtractionRecommendationKeys
} from "./researchExtraction";

describe("researchExtraction", () => {
  it("creates canvas key conclusion cards for selected research items", () => {
    const workspace = createInitialWorkspace();
    const result = applyResearchExtractionSelection(workspace, "research-night-path", [
      getResearchExtractionKey("finding", 0),
      getResearchExtractionKey("opportunity", 0)
    ]);

    expect(result.createdCount).toBe(2);
    expect(result.activeObjectIds).toHaveLength(2);
    expect(result.workspace.canvas.instances.some((instance) => instance.objectId === result.activeObjectIds[0])).toBe(true);

    const items = getResearchExtractionItems(result.workspace, "research-night-path");
    expect(items.find((item) => item.key === getResearchExtractionKey("finding", 0))?.activeObjectId).toBe(result.activeObjectIds[0]);
    expect(items.find((item) => item.key === getResearchExtractionKey("opportunity", 0))?.activeObjectId).toBe(result.activeObjectIds[1]);
  });

  it("uses normalized research points for extraction items and created cards", () => {
    const workspace = createInitialWorkspace();
    const research = workspace.objects["research-night-path"];
    if (!research || research.type !== "research") {
      throw new Error("Expected demo research object.");
    }
    const workspaceWithPackagedResearch = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [research.id]: {
          ...research,
          findings: [
            "本地研究已经提供了较强的系统叙事框架：预测高风险海域 → 实时监听/识别 → 输出预警或管理建议。"
          ]
        }
      }
    };

    const items = getResearchExtractionItems(workspaceWithPackagedResearch, research.id);
    expect(items.find((item) => item.key === getResearchExtractionKey("finding", 0))?.text).toBe(
      "预测高风险海域 → 实时监听/识别 → 输出预警或管理建议。"
    );

    const result = applyResearchExtractionSelection(workspaceWithPackagedResearch, research.id, [
      getResearchExtractionKey("finding", 0)
    ]);
    const createdObject = result.workspace.objects[result.activeObjectIds[0]];
    expect(createdObject?.summary).toBe("预测高风险海域 → 实时监听/识别 → 输出预警或管理建议。");
  });

  it("spaces extracted cards by their actual card size", () => {
    const workspace = createInitialWorkspace();
    const result = applyResearchExtractionSelection(workspace, "research-night-path", [
      getResearchExtractionKey("finding", 0),
      getResearchExtractionKey("opportunity", 0),
      getResearchExtractionKey("constraint", 0)
    ]);

    const firstInstance = result.workspace.canvas.instances.find((instance) => instance.objectId === result.activeObjectIds[0]);
    const thirdInstance = result.workspace.canvas.instances.find((instance) => instance.objectId === result.activeObjectIds[2]);
    const expectedSize = getResearchExtractionCardSize(result.workspace.objects[result.activeObjectIds[0]]?.title ?? "");

    expect(firstInstance).toBeDefined();
    expect(thirdInstance).toBeDefined();
    expect(firstInstance?.size).toEqual(expectedSize);
    expect(thirdInstance?.position.y).toBeGreaterThanOrEqual((firstInstance?.position.y ?? 0) + (firstInstance?.size.h ?? 0) + 20);
  });

  it("uses compact key conclusion card height for short extracted points", () => {
    expect(getResearchExtractionCardSize("围绕“时空动态管理”建立概念亮点，有助于避免落入静态设备或空泛环保装置的常见表达。").h).toBeLessThanOrEqual(128);
  });

  it("recommends a balanced set of high-value research points for AI-assisted selection", () => {
    const workspace = createInitialWorkspace();
    const keys = getResearchExtractionRecommendationKeys(workspace, "research-night-path");

    expect(keys).toContain(getResearchExtractionKey("finding", 0));
    expect(keys).toContain(getResearchExtractionKey("opportunity", 0));
    expect(keys).toContain(getResearchExtractionKey("constraint", 0));
    expect(keys).toContain(getResearchExtractionKey("openQuestion", 0));
    expect(keys.length).toBeLessThanOrEqual(6);
  });

  it("does not duplicate cards when the same research items are applied again", () => {
    const workspace = createInitialWorkspace();
    const first = applyResearchExtractionSelection(workspace, "research-night-path", [getResearchExtractionKey("finding", 0)]);
    const second = applyResearchExtractionSelection(first.workspace, "research-night-path", [getResearchExtractionKey("finding", 0)]);

    expect(second.createdCount).toBe(0);
    expect(second.restoredCount).toBe(0);
    expect(second.activeObjectIds).toEqual(first.activeObjectIds);
  });

  it("hides previously extracted cards and restores them when selected again", () => {
    const workspace = createInitialWorkspace();
    const selectedKey = getResearchExtractionKey("finding", 0);
    const first = applyResearchExtractionSelection(workspace, "research-night-path", [selectedKey]);
    const objectId = first.activeObjectIds[0];

    const removed = applyResearchExtractionSelection(first.workspace, "research-night-path", []);
    expect(removed.hiddenCount).toBe(1);
    expect(removed.workspace.objects[objectId]?.visibility).toBe("hidden");

    const restored = applyResearchExtractionSelection(removed.workspace, "research-night-path", [selectedKey]);
    expect(restored.createdCount).toBe(0);
    expect(restored.restoredCount).toBe(1);
    expect(restored.workspace.objects[objectId]?.visibility).toBe("active");
  });
});
