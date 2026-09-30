import type { MorphoObject, MorphoWorkspace } from "./types";
import type { SourceSemanticSnapshot } from "../operations/types";

export type SourceResolution = {
  objectId: string;
  existence: "present" | "missing";
  visibility: "active" | "hidden" | "unknown";
  content: "available" | "referenceOnly" | "unavailable";
  freshness: "current" | "changed" | "unknown";
  // This resolver cannot establish IndexedDB Blob readability.
  binaryAvailability: "notChecked";
  snapshot?: SourceSemanticSnapshot;
};

export function captureSourceSnapshot(workspace: MorphoWorkspace, objectId: string): SourceSemanticSnapshot {
  const object = workspace.objects[objectId];
  return {
    objectId,
    objectType: object?.type ?? "unknown",
    visibility: object?.visibility ?? "missing",
    fingerprintVersion: 2,
    semanticFingerprint: fingerprint(object ? semanticContent(workspace, object) : { missing: objectId })
  };
}

export function captureSourceSnapshots(workspace: MorphoWorkspace, objectIds: string[]): SourceSemanticSnapshot[] {
  return [...new Set(objectIds)].map((id) => captureSourceSnapshot(workspace, id));
}

export function resolveSource(workspace: MorphoWorkspace, objectId: string, baseline?: SourceSemanticSnapshot): SourceResolution {
  const object = workspace.objects[objectId];
  if (!object) return { objectId, existence: "missing", visibility: "unknown", content: "unavailable", freshness: baseline ? "changed" : "unknown", binaryAvailability: "notChecked" };
  const snapshot = captureSourceSnapshot(workspace, objectId);
  let content: SourceResolution["content"] = "available";
  if (object.type === "file") {
    content = object.parseStatus === "parsed" && object.extractedAssetId && workspace.assets[object.extractedAssetId] ? "available" : "unavailable";
  } else if (object.type === "link") {
    content = "referenceOnly";
  } else if (object.type === "documentFragment") {
    const file = workspace.objects[object.source.fileObjectId];
    content = file?.type === "file" && file.visibility === "active" && file.extractedAssetId === object.source.sourceExtractAssetId && workspace.assets[object.source.sourceExtractAssetId] ? "available" : "unavailable";
  } else if (object.type === "image") {
    content = object.assetId && workspace.assets[object.assetId] ? "available" : "unavailable";
  } else if (object.type === "proposalDraft" || object.type === "imageCollection") {
    content = "referenceOnly";
  }
  return {
    objectId, existence: "present", visibility: object.visibility, content,
    freshness: baseline?.fingerprintVersion === 2
      ? baseline.semanticFingerprint === snapshot.semanticFingerprint && baseline.objectType === snapshot.objectType ? "current" : "changed"
      : "unknown",
    binaryAvailability: "notChecked", snapshot
  };
}

function semanticContent(workspace: MorphoWorkspace, object: MorphoObject): unknown {
  const common = { type: object.type };
  switch (object.type) {
    case "text": return { ...common, body: object.body };
    case "file": return { ...common, ...fileContent(workspace, object) };
    case "link": return { ...common, url: object.url, domain: object.domain, editableTitle: object.editableTitle, description: object.description, assetId: object.assetId };
    case "documentFragment": {
      const file = workspace.objects[object.source.fileObjectId];
      return { ...common, body: object.body, source: object.source, file: file?.type === "file" ? { visibility: file.visibility, ...fileContent(workspace, file) } : { missing: true } };
    }
    case "research": return { ...common, findings: object.findings, opportunities: object.opportunities, constraints: object.constraints, openQuestions: object.openQuestions, evidence: object.evidence, provenance: object.provenance };
    case "keyConclusion": return { ...common, body: object.body, category: object.category, state: object.state, confidence: object.confidence, supersededById: object.supersededById, evidence: object.evidence, researchOrigin: object.researchOrigin };
    case "designDefinition": return { ...common, currentRevisionId: object.currentRevisionId, isCurrentEffective: object.isCurrentEffective, revision: workspace.designDefinitionRevisions[object.currentRevisionId] };
    case "conceptDirection": return { ...common, currentRevisionId: object.currentRevisionId, status: object.status, revision: workspace.directionRevisions[object.currentRevisionId] };
    case "image": return { ...common, assetId: object.assetId, asset: object.assetId ? assetIdentity(workspace, object.assetId) : undefined, role: object.role };
    case "imageCollection": return { ...common, memberObjectIds: object.memberObjectIds };
    case "proposalDraft": return { ...common, proposalId: object.proposalId };
    case "delivery": return { ...common, sections: object.sections, gaps: object.gaps };
  }
}

function fileContent(workspace: MorphoWorkspace, file: Extract<MorphoObject, { type: "file" }>) {
  return { assetId: file.assetId, asset: file.assetId ? assetIdentity(workspace, file.assetId) : undefined, fileName: file.fileName, mimeType: file.mimeType, parseStatus: file.parseStatus, extractedAssetId: file.extractedAssetId, extract: file.extractedAssetId ? assetIdentity(workspace, file.extractedAssetId) : undefined, extractedCharCount: file.extractedCharCount, extractedPageCount: file.extractedPageCount, sourcePageCount: file.sourcePageCount, extractionTruncated: file.extractionTruncated, parsedAt: file.parsedAt, parseError: file.parseError };
}

function assetIdentity(workspace: MorphoWorkspace, id: string) {
  const asset = workspace.assets[id];
  return asset ? { id: asset.id, sourceType: asset.sourceType, size: asset.size, mimeType: asset.mimeType } : { missing: id };
}

// Bounded change detector, not a security proof or a Blob content hash.
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    first = Math.imul(first ^ text.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ text.charCodeAt(index), 0x85ebca6b);
  }
  return `v2:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}:${text.length}`;
}
