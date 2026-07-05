import { createServerSupabaseClient } from "@/infrastructure/supabase/server";
import type { AccessRole, AccessStatus, AiUsageSnapshot } from "./aiAccess";

export type AccountAccessSnapshot = AiUsageSnapshot & {
  email: string;
};

export type AccountAccessResult =
  | {
      status: "ok";
      account: AccountAccessSnapshot;
    }
  | {
      status: "unauthenticated";
    }
  | {
      status: "unavailable";
      reason: string;
    };

type AccountStateRpcRow = {
  role_name: AccessRole;
  status_name: AccessStatus;
  daily_text_limit: number;
  daily_image_limit: number;
  text_request_count: number;
  image_request_count: number;
  usage_date: string;
};

export async function getCurrentAccountAccess(): Promise<AccountAccessResult> {
  const created = await createServerSupabaseClient();
  if (created.status === "failed") {
    return {
      status: "unavailable",
      reason: created.reason
    };
  }

  const userResult = await created.client.auth.getUser();
  if (userResult.error || !userResult.data.user) {
    return { status: "unauthenticated" };
  }

  const state = await created.client.rpc("get_my_access_state").single();
  if (state.error || !isAccountStateRpcRow(state.data)) {
    return {
      status: "unavailable",
      reason: "无法读取当前测试资格与额度，请稍后重试。"
    };
  }

  return {
    status: "ok",
    account: {
      email: userResult.data.user.email ?? "unknown@example.invalid",
      role: state.data.role_name,
      accessStatus: state.data.status_name,
      dailyTextLimit: state.data.daily_text_limit,
      dailyImageLimit: state.data.daily_image_limit,
      textRequestCount: state.data.text_request_count,
      imageRequestCount: state.data.image_request_count,
      usageDate: state.data.usage_date
    }
  };
}

function isAccountStateRpcRow(value: unknown): value is AccountStateRpcRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
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
