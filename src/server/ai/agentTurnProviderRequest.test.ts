import { describe, expect, it } from "vitest";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";

import {
  buildAPlusAgentProviderContract,
  buildAPlusExternalToolActionClaims,
  hashAPlusAgentExternalRequest,
  hashAPlusExternalToolActionClaim,
  normalizeAPlusProviderToolCalls,
  parseAPlusAgentProviderRequest
} from "./agentTurnProviderRequest";

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
});

describe("A+ Provider Tool boundary", () => {
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
