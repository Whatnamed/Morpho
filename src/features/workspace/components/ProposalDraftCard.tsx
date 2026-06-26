"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import type {
  ArtifactProposal,
  ConceptDirectionDraft,
  ConceptDirectionProposal,
  DesignDefinitionProposal,
  ResearchAnalysisProposal,
  ResearchEvidence
} from "@/domain/operations/types";

type ProposalDraftCardProps = {
  workspace: MorphoWorkspace;
  proposal: ArtifactProposal;
  onApply: (allowSourceChanged?: boolean) => void;
  onReject: (proposalId: string) => void;
  onContinueDiscussion: (proposalId: string) => void;
  onRegenerate: (proposalId: string) => void;
  onSaveResearchDraft: (
    proposalId: string,
    input: Pick<
      ResearchAnalysisProposal,
      "title" | "summary" | "findings" | "opportunities" | "constraints" | "openQuestions" | "evidence"
    >
  ) => void;
  onSaveDesignDefinitionDraft: (
    proposalId: string,
    input: Pick<
      DesignDefinitionProposal,
      | "title"
      | "summary"
      | "projectGoal"
      | "targetUsers"
      | "primaryScenarios"
      | "coreProblem"
      | "designPrinciples"
      | "constraints"
      | "avoidDirections"
      | "opportunities"
      | "openQuestions"
      | "changeNote"
    >
  ) => void;
  onSaveConceptDirectionDraft: (
    proposalId: string,
    input: Pick<ConceptDirectionProposal, "title" | "summary" | "directions">
  ) => void;
};

export function ProposalDraftCard({
  workspace,
  proposal,
  onApply,
  onReject,
  onContinueDiscussion,
  onRegenerate,
  onSaveResearchDraft,
  onSaveDesignDefinitionDraft,
  onSaveConceptDirectionDraft
}: ProposalDraftCardProps) {
  return (
    <section className="proposal-card" aria-label="待处理草案">
      <div className="proposal-card-header">
        <div>
          <strong>{proposalTitle(proposal)}</strong>
          <div className="proposal-meta">
            <span>{proposalTypeLabel(proposal)}</span>
            <span>{proposalIntentLabel(proposal.workIntent)}</span>
          </div>
        </div>
        <span className={`proposal-review-state review-${proposal.reviewState ?? "ready"}`}>
          {proposalReviewStateLabel(proposal.reviewState)}
        </span>
      </div>

      <p className="proposal-help-text">{proposalReviewStateMessage(proposal.reviewState)}</p>
      {proposal.reviewDetails && proposal.reviewDetails.length > 0 ? (
        <div className="proposal-citations" aria-label="草案复核详情">
          {proposal.reviewDetails.map((detail) => (
            <span className="proposal-citation-pill" key={`${detail.objectId}-${detail.reason}`}>
              {detail.objectTitle}：{proposalReviewReasonLabel(detail.reason)}
            </span>
          ))}
        </div>
      ) : null}
      {proposalTargetMessage(workspace, proposal) ? (
        <p className="proposal-help-text">{proposalTargetMessage(workspace, proposal)}</p>
      ) : null}
      <div className="proposal-citations">
        {proposal.citationIds.length > 0 ? (
          proposal.citationIds
            .map((citationId) => workspace.citationSnapshots[citationId])
            .filter(Boolean)
            .map((citation) => (
              <span className="proposal-citation-pill" key={citation.id}>
                {citation.title}
              </span>
            ))
        ) : (
          <span className="proposal-citation-pill muted">暂无已保存来源</span>
        )}
      </div>

      {proposal.type === "researchAnalysis" ? (
        <ResearchProposalEditor
          key={proposalEditorKey(proposal)}
          proposal={proposal}
          onSave={onSaveResearchDraft}
        />
      ) : null}
      {proposal.type === "designDefinition" ? (
        <DesignDefinitionProposalEditor
          key={proposalEditorKey(proposal)}
          proposal={proposal}
          onSave={onSaveDesignDefinitionDraft}
        />
      ) : null}
      {proposal.type === "conceptDirection" ? (
        <ConceptDirectionProposalEditor
          key={proposalEditorKey(proposal)}
          proposal={proposal}
          onSave={onSaveConceptDirectionDraft}
        />
      ) : null}

      <div className="proposal-actions">
        <button className="plain-button" type="button" onClick={() => onContinueDiscussion(proposal.id)}>
          继续讨论
        </button>
        <button className="plain-button" type="button" onClick={() => onRegenerate(proposal.id)}>
          重新生成
        </button>
        <button className="plain-button" type="button" onClick={() => onReject(proposal.id)}>
          放弃草案
        </button>
        <button
          className="brand-button"
          type="button"
          disabled={proposal.reviewState === "targetUnavailable" || proposal.reviewState === "baseSuperseded"}
          onClick={() => onApply(proposal.reviewState === "sourceChanged")}
        >
          {proposal.reviewState === "sourceChanged" ? "已复核来源，仍然应用" : "应用草案"}
        </button>
      </div>
    </section>
  );
}

