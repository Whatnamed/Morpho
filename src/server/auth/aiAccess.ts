import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/infrastructure/supabase/server";

export type AiQuotaKind = "text" | "image";
export type AccessRole = "owner" | "tester";
export type AccessStatus = "pending" | "active" | "blocked";

export type AiUsageSnapshot = {
  role: AccessRole;
  accessStatus: AccessStatus;
  dailyTextLimit: number;
  dailyImageLimit: number;
  textRequestCount: number;
  imageRequestCount: number;
  usageDate: string;
};

export type AiRouteAccessResult =
  | {
      status: "allowed";
      userId: string;
      usage: AiUsageSnapshot;
    }
  | {
      status: "denied";
      httpStatus: 401 | 403 | 429 | 503;
      error: string;
    };

export type AiRouteUserAccessResult =
  | {
      status: "allowed";
      userId: string;
    }
  | {
      status: "denied";
      httpStatus: 401 | 503;
      error: string;
    };

export type AiAccessClient = {
  auth: {
    getUser(): Promise<{
      data: {
        user: { id: string; email?: string } | null;
      };
      error?: unknown;
    }>;
  };
  rpc(
    name: "reserve_ai_daily_quota",
    args: { request_kind: AiQuotaKind }
  ): {
    single(): Promise<{
      data: unknown;
      error: unknown;
    }>;
  };
};

type QuotaRpcRow = {
  allowed: boolean;
  denial_reason: "pending" | "blocked" | "quota_exceeded" | null;
  role_name: AccessRole;
  status_name: AccessStatus;
  daily_text_limit: number;
  daily_image_limit: number;
  text_request_count: number;
  image_request_count: number;
  usage_date: string;
};

export async function guardAiRoute(kind: AiQuotaKind): Promise<AiRouteAccessResult> {
  const created = await createServerSupabaseClient();
  if (created.status === "failed") {
    return {
      status: "denied",
      httpStatus: 503,
      error: created.reason
    };
  }

  return reserveAiQuotaForRequest(created.client as unknown as AiAccessClient, kind);
}

export async function requireAiRouteUser(): Promise<AiRouteUserAccessResult> {
  const created = await createServerSupabaseClient();
  if (created.status === "failed") {
    return {
      status: "denied",
      httpStatus: 503,
      error: created.reason
    };
  }

  return requireAiRouteUserForClient(created.client as unknown as Pick<AiAccessClient, "auth">);
}

export async function requireAiRouteUserForClient(
  client: Pick<AiAccessClient, "auth">
): Promise<AiRouteUserAccessResult> {
  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    return {
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    };
  }

  return {
    status: "allowed",
    userId: userResult.data.user.id
  };
}

export async function reserveAiQuotaForRequest(client: AiAccessClient, kind: AiQuotaKind): Promise<AiRouteAccessResult> {
  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    return {
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    };
  }

  const reservation = await client.rpc("reserve_ai_daily_quota", { request_kind: kind }).single();
  if (reservation.error || !isQuotaRpcRow(reservation.data)) {
    return {
      status: "denied",
      httpStatus: 503,
      error: "AI 额度服务暂时不可用，请稍后重试。"
    };
  }

  const usage = toUsageSnapshot(reservation.data);
  if (reservation.data.allowed) {
    return {
      status: "allowed",
      userId: userResult.data.user.id,
      usage
    };
  }

  if (reservation.data.denial_reason === "quota_exceeded") {
    return {
      status: "denied",
      httpStatus: 429,
      error: kind === "image" ? "今日生图额度已用完，请明天再试。" : "今日文本 AI 额度已用完，请明天再试。"
    };
  }

  if (reservation.data.denial_reason === "blocked" || reservation.data.status_name === "blocked") {
    return {
      status: "denied",
      httpStatus: 403,
      error: "当前测试资格不可用。如需继续使用，请联系项目管理员。"
    };
  }

  return {
    status: "denied",
    httpStatus: 403,
    error: "当前账号尚未获得测试资格，请联系项目管理员。"
  };
}

export function aiAccessDeniedResponse(result: Extract<AiRouteAccessResult, { status: "denied" }>) {
  return NextResponse.json({ error: result.error }, { status: result.httpStatus });
}

function toUsageSnapshot(row: QuotaRpcRow): AiUsageSnapshot {
  return {
    role: row.role_name,
    accessStatus: row.status_name,
    dailyTextLimit: row.daily_text_limit,
    dailyImageLimit: row.daily_image_limit,
    textRequestCount: row.text_request_count,
    imageRequestCount: row.image_request_count,
    usageDate: row.usage_date
  };
}

function isQuotaRpcRow(value: unknown): value is QuotaRpcRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.allowed === "boolean" &&
    (value.denial_reason === null ||
      value.denial_reason === "pending" ||
      value.denial_reason === "blocked" ||
      value.denial_reason === "quota_exceeded") &&
    (value.role_name === "owner" || value.role_name === "tester") &&
    (value.status_name === "pending" || value.status_name === "active" || value.status_name === "blocked") &&
    typeof value.daily_text_limit === "number" &&
    typeof value.daily_image_limit === "number" &&
    typeof value.text_request_count === "number" &&
    typeof value.image_request_count === "number" &&
    typeof value.usage_date === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
