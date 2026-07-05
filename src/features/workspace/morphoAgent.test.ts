import { describe, expect, it } from "vitest";

import { parseMorphoAgentToolArguments, type AgentFunctionCall } from "./morphoAgent";

describe("Morpho agent tool argument validation", () => {
  it("normalizes direction preview visual roles before operation validation", () => {
    const parsed = parseMorphoAgentToolArguments(makeCall("generate_visuals", {
      kind: "directionPreview",
      items: [
        {
          id: "preview-1",
          targetDirectionId: "direction-soft-rail",
          title: "轻量家居化预览",
          purpose: "验证更轻、更模块化的表达",
          prompt: "A warm product design preview for a modular night support rail.",
          referenceObjectIds: ["direction-soft-rail"],
          role: "preview"
        }
      ]
    }));

    expect(parsed).toEqual({
      name: "generate_visuals",
      args: {
        kind: "directionPreview",
        items: [
          {
            id: "preview-1",
            targetDirectionId: "direction-soft-rail",
            title: "轻量家居化预览",
            purpose: "验证更轻、更模块化的表达",
            prompt: "A warm product design preview for a modular night support rail.",
            referenceObjectIds: ["direction-soft-rail"],
            role: "conceptImage"
          }
        ]
      }
    });
  });

  it("rejects undeclared arguments before execution", () => {
    expect(() =>
      parseMorphoAgentToolArguments(makeCall("request_confirmation", {
        action: "setDefaultReference",
        targetObjectId: "image-a",
        reason: "用户要求替换后续默认参考。",
        impact: "后续生成会默认参考该图。",
        hiddenWrite: true
      }))
    ).toThrow("未声明参数");
  });

  it("rejects invalid bounded search queries", () => {
    expect(() =>
      parseMorphoAgentToolArguments(makeCall("search_web_evidence", {
        queries: ["a", "b", "c", "d"],
        reason: "补充现实限制。"
      }))
    ).toThrow("最多允许 3 项");
  });

  it("rejects unsupported tool names", () => {
    expect(() => parseMorphoAgentToolArguments(makeCall("delete_everything", {}))).toThrow("未支持的 Agent 工具");
  });
});

function makeCall(name: string, args: unknown): AgentFunctionCall {
  return {
    id: `fc-${name}`,
    callId: `call-${name}`,
    name,
    argumentsText: JSON.stringify(args)
  };
}
