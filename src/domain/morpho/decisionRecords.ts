import type { DecisionRecord, DecisionKind, MorphoWorkspace } from "./types";
import { isAssignableKeyConclusionCategory } from "./types";

export type DecisionRecordState = "current" | "superseded" | "historical" | "reviewRequired";

export type ClassifiedDecisionRecord = {
  record: DecisionRecord;
  state: DecisionRecordState;
  reason?: string;
};

export function classifyDecisionRecords(
  workspace: Pick<MorphoWorkspace, "objects" | "workingState" | "decisionRecords">
): ClassifiedDecisionRecord[] {
  return workspace.decisionRecords.map((record) => classifyDecisionRecord(workspace, record));
}

export function classifyDecisionRecord(
  workspace: Pick<MorphoWorkspace, "objects" | "workingState" | "decisionRecords">,
  record: DecisionRecord
): ClassifiedDecisionRecord {
  const targetId = record.objectSnapshot?.id ?? record.relatedObjectIds[0];
  const target = targetId ? workspace.objects[targetId] : undefined;

  switch (record.kind) {
    case "setDirectionStatus": {
      if (!target || target.type !== "conceptDirection") {
        return review(record, "决策目标方向已不存在，无法确认当前状态。");
      }
      const desiredStatus = parseDirectionStatus(record.summary);
      if (!desiredStatus) {
        return review(record, "决策记录没有可识别的方向状态。");
      }
      if (target.visibility !== "active") {
        return review(record, "方向当前不可见，无法确认这条决定仍是有效约束。");
      }
      return target.status === desiredStatus
        ? current(record)
        : superseded(record, "方向状态已被后续决定改变。");
    }
    case "setDefaultReference": {
      if (!target || target.type !== "image") {
        return review(record, "默认参考决策的目标图片已不存在。");
      }
      if (target.visibility !== "active" || !target.assetId) {
        return review(record, "默认参考目标图片当前不可用，无法确认这条决定仍有效。");
      }
      const cleared = record.summary.startsWith("清除后续默认参考") || /(?:clear|remove|unset)/i.test(record.summary);
      if (cleared) {
        return workspace.workingState.currentDefaultReferenceId
          ? superseded(record, "项目后来设置了新的默认参考。")
          : current(record);
      }
      return workspace.workingState.currentDefaultReferenceId === target.id
        ? current(record)
        : superseded(record, "项目后来替换了默认参考。");
    }
    case "applyDesignDefinition": {
      if (!target || target.type !== "designDefinition") {
        return review(record, "设计定义决策的目标对象已不存在。");
      }
      if (target.visibility !== "active") {
        return review(record, "当前设计定义不可见，无法确认这条决定仍有效。");
      }
      return workspace.workingState.currentDesignDefinitionId === target.id || target.isCurrentEffective
        ? current(record)
        : superseded(record, "当前设计定义已切换到另一个对象。");
    }
    case "applyConceptDirection": {
      if (!target || target.type !== "conceptDirection") {
        return review(record, "概念方向决策的目标对象已不存在。");
      }
      return target.visibility === "active"
        ? current(record)
        : superseded(record, "该概念方向已不再是当前有效对象。");
    }
    case "setImageRole": {
      if (!target || target.type !== "image") {
        return review(record, "图片角色决策的目标对象已不存在。");
      }
      if (target.visibility !== "active") {
        return review(record, "图片当前不可见，无法确认这条角色决定仍有效。");
      }
      const desiredRole = parseImageRole(record.summary);
      if (!desiredRole) {
        return review(record, "图片角色决策没有可识别的目标角色。");
      }
      return target.role === desiredRole
        ? current(record)
        : superseded(record, "图片角色已被后续决定改变。");
    }
    case "setKeyConclusionCategory": {
      if (!target || target.type !== "keyConclusion") {
        return review(record, "关键结论决策的目标对象已不存在。");
      }
      if (target.visibility !== "active") {
        return review(record, "关键结论当前不可见，无法确认这条决定仍有效。");
      }
      const desiredCategory = parseKeyConclusionCategory(record.summary);
      if (!desiredCategory) {
        return review(record, "关键结论类别决策没有可识别的目标类别。");
      }
      return target.category === desiredCategory
        ? current(record)
        : superseded(record, "关键结论类别已被后续决定改变。");
    }
    case "createKeyConclusion":
    case "setKeyConclusionState": {
      if (!target || target.type !== "keyConclusion") {
        return review(record, "关键结论决策的目标对象已不存在。");
      }
      if (target.visibility !== "active") {
        return review(record, "关键结论当前不可见，无法确认这条决定仍有效。");
      }
      const desiredState = parseKeyConclusionState(record.summary);
      if (record.kind === "setKeyConclusionState" && !desiredState) {
        return review(record, "关键结论状态决策没有可识别的目标状态。");
      }
      if (desiredState && target.state !== desiredState) {
        return superseded(record, "关键结论状态已被后续决定改变。");
      }
      return target.state === "superseded"
        ? superseded(record, "关键结论已被另一条结论替代。")
        : current(record);
    }
    case "deleteObject":
      return target ? review(record, "删除决策尚未反映到当前对象状态。") : current(record);
    default:
      return classifyTraceableDecision(workspace, record, targetId);
  }
}

