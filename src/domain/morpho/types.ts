export type MorphoObjectId = string;
export type CanvasInstanceId = string;
export type MorphoRelationId = string;
export type DeliveryReferenceId = string;
export type DecisionRecordId = string;

export type MorphoObjectType =
  | "image"
  | "file"
  | "research"
  | "insight"
  | "designDefinition"
  | "conceptDirection"
  | "delivery";

export type ObjectVisibility = "active" | "hidden";

export type ImageRole =
  | "reference"
  | "preview"
  | "main"
  | "scenario"
  | "cmf"
  | "detail"
  | "diagram";

export type ConceptDirectionStatus = "pendingPreview" | "primary" | "alternative" | "eliminated" | "needsReview";

export type DeliveryGap = {
  id: string;
  label: string;
};

export type MorphoObjectBase = {
  id: MorphoObjectId;
  type: MorphoObjectType;
  title: string;
  summary: string;
  createdBy: "user" | "ai";
  visibility: ObjectVisibility;
};

export type ImageObject = MorphoObjectBase & {
  type: "image";
  role: ImageRole;
  imageVariant: "path" | "rail" | "detail" | "scenario" | "cmf" | "supportIsland" | "softGuide";
  directionId?: MorphoObjectId;
  isDefaultReference?: boolean;
};

export type FileObject = MorphoObjectBase & {
  type: "file";
  fileKind: "pdf" | "imageSet" | "document";
  sourceLabel: string;
};

export type ResearchObject = MorphoObjectBase & {
  type: "research";
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
};

export type InsightObject = MorphoObjectBase & {
  type: "insight";
  insightState?: "needsValidation" | "superseded";
};

export type DesignDefinitionObject = MorphoObjectBase & {
  type: "designDefinition";
  problem: string;
  principles: string[];
  avoid: string[];
  revisionState?: "draftRevision";
};

export type ConceptDirectionObject = MorphoObjectBase & {
  type: "conceptDirection";
  status: ConceptDirectionStatus;
  keywords: string[];
};

export type DeliveryObject = MorphoObjectBase & {
  type: "delivery";
  format: "board" | "presentation";
  gaps: DeliveryGap[];
  references: DeliveryReferenceId[];
};

export type MorphoObject =
  | ImageObject
  | FileObject
  | ResearchObject
  | InsightObject
  | DesignDefinitionObject
  | ConceptDirectionObject
  | DeliveryObject;

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasSize = {
  w: number;
  h: number;
};

export type CanvasInstance = {
  id: CanvasInstanceId;
  objectId: MorphoObjectId;
  position: CanvasPoint;
  size: CanvasSize;
};

export type CanvasView = {
  x: number;
  y: number;
  zoom: number;
};

export type RelationKind =
  | "source"
  | "supports"
  | "belongsToDirection"
  | "version"
  | "defaultReference"
  | "deliveryReference";

export type MorphoRelation = {
  id: MorphoRelationId;
  kind: RelationKind;
  fromObjectId: MorphoObjectId;
  toObjectId: MorphoObjectId;
  note: string;
};

export type DeliveryReferenceSnapshot = {
  sourceType: MorphoObjectType;
  title: string;
  summary?: string;
  caption?: string;
  previewAsset?: {
    url?: string;
    alt: string;
  };
};

export type DeliveryReference = {
  id: DeliveryReferenceId;
  sourceObjectId?: MorphoObjectId;
  createdAt: string;
  snapshot: DeliveryReferenceSnapshot;
};

export type DecisionKind =
  | "setDefaultReference"
  | "setDirectionStatus"
  | "createDeliveryReference"
  | "replaceDeliveryReference"
  | "removeDeliveryReference"
  | "deleteObject";

export type ObjectSnapshot = {
  id: MorphoObjectId;
  type: MorphoObjectType;
  title: string;
};

export type DecisionRecord = {
  id: DecisionRecordId;
  kind: DecisionKind;
  createdAt: string;
  summary: string;
  reason?: string;
  objectSnapshot?: ObjectSnapshot;
  relatedObjectIds: MorphoObjectId[];
};

export type AiMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
};

export type MorphoWorkspace = {
  schemaVersion: 2;
  project: {
    id: string;
    title: string;
    subtitle: string;
    currentFocus: "direction_visual_development" | "research" | "design_definition" | "delivery_preparation";
  };
  objects: Record<MorphoObjectId, MorphoObject>;
  relations: MorphoRelation[];
  deliveryReferences: Record<DeliveryReferenceId, DeliveryReference>;
  decisionRecords: DecisionRecord[];
  canvas: {
    view: CanvasView;
    instances: CanvasInstance[];
  };
  ai: {
    messages: AiMessage[];
  };
};

export type AiSuggestionInput = {
  selectedObjectIds: MorphoObjectId[];
  suggestion: string;
};

export type AiDraftResult = {
  workspace: MorphoWorkspace;
  draft: string;
  contextObjectIds: MorphoObjectId[];
};

export type AiContextTask = "general" | "visualDevelopment" | "deliveryPreparation";

export type AiDefaultReferenceStatus =
  | {
      status: "available";
      objectId: MorphoObjectId;
    }
  | {
      status: "hidden";
      objectId: MorphoObjectId;
      message: string;
    }
  | {
      status: "missing";
      message: string;
    }
  | {
      status: "notRelevant";
    };

export type AssembleAiContextInput = {
  draft: string;
  selectedObjectIds: MorphoObjectId[];
  explicitObjectIds: MorphoObjectId[];
  task: AiContextTask;
};

export type AssembledAiContext = {
  draft: string;
  objectIds: MorphoObjectId[];
  defaultReferenceStatus: AiDefaultReferenceStatus;
};

export type WorkspaceMigrationResult =
  | {
      status: "ok";
      workspace: MorphoWorkspace;
      didMigrate: boolean;
    }
  | {
      status: "failed";
      reason: string;
    };
