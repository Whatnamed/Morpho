import type { DecisionRecord, DecisionKind, MorphoWorkspace } from "./types";

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
  const effect = record.effect;
  if (!effect) {
    return record.kind === "createDeliveryReference"
      ? historical(record)
      : review(record, "历史决定缺少可靠的结构化 effect / revision，不能从当前状态或文案还原。");
  }
  const index = workspace.decisionRecords.findIndex((item) => item.id === record.id);
  const later = index < 0 ? [] : workspace.decisionRecords.slice(index + 1);
  if (later.some((item) => item.effect && effectSlots(effect).some((slot) => effectSlots(item.effect!).includes(slot)))) {
    return superseded(record, "该决定的 effect 已被后来的明确决定替代。");
  }
  const target = workspace.objects[effect.targetObjectId];
  if (effect.kind === "deleteObject") return target ? review(record, "删除目标后来恢复，需要复核。") : historical(record);
  if (effect.kind === "setDefaultReference" && effect.referenceObjectId === null) {
    return workspace.workingState.currentDefaultReferenceId ? superseded(record, "项目后来设置了默认参考。") : current(record);
  }
  if (!target) return review(record, "决定目标已不存在，历史决定仍保留。");
  if (target.visibility !== "active") return review(record, "决定目标当前不可见。");
  let matches = false;
  switch (effect.kind) {
    case "setDirectionStatus": matches = target.type === "conceptDirection" && target.status === effect.status; break;
    case "setDefaultReference": matches = target.type === "image" && Boolean(target.assetId) && workspace.workingState.currentDefaultReferenceId === effect.referenceObjectId; break;
    case "applyDesignDefinition": matches = target.type === "designDefinition" && target.isCurrentEffective && target.currentRevisionId === effect.revisionId; break;
    case "applyConceptDirection": matches = target.type === "conceptDirection" && target.currentRevisionId === effect.revisionId; break;
    case "setImageRole": matches = target.type === "image" && target.role === effect.role; break;
    case "createKeyConclusion": matches = target.type === "keyConclusion" && target.state !== "superseded" && target.state !== "archived"; break;
    case "setKeyConclusionCategory": matches = target.type === "keyConclusion" && target.category === effect.category; break;
    case "setKeyConclusionState": matches = target.type === "keyConclusion" && target.state === effect.state && target.supersededById === effect.supersededById; break;
  }
  return matches ? current(record) : superseded(record, "当前领域状态或版本已不再对应此 effect。");
}

function effectSlots(effect: NonNullable<DecisionRecord["effect"]>): string[] {
  if (effect.kind === "applyDesignDefinition" || effect.kind === "setDefaultReference") return [effect.kind];
  return [`${effect.kind}:${effect.targetObjectId}`];
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
