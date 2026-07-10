import { describe, expect, it } from "vitest";

import {
  getDefaultGrsImageModel,
  getSelectableGrsImageModels,
  getExecutableGrsImageModels,
  resolveGrsImageModelSettings
} from "./grsImageModels";

describe("GrsAI image model catalog", () => {
  it("defaults to the configured lightweight image generation model from the static catalog", () => {
    const defaultModel = getDefaultGrsImageModel();

    expect(defaultModel.id).toBe("nano-banana-2-lite");
    expect(defaultModel.status).toBe("available");
    expect(defaultModel.points).toBe(440);
  });

  it("does not expose text or maintenance models as selectable image generation models", () => {
    const selectableIds = getSelectableGrsImageModels().map((model) => model.id);

    expect(selectableIds).toContain("nano-banana-2-lite");
    expect(selectableIds).toContain("nano-banana-fast");
    expect(selectableIds).not.toContain("gpt-image-2-vip");
    expect(selectableIds).not.toContain("gpt-5.5");
    expect(selectableIds).not.toContain("gpt-5.4");
    expect(selectableIds).not.toContain("gemini-3-flash");
  });

  it("keeps documented-only models out of executable UI options unless explicitly enabled", () => {
    const executableIds = getExecutableGrsImageModels().map((model) => model.id);

    expect(executableIds).toContain("nano-banana-2-lite");
    expect(executableIds).toContain("nano-banana-fast");
    expect(executableIds).not.toContain("gpt-image-2");
    expect(getDefaultGrsImageModel().capabilityStatus).toBe("documented");
  });

  it("normalizes supported size options per model without inventing unsupported controls", () => {
    expect(resolveGrsImageModelSettings("nano-banana-fast", undefined).sizeOption).toBeUndefined();
    expect(resolveGrsImageModelSettings("nano-banana-2-lite", undefined).sizeOption).toBeUndefined();
    expect(resolveGrsImageModelSettings("nano-banana-2", undefined).sizeOption).toBe("1K");
    expect(resolveGrsImageModelSettings("nano-banana-2", "4K").sizeOption).toBe("4K");
    expect(resolveGrsImageModelSettings("nano-banana-2-4k-cl", "1K").sizeOption).toBe("4K");
  });
});