function ResearchProposalEditor({
  proposal,
  onSave
}: {
  proposal: ResearchAnalysisProposal;
  onSave: ProposalDraftCardProps["onSaveResearchDraft"];
}) {
  const [title, setTitle] = useState(proposal.title);
  const [summary, setSummary] = useState(proposal.summary);
  const [findings, setFindings] = useState(joinLines(proposal.findings));
  const [opportunities, setOpportunities] = useState(joinLines(proposal.opportunities));
  const [constraints, setConstraints] = useState(joinLines(proposal.constraints));
  const [openQuestions, setOpenQuestions] = useState(joinLines(proposal.openQuestions));
  const [evidence, setEvidence] = useState<ResearchEvidence[]>(proposal.evidence.map(cloneEvidence));

  return (
    <div className="proposal-editor">
      <LabeledInput label="标题" value={title} onChange={setTitle} />
      <LabeledTextarea label="摘要" value={summary} onChange={setSummary} rows={3} />
      <LabeledTextarea label="发现" value={findings} onChange={setFindings} rows={4} />
      <LabeledTextarea label="机会点" value={opportunities} onChange={setOpportunities} rows={3} />
      <LabeledTextarea label="约束" value={constraints} onChange={setConstraints} rows={3} />
      <LabeledTextarea label="待确认问题" value={openQuestions} onChange={setOpenQuestions} rows={3} />
      <div className="proposal-subsection">
        <strong>证据</strong>
        {evidence.map((item, index) => (
          <div className="proposal-evidence-row" key={`${proposal.id}-evidence-${index}`}>
            <textarea
              rows={3}
              value={item.claim}
              onChange={(event) =>
                setEvidence((current) =>
                  current.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, claim: event.currentTarget.value } : entry
                  )
                )
              }
            />
            <select
              value={item.confidence}
              onChange={(event) =>
                setEvidence((current) =>
                  current.map((entry, entryIndex) =>
                    entryIndex === index
                      ? { ...entry, confidence: event.currentTarget.value as ResearchEvidence["confidence"] }
                      : entry
                  )
                )
              }
            >
              <option value="supported">证据充分</option>
              <option value="partial">部分支持</option>
              <option value="needsVerification">待验证</option>
            </select>
            <small>来源对象：{item.sourceObjectIds.join(", ") || "无"}</small>
            <small>引用来源：{item.citationIds.join(", ") || "无"}</small>
          </div>
        ))}
      </div>
      <button
        className="plain-button"
        type="button"
        onClick={() =>
          onSave(proposal.id, {
            title: title.trim(),
            summary: summary.trim(),
            findings: splitLines(findings),
            opportunities: splitLines(opportunities),
            constraints: splitLines(constraints),
            openQuestions: splitLines(openQuestions),
            evidence: evidence.map(cloneEvidence)
          })
        }
      >
        保存草案修改
      </button>
    </div>
  );
}

