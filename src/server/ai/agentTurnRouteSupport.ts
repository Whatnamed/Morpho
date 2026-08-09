import { NextResponse } from "next/server";

import {
  readBoundedJsonBody as readBoundedJsonRequestBody,
  type BoundedJsonBodyResult
} from "@/server/http/boundedJsonBody";
import type {
  AgentTurnJournalDenial
} from "./agentTurnJournal";

export const MAX_A_PLUS_AGENT_REQUEST_BODY_BYTES = 36 * 1024 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readBoundedJsonBody(
  request: Request,
  maxBytes = MAX_A_PLUS_AGENT_REQUEST_BODY_BYTES
): Promise<BoundedJsonBodyResult> {
  return readBoundedJsonRequestBody(request, {
    maxBytes,
    tooLargeError: "A+ Agent 请求体超过允许大小。"
  });
}

export function journalDeniedResponse(denial: AgentTurnJournalDenial): NextResponse {
  return NextResponse.json(
    {
      error: denial.error,
      code: denial.code,
      recoverable: denial.recoverable
    },
    { status: denial.httpStatus }
  );
}

export function invalidRequestResponse(error: string, code = "invalid_request"): NextResponse {
  return NextResponse.json({ error, code, recoverable: false }, { status: 400 });
}

export function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    IDENTIFIER_PATTERN.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(value).filter((key) => !allowedSet.has(key));
}
