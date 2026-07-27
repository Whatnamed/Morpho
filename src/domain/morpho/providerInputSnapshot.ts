import type {
  ProviderInputCacheBoundaryReason,
  ProviderInputSnapshot,
  ProviderInputSnapshotAttachmentRef,
  ProviderInputSnapshotTextPart,
  ProviderInputSnapshotTextPartKind
} from "./types";
import { hashAgentProtocolValue } from "@/shared/agentCompactionProtocol";

type ProviderInputTextContent = {
  type: "input_text" | "output_text";
  text: string;
};

type ProviderInputContent = ProviderInputTextContent | { type: "input_image"; image_url: string };

export function createProviderInputSnapshot(input: {
  message: { content: readonly ProviderInputContent[] };
  promptContractVersion: string;
  attachmentRefs?: readonly ProviderInputSnapshotAttachmentRef[];
  textParts?: readonly ProviderInputSnapshotTextPart[];
  cacheBoundaryReason?: ProviderInputCacheBoundaryReason;
}): ProviderInputSnapshot {
  const textParts = normalizeTextParts(
    input.textParts ??
      input.message.content.flatMap((part) =>
        "text" in part ? [{ kind: "other" as const, text: part.text }] : []
      )
  );
  const attachmentRefs = normalizeAttachmentRefs(input.attachmentRefs ?? []);
  const cacheBoundaryReason = input.cacheBoundaryReason ?? (attachmentRefs.length > 0 ? "imageInput" : undefined);

  return {
    schemaVersion: 1,
    promptContractVersion: input.promptContractVersion,
    textParts,
    attachmentRefs,
    serializedTextHash: hashProviderInputSnapshotText(textParts),
    ...(cacheBoundaryReason ? { cacheBoundaryReason } : {})
  };
}

export function normalizeProviderInputSnapshot(value: unknown): ProviderInputSnapshot | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.promptContractVersion !== "string") {
    return undefined;
  }
  const textParts = normalizeTextParts(value.textParts);
  const attachmentRefs = normalizeAttachmentRefs(value.attachmentRefs);
  // Reissue the digest so legacy short hashes cannot remain part of a current
  // provider-input boundary after a workspace is loaded.
  const serializedTextHash = hashProviderInputSnapshotText(textParts);
  const cacheBoundaryReason = isCacheBoundaryReason(value.cacheBoundaryReason)
    ? value.cacheBoundaryReason
    : undefined;
  return {
    schemaVersion: 1,
    promptContractVersion: value.promptContractVersion,
    textParts,
    attachmentRefs,
    serializedTextHash,
    ...(cacheBoundaryReason ? { cacheBoundaryReason } : {})
  };
}

export function providerInputSnapshotText(snapshot: ProviderInputSnapshot): string[] {
  return snapshot.textParts.map((part) => part.text);
}

export function hashProviderInputSnapshotText(textParts: readonly ProviderInputSnapshotTextPart[]): string {
  return hashAgentProtocolValue(
    textParts.map((part) => ({ kind: part.kind, text: part.text })),
    "morpho-agent-provider-input-snapshot-v2"
  );
}

function normalizeTextParts(value: unknown): ProviderInputSnapshotTextPart[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.text !== "string") {
      return [];
    }
    const kind = isTextPartKind(candidate.kind) ? candidate.kind : "other";
    return [{ kind, text: candidate.text }];
  });
}

function normalizeAttachmentRefs(value: unknown): ProviderInputSnapshotAttachmentRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.objectId !== "string" || !candidate.objectId) {
      return [];
    }
    return [{
      objectId: candidate.objectId,
      ...(typeof candidate.assetId === "string" ? { assetId: candidate.assetId } : {}),
      ...(typeof candidate.contentHash === "string" ? { contentHash: candidate.contentHash } : {}),
      ...(typeof candidate.mimeType === "string" ? { mimeType: candidate.mimeType } : {})
    }];
  });
}

function isTextPartKind(value: unknown): value is ProviderInputSnapshotTextPartKind {
  return value === "userDraft" || value === "turnContract" || value === "documentExtract" || value === "other";
}

function isCacheBoundaryReason(value: unknown): value is ProviderInputCacheBoundaryReason {
  return value === "imageInput" ||
    value === "legacyProviderInput" ||
    value === "documentSnapshotUnavailable" ||
    value === "toolProfileChanged" ||
    value === "promptContractChanged" ||
    value === "compaction";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
