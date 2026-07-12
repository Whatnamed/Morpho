import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(rootDirectory, "src", "server", "ai", "__fixtures__");
const scenario = readOption("--scenario") ?? "reasoning";
const fixtureName = readOption("--fixture");

const { loadOpenAiCompatibleConfig } = await import("../src/server/ai/openaiCompatibleConfig.ts");
const loadedConfig = loadOpenAiCompatibleConfig(process.env);
if (loadedConfig.status === "failed") {
  console.error(`probe unavailable: ${loadedConfig.reason}`);
  process.exitCode = 2;
} else {
  await runProbe(loadedConfig.config);
}

async function runProbe(config) {
  const request = buildScenarioRequest(scenario, config.webSearchEnabled);
  const controller = new AbortController();
  const shouldCancel = scenario === "cancel";
  const cancelTimer = shouldCancel ? setTimeout(() => controller.abort(), 900) : undefined;

  try {
    const first = await requestResponseStream(config, request, controller.signal);
    const events = [...first.events];
    if (scenario === "continuation" || scenario === "tool-error") {
      const functionCall = findCompletedFunctionCall(first.events);
      if (!functionCall || first.outputItems.length === 0) {
        throw new Error("the provider did not return a function call that can be continued");
      }
      const continuation = await requestResponseStream(
        config,
        {
          input: [
            ...first.outputItems,
            {
              type: "function_call_output",
              call_id: functionCall.callId,
              output:
                scenario === "tool-error"
                  ? JSON.stringify({ ok: false, error: "Synthetic probe tool failure." })
                  : JSON.stringify({ ok: true, result: "Synthetic probe lookup result." })
            }
          ],
          tools: [probeFunctionTool()]
        },
        controller.signal
      );
      events.push(...continuation.events.map((event) => ({ ...event, probe_turn: "continuation" })));
    }
    const identifiers = new Map();
    const sanitizedEvents = events.map((event) => sanitizeSseEvent(event, identifiers));
    const eventTypes = sanitizedEvents
      .map((event) => event.data.type)
      .filter((eventType) => typeof eventType === "string");

    console.log(`scenario: ${scenario}`);
    console.log(`events: ${eventTypes.join(", ") || "none"}`);
    console.log(`count: ${sanitizedEvents.length}`);
    console.log(`message phase seen: ${hasMessagePhase(sanitizedEvents) ? "yes" : "no"}`);

    if (fixtureName) {
      await mkdir(fixtureDirectory, { recursive: true });
      await writeFile(
        path.join(fixtureDirectory, fixtureName),
        sanitizedEvents.map((event) => JSON.stringify(event)).join("\n") + "\n",
        "utf8"
      );
      console.log(`fixture: ${fixtureName}`);
    }
  } catch (error) {
    if (shouldCancel && error instanceof DOMException && error.name === "AbortError") {
      console.log("cancelled: yes");
      return;
    }
    console.error(
      `probe failed: ${
        error instanceof Error && /^provider returned HTTP \d+$/.test(error.message)
          ? error.message
          : error instanceof Error
            ? error.name
            : "unknown error"
      }`
    );
    process.exitCode = 4;
  } finally {
    if (cancelTimer) {
      clearTimeout(cancelTimer);
    }
  }
}

async function requestResponseStream(config, request, signal) {
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      ...(config.reasoningEffort
        ? {
            reasoning: {
              effort: config.reasoningEffort,
              summary: "auto"
            }
          }
        : {}),
      ...request
    }),
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`provider returned HTTP ${response.status}`);
  }

  const events = await collectSseEvents(response.body, signal);
  return {
    events,
    responseId: findCompletedResponseId(events),
    outputItems: findCompletedOutputItems(events)
  };
}

function findCompletedResponseId(events) {
  const completed = events.find((event) => event.data?.type === "response.completed");
  const response = completed?.data?.response;
  return response && typeof response.id === "string" ? response.id : undefined;
}

function findCompletedOutputItems(events) {
  const completed = events.find((event) => event.data?.type === "response.completed");
  const output = completed?.data?.response?.output;
  return Array.isArray(output) ? output : [];
}

function findCompletedFunctionCall(events) {
  const completed = events.find((event) => event.data?.type === "response.completed");
  const output = completed?.data?.response?.output;
  if (!Array.isArray(output)) {
    return undefined;
  }
  const call = output.find((item) => item && typeof item === "object" && item.type === "function_call");
  return call && typeof call.call_id === "string" ? { callId: call.call_id } : undefined;
}

