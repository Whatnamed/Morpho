import { describe, expect, it } from "vitest";

import { shouldUseGrsImageTask } from "./aiTaskRouting";

describe("workspace AI task routing", () => {
  it("routes explicit visual generation prompts to GrsAI without requiring a selected image", () => {
    expect(shouldUseGrsImageTask("基于这个方向生成一张夜间使用场景图", [])).toBe(true);
  });

  it("keeps non-generative image discussion on the MiMo text path", () => {
    expect(shouldUseGrsImageTask("分析这张图有哪些问题", ["image"])).toBe(false);
  });

  it("does not route generic text generation to GrsAI", () => {
    expect(shouldUseGrsImageTask("生成一段交付说明文字", [])).toBe(false);
  });
});
