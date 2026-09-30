import type { EvidenceBasis, ResearchEvidence } from "../operations/types";
import type { MorphoObject, MorphoWorkspace } from "./types";
import { captureSourceSnapshots, resolveSource } from "./sourceResolution";
import { normalizeResearchItem } from "../operations/researchItems";

export type EvidenceQualification = {
  confidence: ResearchEvidence["confidence"];
  issues: string[];
  usableObjectIds: string[];
  usableCitationIds: string[];
};

export function captureEvidenceBasis(workspace: MorphoWorkspace, evidence: ResearchEvidence): EvidenceBasis {
  return {
    confidence: evidence.confidence,
    sourceSnapshots: captureSourceSnapshots(workspace, evidence.sourceObjectIds),
    citationSnapshots: evidence.citationIds.flatMap((id) => workspace.citationSnapshots[id] ? [{ ...workspace.citationSnapshots[id] }] : [])
  };
}

export function qualifyEvidence(workspace: MorphoWorkspace, evidence: ResearchEvidence): EvidenceQualification {
  const issues: string[] = [];
  const usableObjectIds: string[] = [];
  const usableCitationIds: string[] = [];
  if (!evidence.basis) issues.push("evidenceBasisUnknown");
  for (const id of evidence.sourceObjectIds) {
    const baseline = evidence.basis?.sourceSnapshots.find((snapshot) => snapshot.objectId === id);
    const source = resolveSource(workspace, id, baseline);
    const object = workspace.objects[id];
    if (source.existence === "missing") issues.push(`sourceMissing:${id}`);
    else if (source.visibility !== "active") issues.push(`sourceHidden:${id}`);
    else if (source.content !== "available") issues.push(`sourceContentUnavailable:${id}`);
    else if (source.freshness !== "current") issues.push(`source${source.freshness === "changed" ? "Changed" : "BasisUnknown"}:${id}`);
    else if (object?.type === "research" || (object?.type === "keyConclusion" && (object.state !== "active" || object.confidence === "needsVerification"))) issues.push(`sourceCandidateOrUnverified:${id}`);
    else usableObjectIds.push(id);
  }
  for (const id of evidence.citationIds) {
    const citation = workspace.citationSnapshots[id];
    const baseline = evidence.basis?.citationSnapshots.find((item) => item.id === id);
    if (!citation || !/^https?:\/\//i.test(citation.url ?? "")) issues.push(`citationUnavailable:${id}`);
    else if (!baseline) issues.push(`citationBasisUnknown:${id}`);
    else if (JSON.stringify(citation) !== JSON.stringify(baseline)) issues.push(`citationChanged:${id}`);
    else usableCitationIds.push(id);
  }
  const confidence = evidence.basis?.confidence ?? evidence.confidence;
  return {
    confidence: usableObjectIds.length + usableCitationIds.length === 0 || !evidence.basis
      ? "needsVerification"
      : confidence === "supported" && issues.length > 0 ? "partial" : confidence,
    issues, usableObjectIds, usableCitationIds
  };
}

export function qualifyObjectEvidence(workspace: MorphoWorkspace, object: MorphoObject): MorphoObject {
  if (object.type === "research") return { ...object, evidence: object.evidence?.map((entry) => ({ ...entry, ...(!entry.basis ? { reportedConfidence: entry.reportedConfidence ?? entry.confidence } : {}), confidence: qualifyEvidence(workspace, entry).confidence })) };
  if (object.type !== "keyConclusion") return object;
  const qualifications = (object.evidence ?? []).map((entry) => entry.claim === object.body || (entry.item && normalizeResearchItem(entry.item.text) === normalizeResearchItem(object.body)) ? qualifyEvidence(workspace, entry) : { confidence: "needsVerification" as const });
  const confidence: ResearchEvidence["confidence"] = qualifications.length === 0 || qualifications.some((item) => item.confidence === "needsVerification")
    ? "needsVerification" : qualifications.every((item) => item.confidence === "supported") ? "supported" : "partial";
  return { ...object, ...(!object.evidence ? { reportedConfidence: object.reportedConfidence ?? object.confidence } : {}), confidence };
}

export function evidenceConfidenceLabel(confidence: ResearchEvidence["confidence"]): string {
  return confidence === "supported" ? "有依据" : confidence === "partial" ? "部分依据" : "依据待复核";
}