function classifyTraceableDecision(
  workspace: Pick<MorphoWorkspace, "objects" | "workingState" | "decisionRecords">,
  record: DecisionRecord,
  targetId: string | undefined
): ClassifiedDecisionRecord {
  const missingRelatedObject = record.relatedObjectIds.some((objectId) => !workspace.objects[objectId]);
  if (missingRelatedObject || (targetId !== undefined && !workspace.objects[targetId] && record.kind !== "deleteObject")) {
    return review(record, "决策来源对象已不存在，需要人工复核。");
  }
  return historical(record);
}

function parseDirectionStatus(summary: string): "primary" | "alternative" | "eliminated" | "needsReview" | "pendingPreview" | undefined {
  const value = summary.toLocaleLowerCase();
  if (value.includes("primary") || value.includes("主方向")) return "primary";
  if (value.includes("alternative") || value.includes("备选")) return "alternative";
  if (value.includes("eliminated") || value.includes("已淘汰")) return "eliminated";
  if (value.includes("needsreview") || value.includes("待复核")) return "needsReview";
  if (value.includes("pendingpreview") || value.includes("待预览")) return "pendingPreview";
  return undefined;
}

function parseImageRole(summary: string): string | undefined {
  const match = summary.match(/(?:->|→)\s*([a-zA-Z][a-zA-Z0-9]*)\s*$/);
  return match?.[1];
}

function parseKeyConclusionState(summary: string): "active" | "superseded" | "needsVerification" | undefined {
  const match = summary.match(/(?:->|→)\s*(active|superseded|needsVerification)\s*$/i);
  return match?.[1] as "active" | "superseded" | "needsVerification" | undefined;
}

function parseKeyConclusionCategory(summary: string) {
  const match = summary.match(/(?:->|→)\s*([a-zA-Z][a-zA-Z0-9]*)\s*$/);
  return match && isAssignableKeyConclusionCategory(match[1]) ? match[1] : undefined;
}

function current(record: DecisionRecord): ClassifiedDecisionRecord {
  return { record, state: "current" };
}

function superseded(record: DecisionRecord, reason: string): ClassifiedDecisionRecord {
  return { record, state: "superseded", reason };
}

function historical(record: DecisionRecord): ClassifiedDecisionRecord {
  return { record, state: "historical" };
}

function review(record: DecisionRecord, reason: string): ClassifiedDecisionRecord {
  return { record, state: "reviewRequired", reason };
}

export function decisionStateLabel(state: DecisionRecordState): string {
  switch (state) {
    case "current":
      return "当前有效";
    case "superseded":
      return "已被替代";
    case "historical":
      return "历史记录";
    case "reviewRequired":
      return "待复核";
  }
}

export function decisionKindLabel(kind: DecisionKind): string {
  switch (kind) {
    case "setDirectionStatus":
      return "方向状态";
    case "setDefaultReference":
      return "默认参考";
    case "applyDesignDefinition":
      return "应用设计定义";
    case "applyConceptDirection":
      return "应用概念方向";
    case "setImageRole":
      return "图片角色";
    case "createKeyConclusion":
      return "保留关键结论";
    case "setKeyConclusionCategory":
      return "关键结论类别";
    case "setKeyConclusionState":
      return "关键结论状态";
    default:
      return "项目决定";
  }
}
