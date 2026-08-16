import { describe, expect, it } from "vitest";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import type { ResponseMessageInput } from "./openaiCompatibleProvider";

import {
  buildAPlusAgentProviderContract,
  buildAPlusExternalToolActionClaims,
  hashAPlusAgentExternalRequest,
  hashAPlusExternalToolActionClaim,
  normalizeAPlusProviderToolCalls,
  parseAPlusAgentProviderRequest
} from "./agentTurnProviderRequest";

function systemMessageItems(items: readonly unknown[]): ResponseMessageInput[] {
  return items.filter(
    (item): item is ResponseMessageInput =>
      typeof item === "object" && item !== null && (item as { role?: unknown }).role === "system"
  );
}

function messageText(item: ResponseMessageInput): string {
  const part = item.content[0];
  if (part.type !== "input_text" && part.type !== "output_text") {
    return "";
  }
  return part.text;
}

function providerRequestWithOutput(output: string): unknown {
  return {
    input: [{
      role: "user",
      content: [{ type: "input_text", text: "继续处理当前项目。" }]
    }],
    continuationItems: [
      {
        type: "function_call",
        callId: "call-project-summary",
        name: "read_project_memory",
        argumentsText: "{}"
      },
      {
        type: "function_call_output",
        callId: "call-project-summary",
        output
      }
    ],
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    mode: "auto",
    capabilityIntent: { comparisonAnalysis: false }
  };
}

