const baseBody = {
  model: "gpt-5.6-terra",
  input: [{ role: "user", content: [{ type: "input_text", text: "prompt cache probe ".repeat(160) }] }],
  prompt_cache_key: "morpho:probe:gpt-5.6-terra:contract:standard",
  prompt_cache_retention: "24h"
};
const liveBaseBody = {
  model: baseBody.model,
  input: baseBody.input
};

const liveUrl = process.env.MORPHO_PROMPT_CACHE_PROBE_URL;
if (process.argv.includes("--live")) {
  const apiKey = process.env.MORPHO_AI_API_KEY || process.env.AIJWS_API_KEY;
  if (process.env.MORPHO_ALLOW_PAID_SMOKE_TESTS !== "true" || !liveUrl || !apiKey) {
    console.log("Prompt cache live probe skipped: set MORPHO_ALLOW_PAID_SMOKE_TESTS=true, MORPHO_PROMPT_CACHE_PROBE_URL, and a provider API key.");
    process.exit(0);
  }
  const cases = [
    ["no-key", {}],
    ["key", { prompt_cache_key: baseBody.prompt_cache_key }],
    ["key-plus-24h", { prompt_cache_key: baseBody.prompt_cache_key, prompt_cache_retention: "24h" }]
  ];
  const results = [];
  for (const [name, fields] of cases) {
    const requests = [];
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${liveUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ...liveBaseBody, ...fields, stream: false })
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      const unsupported = response.status === 400 && /prompt_cache|unknown|unrecognized|additional properties/i.test(
        JSON.stringify(payload)
      );
      const usage = payload?.usage;
      requests.push({
        index: index + 1,
        status: response.status,
        ...(unsupported ? { result: "unsupported" } : {}),
        ...(typeof usage?.input_tokens_details?.cached_tokens === "number"
          ? { cachedTokens: usage.input_tokens_details.cached_tokens }
          : {})
      });
      if (unsupported) {
        break;
      }
    }
    results.push({ name, requests });
  }
  const valid = results.every((result) => result.requests.length > 0 && result.requests.every(
    (request) => (request.status >= 200 && request.status < 300) || request.result === "unsupported"
  ));
  console.log(JSON.stringify({ cases: results }));
  process.exit(valid ? 0 : 1);
}

const cases = [
  ["400 unsupported field retries without cache fields", "unsupported"],
  ["provider ignores unknown fields without cache metadata", "ignored"],
  ["normal cache fields are forwarded", "normal"]
];
for (const [label, mode] of cases) {
  const result = await probe(createMockFetch(mode));
  assert(result.mode === mode, `${label}: expected ${mode}, got ${result.mode}`);
  console.log(`PASS ${label}`);
}

async function probe(fetchImpl) {
  const firstResponse = await fetchImpl("https://relay.example.com/v1/responses", {
    method: "POST",
    body: JSON.stringify(baseBody)
  });
  const firstBody = JSON.parse(await firstResponse.text());
  if (firstResponse.status === 400 && /prompt_cache|unknown|unrecognized|additional properties/i.test(JSON.stringify(firstBody))) {
    const retryBody = { ...baseBody };
    delete retryBody.prompt_cache_key;
    delete retryBody.prompt_cache_retention;
    const retry = await fetchImpl("https://relay.example.com/v1/responses", {
      method: "POST",
      body: JSON.stringify(retryBody)
    });
    assert(retry.ok, "unsupported cache fields must fall back to a normal request");
    return { mode: "unsupported" };
  }
  assert(firstResponse.ok, `unexpected provider status ${firstResponse.status}`);
  return { mode: firstBody.usage?.input_tokens_details?.cached_tokens ? "normal" : "ignored" };
}

function createMockFetch(mode) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    if (mode === "unsupported" && body.prompt_cache_key) {
      return response(400, { error: { message: "Unknown field prompt_cache_key" } });
    }
    if (mode === "normal") {
      return response(200, { id: "probe", usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 5 } } });
    }
    return response(200, { id: "probe", usage: { input_tokens: 10 } });
  };
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
