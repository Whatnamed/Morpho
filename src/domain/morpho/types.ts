export type MorphoObjectId = string;
export type CanvasInstanceId = string;
export type MorphoRelationId = string;

export type MorphoObjectType =
  | "image"
  | "file"
  | "research"
  | "insight"
  | "designDefinition"
  | "conceptDirection"
  | "delivery";

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
  references: MorphoObjectId[];
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

export type AiMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
};

export type MorphoWorkspace = {
  schemaVersion: 1;
  project: {
    id: string;
    title: string;
    subtitle: string;
    currentFocus: "direction_visual_development" | "research" | "design_definition" | "delivery_preparation";
  };
  objects: Record<MorphoObjectId, MorphoObject>;
  relations: MorphoRelation[];
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