describe("A+ Provider continuation contract", () => {
  it("accepts a complete Function Call and terminal local Result pair", () => {
    const parsed = parseAPlusAgentProviderRequest(
      providerRequestWithOutput('{"status":"completed"}')
    );

    expect(parsed.status).toBe("ok");
    if (parsed.status === "failed") return;
    expect(parsed.value.continuationItems).toEqual([
      {
        type: "function_call",
        callId: "call-project-summary",
        name: "read_project_memory",
        argumentsText: "{}"
      },
      {
        type: "function_call_output",
        callId: "call-project-summary",
        output: '{"status":"completed"}'
      }
    ]);
  });

  it("rejects orphaned Results and Calls without a terminal Result", () => {
    const base = providerRequestWithOutput('{"status":"completed"}') as Record<string, unknown>;
    expect(parseAPlusAgentProviderRequest({
      ...base,
      continuationItems: [{
        type: "function_call_output",
        callId: "call-project-summary",
        output: '{"status":"completed"}'
      }]
    })).toMatchObject({ status: "failed" });
    expect(parseAPlusAgentProviderRequest({
      ...base,
      continuationItems: [{
        type: "function_call",
        callId: "call-project-summary",
        name: "read_project_memory",
        argumentsText: "{}"
      }]
    })).toMatchObject({ status: "failed" });
  });

  it("includes the exact local Tool Result in the external Request Hash", () => {
    const first = parseAPlusAgentProviderRequest(
      providerRequestWithOutput('{"status":"completed","revision":1}')
    );
    const second = parseAPlusAgentProviderRequest(
      providerRequestWithOutput('{"status":"completed","revision":2}')
    );
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status === "failed" || second.status === "failed") return;

    const firstContract = buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: first.value,
      webSearchEnabled: false
    });
    const secondContract = buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: second.value,
      webSearchEnabled: false
    });

    expect(hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: firstContract.request
    })).not.toBe(hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: secondContract.request
    }));
  });

  it("covers enabled Prompt Cache Hint fields without changing disabled hashes", () => {
    const parsed = parseAPlusAgentProviderRequest(
      providerRequestWithOutput('{"status":"completed"}')
    );
    expect(parsed.status).toBe("ok");
    if (parsed.status === "failed") return;
    const contract = buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: parsed.value,
      webSearchEnabled: false
    });
    const baseline = hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: contract.request
    });

    expect(hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: { ...contract.request }
    })).toBe(baseline);
    expect(hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: {
        ...contract.request,
        promptCacheKey: "morpho-pc-v1-one",
        promptCacheRetention: "24h"
      }
    })).not.toBe(baseline);
    expect(hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: {
        ...contract.request,
        promptCacheKey: "morpho-pc-v1-two",
        promptCacheRetention: "24h"
      }
    })).not.toBe(hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: {
        ...contract.request,
        promptCacheKey: "morpho-pc-v1-one",
        promptCacheRetention: "24h"
      }
    }));
  });

  it("materializes the trusted canonical strategy and method items after the runtime item", () => {
    const parsed = parseAPlusAgentProviderRequest({
      ...(providerRequestWithOutput('{"status":"completed"}') as Record<string, unknown>),
      strategy: "visualDevelopment",
      strategyAnchorMessageId: "user-visual-dev",
      methodPacks: ["formDevelopment", "referenceInterpretation"]
    });
    expect(parsed.status).toBe("ok");
    if (parsed.status === "failed") return;
    expect(parsed.value.strategy).toBe("visualDevelopment");
    expect(parsed.value.strategyAnchorMessageId).toBe("user-visual-dev");
    expect(parsed.value.methodPacks).toEqual(["formDevelopment", "referenceInterpretation"]);

    const contract = buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: parsed.value,
      webSearchEnabled: false
    });
    const systemItems = systemMessageItems(contract.request.input);
    expect(systemItems).toHaveLength(4);
    const strategyItem = systemItems[2];
    const methodItem = systemItems[3];
    expect(messageText(strategyItem)).toContain("[Morpho Canonical Strategy | trusted server item]");
    expect(messageText(strategyItem)).toContain("Task strategy: visualDevelopment");
    expect(messageText(strategyItem)).toContain("视觉意图必须区分改变目标、必须保留");
    expect(messageText(methodItem)).toContain("[Morpho Canonical Design Method | trusted server item]");
    expect(messageText(methodItem)).toContain("形态发展");
    expect(messageText(methodItem)).toContain("参考图解读");
    // The stable prefix stays untouched: system[0] is the stable prompt and
    // system[1] the runtime item.
    expect(messageText(systemItems[0])).toContain("Prompt contract: morpho-agent-v3.4-2026-08-13");
    expect(messageText(systemItems[1])).toContain("[Morpho Canonical Runtime | trusted server item]");
  });

  it("keeps the strategy out of the request when the client does not send it", () => {
    const parsed = parseAPlusAgentProviderRequest(providerRequestWithOutput('{"status":"completed"}'));
    expect(parsed.status).toBe("ok");
    if (parsed.status === "failed") return;
    expect(parsed.value.strategy).toBeUndefined();
    const contract = buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: parsed.value,
      webSearchEnabled: false
    });
    expect(systemMessageItems(contract.request.input)).toHaveLength(2);
  });

  it("rejects invalid strategy, method pack ids, duplicates, and over-limit packs", () => {
    const base = providerRequestWithOutput('{"status":"completed"}') as Record<string, unknown>;
    expect(parseAPlusAgentProviderRequest({ ...base, strategy: "notAStrategy" })).toMatchObject({
      status: "failed"
    });
    expect(parseAPlusAgentProviderRequest({ ...base, strategy: "research", strategyAnchorMessageId: "bad id!" }))
      .toMatchObject({ status: "failed" });
    expect(parseAPlusAgentProviderRequest({ ...base, methodPacks: ["not-a-pack"] })).toMatchObject({
      status: "failed"
    });
    expect(parseAPlusAgentProviderRequest({ ...base, methodPacks: ["formDevelopment", "formDevelopment"] }))
      .toMatchObject({ status: "failed" });
    expect(parseAPlusAgentProviderRequest({
      ...base,
      methodPacks: ["researchSynthesis", "designDefinition", "conceptDivergence", "formDevelopment"]
    })).toMatchObject({ status: "failed" });
  });

  it("includes strategy and method items in the external request hash", () => {
    const research = parseAPlusAgentProviderRequest({
      ...(providerRequestWithOutput('{"status":"completed"}') as Record<string, unknown>),
      strategy: "research",
      methodPacks: ["researchSynthesis"]
    });
    const visual = parseAPlusAgentProviderRequest({
      ...(providerRequestWithOutput('{"status":"completed"}') as Record<string, unknown>),
      strategy: "visualDevelopment",
      methodPacks: ["formDevelopment"]
    });
    expect(research.status).toBe("ok");
    expect(visual.status).toBe("ok");
    if (research.status === "failed" || visual.status === "failed") return;

    const researchHash = hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: buildAPlusAgentProviderContract({
        localProjectId: "project-local",
        request: research.value,
        webSearchEnabled: false
      }).request
    });
    const visualHash = hashAPlusAgentExternalRequest({
      model: "provider-test-model",
      providerRequest: buildAPlusAgentProviderContract({
        localProjectId: "project-local",
        request: visual.value,
        webSearchEnabled: false
      }).request
    });
    expect(researchHash).not.toBe(visualHash);
  });
});