function DesignDefinitionProposalEditor({
  proposal,
  onSave
}: {
  proposal: DesignDefinitionProposal;
  onSave: ProposalDraftCardProps["onSaveDesignDefinitionDraft"];
}) {
  const [title, setTitle] = useState(proposal.title);
  const [summary, setSummary] = useState(proposal.summary);
  const [projectGoal, setProjectGoal] = useState(proposal.projectGoal);
  const [targetUsers, setTargetUsers] = useState(joinLines(proposal.targetUsers));
  const [primaryScenarios, setPrimaryScenarios] = useState(joinLines(proposal.primaryScenarios));
  const [coreProblem, setCoreProblem] = useState(proposal.coreProblem);
  const [designPrinciples, setDesignPrinciples] = useState(joinLines(proposal.designPrinciples));
  const [constraints, setConstraints] = useState(joinLines(proposal.constraints));
  const [avoidDirections, setAvoidDirections] = useState(joinLines(proposal.avoidDirections));
  const [opportunities, setOpportunities] = useState(joinLines(proposal.opportunities));
  const [openQuestions, setOpenQuestions] = useState(joinLines(proposal.openQuestions));
  const [changeNote, setChangeNote] = useState(proposal.changeNote ?? "");

  return (
    <div className="proposal-editor">
      <LabeledInput label="标题" value={title} onChange={setTitle} />
      <LabeledTextarea label="摘要" value={summary} onChange={setSummary} rows={3} />
      <LabeledTextarea label="项目目标" value={projectGoal} onChange={setProjectGoal} rows={3} />
      <LabeledTextarea label="目标用户" value={targetUsers} onChange={setTargetUsers} rows={3} />
      <LabeledTextarea label="主要场景" value={primaryScenarios} onChange={setPrimaryScenarios} rows={3} />
      <LabeledTextarea label="核心问题" value={coreProblem} onChange={setCoreProblem} rows={3} />
      <LabeledTextarea label="设计原则" value={designPrinciples} onChange={setDesignPrinciples} rows={4} />
      <LabeledTextarea label="约束" value={constraints} onChange={setConstraints} rows={3} />
      <LabeledTextarea label="避免方向" value={avoidDirections} onChange={setAvoidDirections} rows={3} />
      <LabeledTextarea label="机会点" value={opportunities} onChange={setOpportunities} rows={3} />
      <LabeledTextarea label="待确认问题" value={openQuestions} onChange={setOpenQuestions} rows={3} />
      <LabeledTextarea label="变更说明" value={changeNote} onChange={setChangeNote} rows={3} />
      <button
        className="plain-button"
        type="button"
        onClick={() =>
          onSave(proposal.id, {
            title: title.trim(),
            summary: summary.trim(),
            projectGoal: projectGoal.trim(),
            targetUsers: splitLines(targetUsers),
            primaryScenarios: splitLines(primaryScenarios),
            coreProblem: coreProblem.trim(),
            designPrinciples: splitLines(designPrinciples),
            constraints: splitLines(constraints),
            avoidDirections: splitLines(avoidDirections),
            opportunities: splitLines(opportunities),
            openQuestions: splitLines(openQuestions),
            changeNote: changeNote.trim() || undefined
          })
        }
      >
        保存草案修改
      </button>
    </div>
  );
}

