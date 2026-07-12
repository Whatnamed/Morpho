import { describe, expect, it } from "vitest";

import { buildAgentToolActivityDescriptor, sanitizeAgentActivityDetail } from "./agentToolActivity";

describe("Agent tool activity descriptors", () => {
  it("prefers a natural-language search reason and falls back to the real query", () => {
    expect(
      buildAgentToolActivityDescriptor({
        name: "search_web_evidence",
        args: { reason: "确认现有流式实现与官方事件协议", queries: ["Responses reasoning summary"] }
      }).label
    ).toBe("确认现有流式实现与官方事件协议");

    expect(
      buildAgentToolActivityDescriptor({
        name: "search_web_evidence",
        args: { reason: "", queries: ["Responses reasoning summary"] }
      }).label
    ).toBe("搜索 Responses reasoning summary");
  });

  it("uses real selected counts and generation item counts", () => {
    expect(
      buildAgentToolActivityDescriptor(
        { name: "read_selected_context", args: {} },
        { selectedObjects: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] }
      ).label
    ).toBe("读取当前选择的 3 个对象");
    expect(
      buildAgentToolActivityDescriptor({
        name: "generate_visuals",
        args: {
          kind: "visualDevelopment",
          items: [
            { id: "one", title: "一", purpose: "一", prompt: "一", referenceObjectIds: [], role: "conceptImage" },
            { id: "two", title: "二", purpose: "二", prompt: "二", referenceObjectIds: [], role: "conceptImage" }
          ]
        }
      }).label
    ).toBe("生成 2 张视觉方向");
  });

  it("uses a safe proposal title without exposing IDs or raw arguments", () => {
    const workspace = { artifactProposals: { "proposal-1": { title: "柔光轨道" } } };
    expect(
      buildAgentToolActivityDescriptor(
        {
          name: "revise_selected_proposal_draft",
          args: {
            proposalId: "proposal-1",
            proposalType: "designDefinition",
            title: "柔光轨道",
            summary: "summary",
            projectGoal: "goal",
            targetUsers: [],
            primaryScenarios: [],
            coreProblem: "problem",
            designPrinciples: [],
            constraints: [],
            avoidDirections: [],
            opportunities: [],
            openQuestions: []
          }
        },
        { workspace }
      ).label
    ).toBe("更新「柔光轨道」方案草稿");
  });

  it("removes raw JSON, paths, and provider HTML from failure details", () => {
    expect(sanitizeAgentActivityDetail('{"secret":"value"}')).toBeUndefined();
    expect(sanitizeAgentActivityDetail("C:\\private\\prompt.txt failed")).toBe("相关资料 failed");
    expect(sanitizeAgentActivityDetail("<!doctype html><html>bad gateway</html>")).toBeUndefined();
  });
});