describe("A+ Provider Tool boundary", () => {
  it("omits web search unless server capability and current-turn authority are both present", () => {
    const denied = parseAPlusAgentProviderRequest(providerRequestWithOutput('{"status":"completed"}'));
    expect(denied.status).toBe("ok");
    if (denied.status === "failed") return;
    expect(buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: denied.value,
      webSearchEnabled: true
    }).effectiveToolProfile).toBe("standard");

    const authorizedRequest = {
      ...denied.value,
      capabilityIntent: { ...denied.value.capabilityIntent, webSearch: true }
    };
    expect(buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: authorizedRequest,
      webSearchEnabled: true
    }).effectiveToolProfile).toBe("standardWithWebSearch");
    expect(buildAPlusAgentProviderContract({
      localProjectId: "project-local",
      request: authorizedRequest,
      webSearchEnabled: false
    }).effectiveToolProfile).toBe("standard");
  });

  it("derives only bounded Search and Image authorization claims from server-observed calls", () => {
    const claims = buildAPlusExternalToolActionClaims([
      {
        callId: "call-search",
        name: "search_web_evidence",
        argumentsText: JSON.stringify({ queries: ["  warm mobility  ", "local-first workspace"] })
      },
      {
        callId: "call-images",
        name: "generate_visuals",
        argumentsText: JSON.stringify({
          kind: "directionPreview",
          items: [{ id: "one" }, { id: "two" }]
        })
      },
      {
        callId: "call-local",
        name: "create_research_analysis",
        argumentsText: "{}"
      }
    ]);

    expect(claims).toEqual([
      {
        toolCallId: "call-search",
        actionKind: "webSearch",
        claimHash: hashAPlusExternalToolActionClaim({
          actionKind: "webSearch",
          toolCallId: "call-search",
          queries: ["warm mobility", "local-first workspace"]
        }),
        maxActionCount: 1
      },
      {
        toolCallId: "call-images",
        actionKind: "image",
        claimHash: hashAPlusExternalToolActionClaim({
          actionKind: "image",
          toolCallId: "call-images"
        }),
        maxActionCount: 2
      }
    ]);
  });

  it("does not authorize malformed paid actions and rejects duplicate Provider Call IDs", () => {
    expect(buildAPlusExternalToolActionClaims([
      {
        callId: "bad-search",
        name: "search_web_evidence",
        argumentsText: JSON.stringify({ queries: [] })
      },
      {
        callId: "bad-image",
        name: "generate_visuals",
        argumentsText: JSON.stringify({ items: new Array(33).fill({}) })
      }
    ])).toEqual([]);

    expect(() => normalizeAPlusProviderToolCalls([
      { id: "one", callId: "duplicate", name: "get_project_summary", argumentsText: "{}" },
      { id: "two", callId: "duplicate", name: "get_project_summary", argumentsText: "{}" }
    ])).toThrow("无效或重复");
  });
});
