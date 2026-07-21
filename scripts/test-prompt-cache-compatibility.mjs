const baseBody = {
  model: "gpt-5.6-terra",
  input: [{ role: "user", content: [{ type: "input_text", text: "prompt cache probe" }] }],
  prompt_cache_key: "morpho:probe:gpt-5.6-terra:contract:standard",
  prompt_cache_retention: "in_memory"
};

const liveUrl = process.env.MORPHO_PROMPT_CACHE_PROBE_URL;
if (process.argv.includes("--live")) {
  if (process.env.MORPHO_ALLOW_PAID_SMOKE_TESTS !== "true" || !liveUrl) {
    console.log("Prompt cache live probe skipped: set MORPHO_ALLOW_PAID_SMOKE_TESTS=true and MORPHO_PROMPT_CACHE_PROBE_URL.");
    process.exit(0);
  }
  const response = await fetch(`${liveUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MORPHO_AI_API_KEY ?? ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...baseBody, stream: false })
  });
  console.log(JSON.stringify({ status: response.status, body: await response.text() }, null, 2));
  process.exit(response.ok ? 0 : 1);
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
