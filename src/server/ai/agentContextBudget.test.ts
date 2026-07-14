import { describe, expect, it } from "vitest";

import type { OpenAiCompatibleResponseRequest, ResponseTool } from "./openaiCompatibleProvider";
import {
  classifyAgentContextPressure,
  executeAgentRequestWithContextBudget,
  estimateAgentContextTokens,
  prepareAgentContextRequest,
  type AgentContextLimits
} from "./agentContextBudget";

const limits: AgentContextLimits = {
  windowTokens: 372_000,
  prepareTokens: 200_000,
  compactTokens: 300_000,
  targetTokens: 16_000
};

function message(role: "system" | "user" | "assistant", text: string) {
  return {
    role,
    content: [{ type: "input_text" as const, text }]
  };
}

describe("agent context budget", () => {
  it("classifies normal, prepare, and compact pressure at the configured thresholds", () => {
    expect(classifyAgentContextPressure(199_999, limits)).toBe("normal");
    expect(classifyAgentContextPressure(200_000, limits)).toBe("prepare");
    expect(classifyAgentContextPressure(299_999, limits)).toBe("prepare");
    expect(classifyAgentContextPressure(300_000, limits)).toBe("compact");
  });

  it("counts image inputs with a fixed token reserve instead of their base64 character length", () => {
    const smallDataUrlRequest: OpenAiCompatibleResponseRequest = {
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "分析这张图" },
            { type: "input_image", image_url: "data:image/png;base64,AAAA" }
          ]
        }
      ]
    };
    const largeDataUrlRequest: OpenAiCompatibleResponseRequest = {
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "分析这张图" },
            { type: "input_image", image_url: `data:image/png;base64,${"A".repeat(500_000)}` }
          ]
        }
      ]
    };

    expect(estimateAgentContextTokens(smallDataUrlRequest)).toBe(
      estimateAgentContextTokens(largeDataUrlRequest)
    );
  });

  it("includes tool schemas in the estimated input budget", () => {
    const request: OpenAiCompatibleResponseRequest = {
      input: [message("user", "继续")]
    };
    const tools: ResponseTool[] = [
      {
        type: "function",
        name: "large_tool",
        description: "x".repeat(12_000),
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "y".repeat(12_000) }
          }
        }
      }
    ];

    expect(estimateAgentContextTokens({ ...request, tools })).toBeGreaterThan(
      estimateAgentContextTokens(request)
    );
  });

  it("keeps every conversation message and only compacts completed old tool outputs in an emergency", () => {
    const request: OpenAiCompatibleResponseRequest = {
      input: [
        message("system", "系统规则"),
        message("user", "旧问题一"),
        message("assistant", "旧回答一"),
        message("user", "旧问题二"),
        message("assistant", "旧回答二"),
        message("user", "旧问题三"),
        message("assistant", "旧回答三"),
        message("user", "当前问题"),
        {
          type: "function_call",
          id: "call-item-old",
          call_id: "call-old",
          name: "search_web_evidence",
          arguments: "{}"
        },
        {
          type: "function_call_output",
          call_id: "call-old",
          output: JSON.stringify({ sources: ["x".repeat(50_000)] })
        },
        {
          type: "function_call",
          id: "call-item-current",
          call_id: "call-current",
          name: "read_selected_context",
          arguments: "{}"
        },
        {
          type: "function_call",
          id: "call-item-current-2",
          call_id: "call-current-2",
          name: "read_selected_context",
          arguments: "{}"
        },
        {
          type: "function_call_output",
          call_id: "call-current",
          output: JSON.stringify({
            status: "ready",
            detail: `${"z".repeat(2_000)}FIRST_CURRENT_TAIL_MARKER`
          })
        },
        {
          type: "function_call_output",
          call_id: "call-current-2",
          output: JSON.stringify({ status: "ready", detail: "SECOND_CURRENT_TAIL_MARKER" })
        }
      ]
    };

    const prepared = prepareAgentContextRequest(request, {
      limits: {
        windowTokens: 2_000,
        prepareTokens: 500,
        compactTokens: 1_000,
        targetTokens: 300
      },
      force: "emergency"
    });

    expect(prepared.pressure).toBe("compact");
    expect(JSON.stringify(prepared.request.input)).toContain("系统规则");
    expect(JSON.stringify(prepared.request.input)).toContain("当前问题");
    expect(JSON.stringify(prepared.request.input)).toContain("旧问题一");
    expect(JSON.stringify(prepared.request.input)).toContain("旧问题三");
    expect(JSON.stringify(prepared.request.input)).toContain("call-current");
    expect(JSON.stringify(prepared.request.input)).toContain("FIRST_CURRENT_TAIL_MARKER");
    expect(JSON.stringify(prepared.request.input)).toContain("SECOND_CURRENT_TAIL_MARKER");

    const oldOutput = prepared.request.input.find(
      (item) => "type" in item && item.type === "function_call_output" && item.call_id === "call-old"
    );
    expect(oldOutput).toMatchObject({
      type: "function_call_output",
      call_id: "call-old"
    });
    expect(
      oldOutput && "output" in oldOutput ? String(oldOutput.output).length : 0
    ).toBeLessThan(2_000);
    expect(prepared.compacted).toBe(true);
    expect(prepared.checkpointRequested).toBe(false);
  });

  it("uses a provider usage baseline when it is higher than the local estimate", () => {
    const request: OpenAiCompatibleResponseRequest = {
      input: [message("system", "规则"), message("user", "继续")]
    };

    const prepared = prepareAgentContextRequest(request, {
      limits,
      baselineInputTokens: 220_000
    });

    expect(prepared.estimatedInputTokens).toBe(220_000);
    expect(prepared.pressure).toBe("prepare");
  });

  it("retries a provider context limit exactly once with an emergency-compacted request", async () => {
    const request: OpenAiCompatibleResponseRequest = {
      input: [
        message("system", "系统规则"),
        message("user", "很早的问题"),
        message("assistant", "很早的回答"),
        message("user", "最近的问题"),
        message("assistant", "最近的回答"),
        message("user", "当前问题"),
        {
          type: "function_call",
          id: "old-call-item",
          call_id: "old-call",
          name: "search_web_evidence",
          arguments: "{}"
        },
        { type: "function_call_output", call_id: "old-call", output: "x".repeat(20_000) },
        {
          type: "function_call",
          id: "latest-call-item",
          call_id: "latest-call",
          name: "read_selected_context",
          arguments: "{}"
        },
        { type: "function_call_output", call_id: "latest-call", output: "latest result" }
      ]
    };
    const seenRequests: OpenAiCompatibleResponseRequest[] = [];

    const execution = await executeAgentRequestWithContextBudget(request, {
      limits,
      execute: async (preparedRequest) => {
        seenRequests.push(preparedRequest);
        if (seenRequests.length === 1) {
          throw Object.assign(new Error("too long"), { code: "context_limit" });
        }
        return {
          responseId: "response-2",
          outputText: "完成",
          functionCalls: [],
          citations: [],
          webSearchCallCount: 0,
          outputItems: []
        };
      }
    });

    expect(seenRequests).toHaveLength(2);
    expect(JSON.stringify(seenRequests[1]?.input)).toContain("很早的问题");
    expect(JSON.stringify(seenRequests[1]?.input)).toContain("当前问题");
    expect(JSON.stringify(seenRequests[1]?.input)).toContain("latest result");
    expect(execution.context.retried).toBe(true);
    expect(execution.context.checkpointRequested).toBe(false);
  });

  it("does not retry a non-context provider failure", async () => {
    let attempts = 0;
    await expect(
      executeAgentRequestWithContextBudget(
        {
          input: [message("system", "规则"), message("user", "当前问题")]
        },
        {
          limits,
          execute: async () => {
            attempts += 1;
            throw Object.assign(new Error("network"), { code: "network" });
          }
        }
      )
    ).rejects.toThrow("network");
    expect(attempts).toBe(1);
  });
});
