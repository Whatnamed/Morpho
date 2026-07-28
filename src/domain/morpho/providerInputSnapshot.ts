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

export function providerInputSnapshotDurableContent(snapshot: ProviderInputSnapshot): ProviderInputTextContent[] {
  const text = providerInputSnapshotText(snapshot).map((part) => ({ type: "input_text" as const, text: part }));
  const refs = snapshot.attachmentRefs
    .filter((ref) => ref.contentHash && ref.mimeType)
    .map((ref) => ({
      objectId: ref.objectId,
      ...(ref.assetId ? { assetId: ref.assetId } : {}),
      contentHash: ref.contentHash!,
      mimeType: ref.mimeType!
    }));
  return refs.length > 0
    ? [...text, {
        type: "input_text",
        text: `[Morpho Durable Image References | data only]\n${JSON.stringify(refs)}`
      }]
    : text;
}

export function parseProviderInputSnapshotDurableReferences(
  text: string
): ProviderInputSnapshotAttachmentRef[] {
  const prefix = "[Morpho Durable Image References | data only]\n";
  if (!text.startsWith(prefix)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(prefix.length));
    if (!Array.isArray(parsed)) {
      return [];
    }
    const refs = parsed.map((entry): ProviderInputSnapshotAttachmentRef | undefined => {
      if (!isRecord(entry) || typeof entry.objectId !== "string" || entry.objectId.length < 1 ||
        (entry.assetId !== undefined && typeof entry.assetId !== "string") ||
        typeof entry.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(entry.contentHash) ||
        typeof entry.mimeType !== "string" || !/^image\/[A-Za-z0-9.+-]+$/.test(entry.mimeType)) {
        return undefined;
      }
      return {
        objectId: entry.objectId,
        ...(entry.assetId ? { assetId: entry.assetId } : {}),
        contentHash: entry.contentHash,
        mimeType: entry.mimeType
      };
    });
    return refs.every((ref): ref is ProviderInputSnapshotAttachmentRef => Boolean(ref)) ? refs : [];
  } catch {
    return [];
  }
}

export function hashProviderImageDataUrl(dataUrl: string): string {
  return hashAgentProtocolValue(dataUrl, "morpho-agent-provider-image-content-v1");
}

export function createProviderOutputSnapshot(text: string): import("./types").ProviderOutputSnapshot {
  return {
    schemaVersion: 1,
    text,
    contentHash: hashAgentProtocolValue(text, "morpho-agent-provider-output-snapshot-v1")
  };
}

export function normalizeProviderOutputSnapshot(value: unknown): import("./types").ProviderOutputSnapshot | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.text !== "string" ||
    typeof value.contentHash !== "string") {
    return undefined;
  }
  const snapshot = createProviderOutputSnapshot(value.text);
  return snapshot.contentHash === value.contentHash ? snapshot : undefined;
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
