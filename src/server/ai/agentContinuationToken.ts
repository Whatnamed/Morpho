import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * A Provider continuation claims that the submitted transcript is exactly the
 * previous request plus the model's own output plus the tool results for the calls
 * the model actually made. Sequence checks alone cannot prove that: an
 * authenticated client holding a valid lease could rewrite history or invent
 * `function_call` / `function_call_output` pairs and have the model treat the
 * forged tool results as real reads.
 *
 * The server therefore signs a short-lived binding for every Provider response and
 * requires it back on the next request. The token carries only identifiers, counts
 * and digests: no prompt, transcript, workspace or tool content.
 */

const CONTINUATION_TOKEN_VERSION = 1;
const CONTINUATION_TOKEN_TTL_MS = 20 * 60 * 1000;
const MAX_BOUND_CALL_IDS = 64;

export type AgentContinuationClaims = {
  v: number;
  leaseId: string;
  agentTurnId: string;
  /** The lease sequence the next request must present. */
  sequence: number;
  /** True when the issuing request was a conversation summary transcript. */
  summary: boolean;
  inputItemCount: number;
  inputHash: string;
  outputHash: string;
  callIds: string[];
  exp: number;
};

export type AgentContinuationVerification =
  | { status: "ok"; claims: AgentContinuationClaims }
  | { status: "failed"; reason: AgentContinuationFailureReason };

export type AgentContinuationFailureReason =
  | "secret_missing"
  | "token_missing"
  | "token_malformed"
  | "token_signature"
  | "token_expired"
  | "token_scope"
  | "prefix_truncated"
  | "prefix_rewritten"
  | "output_forged"
  | "tool_result_forged"
  | "transcript_not_summary";

/**
 * Prefer an explicit secret. Otherwise derive a stable server-only key from the
 * Provider API key, which every deployment already has and no client can read.
 * Deriving keeps the rollout free of a new required variable while remaining
 * unforgeable; the derivation is domain-separated so the API key is never exposed.
 */
export function resolveAgentContinuationSecret(
  env: Record<string, string | undefined>
): string | undefined {
  const explicit = env.MORPHO_AGENT_CONTINUATION_SECRET?.trim();
  if (explicit) {
    return explicit;
  }
  const providerKey = env.MORPHO_AI_API_KEY?.trim();
  return providerKey
    ? createHash("sha256").update(`morpho-agent-continuation-v1:${providerKey}`).digest("hex")
    : undefined;
}

/**
 * Items are hashed on the way out from the Provider result and on the way back in
 * after request parsing. Those two paths build equivalent objects but must not be
 * required to build them in the same key order, so the digest is taken over a
 * canonical key-sorted form.
 */
