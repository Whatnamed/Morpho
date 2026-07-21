import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "../morpho/workspace";
import type { ImageObject, MorphoWorkspace } from "../morpho/types";
import { compileImagePrompt, compileVisualGenerationPlan, IMAGE_PROMPT_CONTRACT_VERSION } from "./imagePromptCompiler";
import { resolveVisualReferences } from "./visualReferenceResolver";
import type { VisualIntentItem } from "./types";

describe("Image Prompt Compiler and reference resolver", () => {
  it("resolves explicit, selected, lineage, default, and project references deterministically with omissions", () => {
    const workspace = withImageAssets(createInitialWorkspace());
    const resolution = resolveVisualReferences({
      workspace,
      intent: intent({ requestedReferenceObjectIds: ["image-night-scenario", "image-night-scenario"] }),
      selectedSourceObjectIds: ["image-rail-detail"],
      projectReferenceObjectIds: ["image-path-reference"],
      providerLimit: 2
    });

    expect(resolution.resolvedObjectIds).toEqual(["image-night-scenario", "image-rail-detail"]);
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ objectId: "image-night-scenario", reason: "userExplicit", included: true })
    );
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ objectId: "image-night-scenario", omissionReason: "duplicate" })
    );
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ objectId: "image-soft-rail-v2", reason: "directParent", omissionReason: "providerLimit" })
    );
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ objectId: "image-soft-rail-v2", reason: "directionRepresentative", omissionReason: "duplicate" })
    );
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ objectId: "image-path-reference", reason: "projectReference", omissionReason: "providerLimit" })
    );
  });

  it("honors default-reference exclusion and retains explicit cross-direction references", () => {
    const workspace = withImageAssets(createInitialWorkspace());
    const resolution = resolveVisualReferences({
      workspace,
      intent: intent({
        requestedReferenceObjectIds: ["image-support-island-preview"],
        excludeDefaultReference: true
      }),
      selectedSourceObjectIds: [],
      providerLimit: 4
    });

    expect(resolution.resolvedObjectIds).toContain("image-support-island-preview");
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({
        objectId: "image-support-island-preview",
        reason: "userExplicit",
        included: true,
        crossDirection: true,
        retentionReason: expect.any(String)
      })
    );
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ objectId: "image-soft-rail-v2", omissionReason: "defaultExcluded" })
    );
  });

  it("compiles current user input, Design Brief, direction revision, role policy, and preservation boundaries", () => {
    const workspace = withImageAssets(createInitialWorkspace());
    const visualIntent = intent({
      title: "局部修改转角节点",
      purpose: "只改转角连接，继续发展当前方案",
      changeGoals: ["让连接节点更一体化"],
      preserve: ["主体比例", "低位连续导光"],
      allowToChange: ["连接件外形"],
      role: "detailStudy"
    });
    const referenceResolution = resolveVisualReferences({
      workspace,
      intent: visualIntent,
      selectedSourceObjectIds: ["image-soft-rail-v2"]
    });
    const compiled = compileImagePrompt({
      workspace,
      intent: visualIntent,
      referenceResolution,
      modelId: "gpt-image-2",
      currentUserInput: "这次只改转角，不要改变扶手主体比例。"
    });

    expect(compiled.promptContractVersion).toBe(IMAGE_PROMPT_CONTRACT_VERSION);
    expect(compiled.prompt).toContain("这次只改转角，不要改变扶手主体比例");
    expect(compiled.prompt).toContain("任务模板：定向修改");
    expect(compiled.editMode).toBe("directedEdit");
    expect(compiled.prompt).toContain("图片角色：关键细节");
    expect(compiled.prompt).toContain("主体比例");
    expect(compiled.prompt).toContain("当前 Design Brief");
    expect(compiled.prompt).toContain("目标方向：方向 A：柔光轨道");
    expect(compiled.prompt).toContain("模型适配");
  });

  it("compiles complete 3-image and 12-image plans without treating quick presets as a backend cap", () => {
    const workspace = withImageAssets(createInitialWorkspace());
    const three = compileVisualGenerationPlan({
      workspace,
      kind: "visualDevelopment",
      intents: Array.from({ length: 3 }, (_, index) => intent({ id: `development-${index + 1}` })),
      selectedSourceObjectIds: ["image-soft-rail-v2"],
      modelId: "gpt-image-2",
      currentUserInput: "生成 3 张继续发展图"
    });
    const twelve = compileVisualGenerationPlan({
      workspace,
      kind: "directionPreview",
      intents: Array.from({ length: 12 }, (_, index) => intent({ id: `preview-${index + 1}`, role: "preview" })),
      selectedSourceObjectIds: [],
      modelId: "nano-banana-2-lite",
      currentUserInput: "四个方向，每方向 3 张"
    });

    expect(three.items).toHaveLength(3);
    expect(twelve.items).toHaveLength(12);
    expect(twelve.items.every((item) => item.role === "conceptImage")).toBe(true);
    expect(three.items.every((item) => item.visualIntent && item.referenceResolution && item.promptContractVersion)).toBe(true);
  });

  it("uses distinct task templates and model adapters for each visual role", () => {
    const workspace = withImageAssets(createInitialWorkspace());
    const roles = [
      ["preview", "任务模板：方向预览"],
      ["sceneVisual", "任务模板：使用场景"],
      ["cmfStudy", "任务模板：CMF 研究"],
      ["detailStudy", "任务模板：细节研究"]
    ] as const;
    for (const [role, expectedTemplate] of roles) {
      const visualIntent = intent({ title: `生成${role}`, purpose: "验证表达", changeGoals: ["验证表达"], role });
      const referenceResolution = resolveVisualReferences({
        workspace,
        intent: visualIntent,
        selectedSourceObjectIds: ["image-soft-rail-v2"]
      });
      expect(
        compileImagePrompt({
          workspace,
          intent: visualIntent,
          referenceResolution,
          modelId: "gpt-image-2",
          currentUserInput: "按当前要求生成"
        }).prompt
      ).toContain(expectedTemplate);
    }

    const visualIntent = intent();
    const referenceResolution = resolveVisualReferences({
      workspace,
      intent: visualIntent,
      selectedSourceObjectIds: ["image-soft-rail-v2"]
    });
    const gptPrompt = compileImagePrompt({
      workspace,
      intent: visualIntent,
      referenceResolution,
      modelId: "gpt-image-2",
      currentUserInput: "继续发展"
    }).prompt;
    const nanoPrompt = compileImagePrompt({
      workspace,
      intent: visualIntent,
      referenceResolution,
      modelId: "nano-banana-2-lite",
      currentUserInput: "继续发展"
    }).prompt;

    expect(gptPrompt).toContain("使用明确的空间、材质、光线");
    expect(nanoPrompt).toContain("保持指令紧凑直接");
    expect(gptPrompt).not.toBe(nanoPrompt);
  });
});

function intent(overrides: Partial<VisualIntentItem> = {}): VisualIntentItem {
  return {
    id: "intent-1",
    targetDirectionId: "direction-soft-rail",
    title: "继续发展柔光轨道",
    purpose: "保持主体结构并深化连接",
    requestedReferenceObjectIds: [],
    changeGoals: ["深化连接"],
    preserve: ["主体结构"],
    allowToChange: ["局部连接"],
    productForm: ["连续扶手轨道"],
    materialsAndCmf: ["暖灰低反光表面"],
    environmentAndLighting: ["低照度家居环境"],
    avoid: ["医疗器械感"],
    role: "conceptImage",
    ...overrides
  };
}

function withImageAssets(workspace: MorphoWorkspace): MorphoWorkspace {
  const ids = [
    "image-night-scenario",
    "image-rail-detail",
    "image-soft-rail-v2",
    "image-path-reference",
    "image-support-island-preview"
  ];
  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      ...Object.fromEntries(
        ids.map((id) => {
          const object = workspace.objects[id];
          if (!object || object.type !== "image") {
            throw new Error(`Missing image fixture ${id}`);
          }
          return [id, { ...object, assetId: `asset-${id}` } satisfies ImageObject];
        })
      )
    }
  };
}
