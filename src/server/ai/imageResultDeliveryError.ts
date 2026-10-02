/** Image delivery only. Unknown errors must not acquire a reconciliation/pending contract. */
export function classifyImageResultDeliveryError(code: string): { pending: boolean; status: number } {
  switch (code) {
    case "result_store_unavailable":
    case "result_store_deadline_exceeded":
    case "external_result_unavailable":
    case "result_incomplete":
      return { pending: true, status: 503 };
    case "external_result_expired": return { pending: false, status: 410 };
    case "result_payload_too_large": return { pending: false, status: 413 };
    case "result_identity_conflict":
    case "result_chunk_conflict":
    case "result_journal_binding_conflict":
    case "result_ack_conflict":
    case "result_effect_unavailable":
      return { pending: false, status: 409 };
    case "invalid_result_identity":
    case "invalid_result_manifest":
    case "invalid_result_chunk":
      return { pending: false, status: 400 };
    case "result_capacity_exceeded": return { pending: false, status: 507 };
    default: return { pending: false, status: 502 };
  }
}

export function imageResultDeliveryErrorResponse(code: string): Response {
  const { pending, status } = classifyImageResultDeliveryError(code);
  return Response.json({ code, recoverable: false,
    ...(pending ? { deliveryPending: true } : {}),
    error: pending ? "同一图像结果尚未完成交付；保留原 Action，只查询同一任务。"
      : "原图像结果无法交付；不会重新生成或替换结果。"
  }, { status, headers: { "Cache-Control": "no-store" } });
}