export function hashAgentContinuationItems(items: readonly unknown[]): string {
  return createHash("sha256").update(canonicalJson(items)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function issueAgentContinuationToken(
  input: {
    secret: string;
    leaseId: string;
    agentTurnId: string;
    sequence: number;
    summary: boolean;
    inputItemCount: number;
    inputHash: string;
    outputHash: string;
    callIds: readonly string[];
    now: number;
  }
): string {
  const claims: AgentContinuationClaims = {
    v: CONTINUATION_TOKEN_VERSION,
    leaseId: input.leaseId,
    agentTurnId: input.agentTurnId,
    sequence: input.sequence,
    summary: input.summary,
    inputItemCount: input.inputItemCount,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    callIds: [...input.callIds].slice(0, MAX_BOUND_CALL_IDS),
    exp: input.now + CONTINUATION_TOKEN_TTL_MS
  };
  const payload = base64Url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${sign(payload, input.secret)}`;
}

export function verifyAgentContinuationToken(input: {
  token: string | undefined;
  secret: string | undefined;
  leaseId: string;
  agentTurnId: string;
  expectedSequence: number;
  now: number;
}): AgentContinuationVerification {
  if (!input.secret) {
    return failed("secret_missing");
  }
  if (!input.token) {
    return failed("token_missing");
  }
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0) {
    return failed("token_malformed");
  }
  const payload = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);
  if (!matchesSignature(payload, signature, input.secret)) {
    return failed("token_signature");
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return failed("token_malformed");
  }
  if (!isContinuationClaims(claims)) {
    return failed("token_malformed");
  }
  if (claims.exp <= input.now) {
    return failed("token_expired");
  }
  if (
    claims.leaseId !== input.leaseId ||
    claims.agentTurnId !== input.agentTurnId ||
    claims.sequence !== input.expectedSequence
  ) {
    return failed("token_scope");
  }
  return { status: "ok", claims };
}

/**
 * Verify that the submitted dynamic input is the bound transcript: an unchanged
 * prefix, the exact Provider output that followed it, and tool results only for
 * calls the Provider actually made.
 */
export function verifyAgentContinuationBinding(input: {
  claims: AgentContinuationClaims;
  parsedInput: readonly unknown[];
}): { status: "ok" } | { status: "failed"; reason: AgentContinuationFailureReason } {
  const { claims, parsedInput } = input;
  if (parsedInput.length < claims.inputItemCount) {
    return failed("prefix_truncated");
  }
  if (hashAgentContinuationItems(parsedInput.slice(0, claims.inputItemCount)) !== claims.inputHash) {
    return failed("prefix_rewritten");
  }
  const tail = parsedInput.slice(claims.inputItemCount);
  let outputEnd = 0;
  while (outputEnd < tail.length && isProviderOutputItem(tail[outputEnd])) {
    outputEnd += 1;
  }
  if (hashAgentContinuationItems(tail.slice(0, outputEnd)) !== claims.outputHash) {
    return failed("output_forged");
  }
  const allowedCallIds = new Set(claims.callIds);
  const answeredCallIds = new Set<string>();
  for (const item of tail.slice(outputEnd)) {
    if (isProviderOutputItem(item)) {
      return failed("output_forged");
    }
    if (!isFunctionCallOutput(item)) {
      continue;
    }
    if (!allowedCallIds.has(item.call_id) || answeredCallIds.has(item.call_id)) {
      return failed("tool_result_forged");
    }
    answeredCallIds.add(item.call_id);
  }
  return { status: "ok" };
}

export function agentContinuationFailureMessage(reason: AgentContinuationFailureReason): string {
  if (reason === "secret_missing") {
    return "服务端缺少 Agent continuation 密钥，无法验证回合延续。";
  }
  if (reason === "transcript_not_summary") {
    return "压缩后的 Provider 请求必须紧接在服务端摘要之后。";
  }
  if (reason === "prefix_rewritten" || reason === "prefix_truncated") {
    return "Agent continuation 的历史前缀与服务端记录不一致。";
  }
  if (reason === "output_forged" || reason === "tool_result_forged") {
    return "Agent continuation 包含并非来自服务端上一次响应的模型输出或工具结果。";
  }
  return "Agent continuation 凭据无效或已过期，请重新发起本轮。";
}

function sign(payload: string, secret: string): string {
  return base64Url(createHmac("sha256", secret).update(payload).digest());
}

function matchesSignature(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(payload, secret), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isProviderOutputItem(value: unknown): boolean {
  return isRecord(value) &&
    (value.type === "message" || value.type === "reasoning" || value.type === "function_call");
}

function isFunctionCallOutput(value: unknown): value is { call_id: string } {
  return isRecord(value) && value.type === "function_call_output" && typeof value.call_id === "string";
}

function isContinuationClaims(value: unknown): value is AgentContinuationClaims {
  return isRecord(value) &&
    value.v === CONTINUATION_TOKEN_VERSION &&
    typeof value.leaseId === "string" &&
    typeof value.agentTurnId === "string" &&
    typeof value.sequence === "number" &&
    typeof value.summary === "boolean" &&
    typeof value.inputItemCount === "number" &&
    Number.isSafeInteger(value.inputItemCount) &&
    value.inputItemCount >= 0 &&
    typeof value.inputHash === "string" &&
    typeof value.outputHash === "string" &&
    Array.isArray(value.callIds) &&
    value.callIds.every((callId) => typeof callId === "string") &&
    typeof value.exp === "number";
}

function failed(reason: AgentContinuationFailureReason): { status: "failed"; reason: AgentContinuationFailureReason } {
  return { status: "failed", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
