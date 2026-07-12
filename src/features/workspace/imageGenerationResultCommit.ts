import { createGeneratedImageFromAsset } from "@/domain/morpho/generation";
import {
  recordImageGenerationOperationItemFailure,
  recordImageGenerationOperationResult
} from "@/domain/operations/operations";
import type {
  AssetRecord,
  CanvasPoint,
  CanvasSize,
  ImageGenerationMetadata,
  ImageRole,
  MorphoWorkspace
} from "@/domain/morpho/types";

export type ImageGenerationResultCommit =
  | {
      status: "succeeded";
      operationId: string;
      providerTaskId?: string;
      asset: AssetRecord;
      generation: ImageGenerationMetadata;
      sourceObjectIds: string[];
      directionObjectId?: string;
      visualBranchId?: string;
      title: string;
      summary: string;
      role: ImageRole;
      position?: CanvasPoint;
      canvasSize?: CanvasSize;
    }
  | {
      status: "failed";
      operationId: string;
      planItemId: string;
      reason: string;
    };

export type ApplyImageGenerationResultCommit = {
  workspace: MorphoWorkspace;
  createdObjectId?: string;
};

export function applyImageGenerationResultCommit(
  workspace: MorphoWorkspace,
  result: ImageGenerationResultCommit
): ApplyImageGenerationResultCommit {
  if (result.status === "failed") {
    return {
      workspace: recordImageGenerationOperationItemFailure(workspace, {
        operationId: result.operationId,
        planItemId: result.planItemId,
        reason: result.reason
      })
    };
  }

  const generated = createGeneratedImageFromAsset(workspace, {
    asset: result.asset,
    generation: result.generation,
    sourceObjectIds: result.sourceObjectIds,
    directionObjectId: result.directionObjectId,
    visualBranchId: result.visualBranchId,
    title: result.title,
    summary: result.summary,
    role: result.role,
    position: result.position,
    canvasSize: result.canvasSize
  });

  return {
    workspace: recordImageGenerationOperationResult(generated.workspace, {
      operationId: result.operationId,
      providerTaskId: result.providerTaskId,
      resultObjectId: generated.createdObjectId
    }),
    createdObjectId: generated.createdObjectId
  };
}
