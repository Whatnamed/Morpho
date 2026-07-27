import type { ReadSelectedContextResult } from "./morphoAgent";
import type { ProviderTaskContext, TaskContextResult } from "./taskContext";

export function buildReadSelectedContextResult(
  context: TaskContextResult,
  providerTaskContext: ProviderTaskContext
): ReadSelectedContextResult {
  return {
    objectSummaries: context.semanticSummaries.map((summary) => ({
      id: summary.id,
      type: summary.type,
      title: summary.title,
      summary: summary.summary,
      detail: summary.detail
    })),
    directDocumentTitles: context.documentFragmentExtracts.map((extract) => extract.title),
    proposalDrafts: context.proposalDrafts,
    imageObjectIds: [...context.imageObjectIds],
    objectIds: [...context.objectIds],
    defaultReference: providerTaskContext.defaultReference,
    scopeNote: context.scopeNote,
    designDefinitionTitle: providerTaskContext.designDefinition?.title,
    directionTitles: providerTaskContext.directions.map((direction) => direction.title)
  };
}