function buildScenarioRequest(selectedScenario, webSearchEnabled) {
  const sharedInput = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "This is a synthetic protocol probe. Do not use personal or project data."
        }
      ]
    }
  ];

  switch (selectedScenario) {
    case "tool":
    case "continuation":
    case "tool-error":
      return {
        input: [
          ...sharedInput,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "First determine whether 17 is prime, then call probe_lookup exactly once with query \"synthetic protocol probe\". Do not answer before the tool result."
              }
            ]
          }
        ],
        tools: [probeFunctionTool()]
      };
    case "commentary":
      return {
        input: [
          ...sharedInput,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Before your final one-sentence answer, provide one brief user-facing commentary sentence only if your API supports a commentary phase."
              }
            ]
          }
        ]
      };
    case "silent":
      return {
        input: [
          ...sharedInput,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Reply with exactly: protocol probe complete"
              }
            ]
          }
        ]
      };
    case "cancel":
      return {
        input: [
          ...sharedInput,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Reason carefully about a large hypothetical decision tree before replying."
              }
            ]
          }
        ]
      };
    case "web-search":
      if (!webSearchEnabled) {
        throw new Error("web search is disabled by the active Morpho configuration");
      }
      return {
        input: [
          ...sharedInput,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Use web search only if available to verify the current UTC date, then give a concise answer with sources."
              }
            ]
          }
        ],
        tools: [{ type: "web_search_preview", search_context_size: "low" }]
      };
    case "reasoning":
      return {
        input: [
          ...sharedInput,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Briefly reason about whether 17 is prime, then state the answer in one sentence."
              }
            ]
          }
        ]
      };
    default:
      throw new Error(`unsupported scenario: ${selectedScenario}`);
  }
}

function probeFunctionTool() {
  return {
    type: "function",
    name: "probe_lookup",
    description: "Returns synthetic protocol-probe data.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string"
        }
      },
      required: ["query"]
    },
    strict: true
  };
}

async function collectSseEvents(stream, signal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  while (true) {
    const next = await reader.read();
    if (signal.aborted) {
      await reader.cancel();
      throw new DOMException("The probe was cancelled.", "AbortError");
    }

    if (next.value) {
      buffer += decoder.decode(next.value, { stream: !next.done });
      const parsed = consumeSseFrames(buffer);
      buffer = parsed.remainder;
      events.push(...parsed.events);
    }

    if (next.done) {
      const parsed = consumeSseFrames(`${buffer}\n\n`);
      events.push(...parsed.events);
      return events;
    }
  }
}

function consumeSseFrames(buffer) {
  const events = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const delimiter = findFrameDelimiter(buffer, cursor);
    if (!delimiter) {
      break;
    }

    const frame = buffer.slice(cursor, delimiter.start);
    cursor = delimiter.end;
    const event = parseSseFrame(frame);
    if (event) {
      events.push(event);
    }
  }

  return {
    events,
    remainder: buffer.slice(cursor)
  };
}

function findFrameDelimiter(value, from) {
  const crlfIndex = value.indexOf("\r\n\r\n", from);
  const lfIndex = value.indexOf("\n\n", from);
  if (crlfIndex < 0 && lfIndex < 0) {
    return undefined;
  }
  if (lfIndex < 0 || (crlfIndex >= 0 && crlfIndex < lfIndex)) {
    return { start: crlfIndex, end: crlfIndex + 4 };
  }
  return { start: lfIndex, end: lfIndex + 2 };
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const data = [];
  let event;

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).trimStart() : "";
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  const combinedData = data.join("\n");
  if (!combinedData || combinedData === "[DONE]") {
    return undefined;
  }

  try {
    return {
      ...(event ? { event } : {}),
      data: JSON.parse(combinedData)
    };
  } catch {
    return {
      ...(event ? { event } : {}),
      data: { type: "unparseable" }
    };
  }
}

function sanitizeSseEvent(event, identifiers) {
  return {
    ...(event.probe_turn ? { probeTurn: event.probe_turn } : {}),
    ...(event.event ? { event: event.event } : {}),
    data: sanitizeValue(event.data, "", identifiers)
  };
}

function sanitizeValue(value, key = "", identifiers = new Map()) {
  if (typeof value === "string") {
    if (
      /authorization|api[_-]?key|image_url|data:|base64|prompt|input|instructions|safety_identifier|obfuscation/i.test(key) ||
      value.startsWith("data:")
    ) {
      return "[redacted]";
    }
    if (key === "id" || key.endsWith("_id")) {
      return sanitizeIdentifier(value, key, identifiers);
    }
    return value.length > 600 ? `${value.slice(0, 600)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => sanitizeValue(item, "", identifiers));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([entryKey]) =>
          !/authorization|api[_-]?key|image_url|input|prompt|instructions|safety_identifier|obfuscation|encrypted_content/i.test(
            entryKey
          )
      )
      .map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey, identifiers)])
  );
}

function sanitizeIdentifier(value, key, identifiers) {
  const existing = identifiers.get(value);
  if (existing) {
    return existing;
  }
  const normalizedKey = key.replace(/_id$/, "").replace(/[^a-z]/gi, "") || "item";
  const next = `<${normalizedKey}-${identifiers.size + 1}>`;
  identifiers.set(value, next);
  return next;
}

function hasMessagePhase(events) {
  return events.some((event) => {
    const data = event.data;
    return (
      data &&
      typeof data === "object" &&
      "item" in data &&
      data.item &&
      typeof data.item === "object" &&
      "phase" in data.item
    );
  });
}

function readOption(name) {
  const direct = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return direct ? direct.slice(name.length + 1).trim() || undefined : undefined;
}