function ConceptDirectionProposalEditor({
  proposal,
  onSave
}: {
  proposal: ConceptDirectionProposal;
  onSave: ProposalDraftCardProps["onSaveConceptDirectionDraft"];
}) {
  const [title, setTitle] = useState(proposal.title);
  const [summary, setSummary] = useState(proposal.summary);
  const [directions, setDirections] = useState<ConceptDirectionDraft[]>(proposal.directions.map(cloneDirectionDraft));

  return (
    <div className="proposal-editor">
      <LabeledInput label="草案标题" value={title} onChange={setTitle} />
      <LabeledTextarea label="草案摘要" value={summary} onChange={setSummary} rows={3} />
      {directions.map((direction, index) => (
        <div className="proposal-direction-row" key={`${proposal.id}-direction-${index}`}>
          <strong>方向 {index + 1}</strong>
          <LabeledInput
            label="标题"
            value={direction.title}
            onChange={(value) => updateDirectionField(setDirections, index, { title: value })}
          />
          <LabeledTextarea
            label="摘要"
            value={direction.summary}
            onChange={(value) => updateDirectionField(setDirections, index, { summary: value })}
            rows={3}
          />
          <LabeledTextarea
            label="概念说明"
            value={direction.conceptStatement}
            onChange={(value) => updateDirectionField(setDirections, index, { conceptStatement: value })}
            rows={3}
          />
          <LabeledTextarea
            label="关键词"
            value={joinLines(direction.keywords)}
            onChange={(value) => updateDirectionField(setDirections, index, { keywords: splitLines(value) })}
            rows={3}
          />
          <LabeledTextarea
            label="策略"
            value={direction.strategy}
            onChange={(value) => updateDirectionField(setDirections, index, { strategy: value })}
            rows={3}
          />
          <LabeledTextarea
            label="差异点"
            value={joinLines(direction.differentiators)}
            onChange={(value) =>
              updateDirectionField(setDirections, index, { differentiators: splitLines(value) })
            }
            rows={3}
          />
          <LabeledTextarea
            label="视觉信号"
            value={joinLines(direction.visualSignals)}
            onChange={(value) => updateDirectionField(setDirections, index, { visualSignals: splitLines(value) })}
            rows={3}
          />
          <LabeledTextarea
            label="风险"
            value={joinLines(direction.risks)}
            onChange={(value) => updateDirectionField(setDirections, index, { risks: splitLines(value) })}
            rows={3}
          />
          <LabeledTextarea
            label="待确认问题"
            value={joinLines(direction.openQuestions)}
            onChange={(value) => updateDirectionField(setDirections, index, { openQuestions: splitLines(value) })}
            rows={3}
          />
        </div>
      ))}
      <button
        className="plain-button"
        type="button"
        onClick={() =>
          onSave(proposal.id, {
            title: title.trim(),
            summary: summary.trim(),
            directions: directions.map(cloneDirectionDraft)
          })
        }
      >
        保存草案修改
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="proposal-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  rows
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <label className="proposal-field">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function updateDirectionField(
  setDirections: Dispatch<SetStateAction<ConceptDirectionDraft[]>>,
  index: number,
  patch: Partial<ConceptDirectionDraft>
) {
  setDirections((current) =>
    current.map((direction, directionIndex) => (directionIndex === index ? { ...direction, ...patch } : direction))
  );
}

function cloneEvidence(evidence: ResearchEvidence): ResearchEvidence {
  return {
    claim: evidence.claim,
    confidence: evidence.confidence,
    citationIds: [...evidence.citationIds],
    sourceObjectIds: [...evidence.sourceObjectIds]
  };
}

function cloneDirectionDraft(direction: ConceptDirectionDraft): ConceptDirectionDraft {
  return {
    ...direction,
    keywords: [...direction.keywords],
    differentiators: [...direction.differentiators],
    visualSignals: [...direction.visualSignals],
    risks: [...direction.risks],
    openQuestions: [...direction.openQuestions]
  };
}

function joinLines(values: string[]): string {
  return values.join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function proposalTitle(proposal: ArtifactProposal): string {
  return proposal.title;
}

function proposalEditorKey(proposal: ArtifactProposal): string {
  return `${proposal.id}:${JSON.stringify(proposal)}`;
}

export function proposalTypeLabel(proposal: ArtifactProposal): string {
  switch (proposal.type) {
    case "researchAnalysis":
      return "研究与分析草案";
    case "designDefinition":
      return proposal.workIntent === "reviseDesignDefinition" ? "设计定义修订草案" : "设计定义草案";
    case "conceptDirection":
      return "概念方向草案";
    case "deliveryPlan":
      return "交付草案";
  }
}

export function proposalTargetMessage(workspace: MorphoWorkspace, proposal: ArtifactProposal): string | undefined {
  if (proposal.type === "designDefinition") {
    if (proposal.workIntent === "reviseDesignDefinition" && proposal.basedOnDesignDefinitionId) {
      const target = workspace.objects[proposal.basedOnDesignDefinitionId];
      if (target?.type === "designDefinition") {
        return `应用后会替换当前设计定义“${target.title}”的有效内容，并保留旧修订可回看。`;
      }
      return "应用后会替换当前设计定义的有效内容，并保留旧修订可回看。";
    }

    if (proposal.workIntent === "createDesignDefinition") {
      return "应用后会创建首版当前设计定义，成为后续方向生成的默认依据。";
    }
  }

  if (proposal.type === "conceptDirection") {
    switch (proposal.applicationMode) {
      case "revise": {
        const target = proposal.targetDirectionId ? workspace.objects[proposal.targetDirectionId] : undefined;
        if (target?.type === "conceptDirection") {
          return `本次操作：修订方向。修订目标：${target.title}（当前修订 ${target.currentRevisionId}）。`;
        }
        return "本次操作：修订方向。修订目标当前不可用，应用前需要重新生成或调整草案。";
      }
      case "split": {
        const parentTitle = formatDirectionTitles(workspace, proposal.parentDirectionIds);
        return `本次操作：拆分方向。拆分来源：${parentTitle || "当前原方向不可用"}。`;
      }
      case "merge": {
        const parentTitle = formatDirectionTitles(workspace, proposal.parentDirectionIds);
        return `本次操作：合并方向。合并来源：${parentTitle || "当前父方向不可用"}。`;
      }
      case "create":
      default:
        return "本次操作：新建方向。应用后会创建新的概念方向，不会自动设为主方向。";
    }
  }

  return undefined;
}

function formatDirectionTitles(workspace: MorphoWorkspace, directionIds: string[]): string {
  return directionIds
    .map((directionId) => workspace.objects[directionId])
    .filter((object) => object?.type === "conceptDirection")
    .map((object) => object.title)
    .join("、");
}

function proposalIntentLabel(intent: ArtifactProposal["workIntent"]): string {
  switch (intent) {
    case "comparison":
      return "比较与取舍";
    case "createDesignDefinition":
      return "创建设计定义";
    case "reviseDesignDefinition":
      return "修订设计定义";
    case "createConceptDirections":
      return "创建概念方向";
    case "reviseConceptDirection":
      return "修订概念方向";
    case "splitConceptDirection":
      return "拆分方向";
    case "mergeConceptDirections":
      return "合并方向";
    case "discussion":
    default:
      return "普通讨论";
  }
}

function proposalReviewStateLabel(reviewState: ArtifactProposal["reviewState"]): string {
  switch (reviewState) {
    case "sourceChanged":
      return "来源已变化";
    case "baseSuperseded":
      return "基础已更新";
    case "targetUnavailable":
      return "目标不可用";
    case "ready":
    default:
      return "可应用";
  }
}

function proposalReviewStateMessage(reviewState: ArtifactProposal["reviewState"]): string {
  switch (reviewState) {
    case "sourceChanged":
      return "这份草案生成后，来源对象已经变化。应用前请先复核字段。";
    case "baseSuperseded":
      return "这份草案依赖的定义或修订已经前进了一版。必要时请先复核或重新生成。";
    case "targetUnavailable":
      return "原始目标已经不可直接应用。这份草案仍可阅读和复制，但不能直接落入正式状态。";
    case "ready":
    default:
      return "这是一份可编辑草案。保存修改只会更新待处理 proposal，不会直接改正式项目状态。";
  }
}

function proposalReviewReasonLabel(reason: NonNullable<ArtifactProposal["reviewDetails"]>[number]["reason"]): string {
  switch (reason) {
    case "sourceContentChanged":
      return "语义内容已变化";
    case "sourceInactive":
      return "来源已隐藏";
    case "sourceUnavailable":
      return "来源已删除";
    case "baseRevisionSuperseded":
      return "基础版本已被替代";
    case "targetUnavailable":
      return "目标不可用";
  }
}
