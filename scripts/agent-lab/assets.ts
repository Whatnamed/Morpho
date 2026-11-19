import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { AgentTurnHost } from "@/features/workspace/agentTurnHost";
import {
  selectAiProviderImageAttachmentCandidates, type AiProviderImageAttachment, type VisualInputPackEntry
} from "@/features/workspace/aiAttachments";
import {
  MAX_AGENT_INPUT_IMAGE_BYTES, MAX_AGENT_INPUT_IMAGE_COUNT, MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES
} from "@/shared/agentImageInputLimits";

const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function loadAgentLabAssets(
  workspace: MorphoWorkspace,
  directory: string,
  files: Readonly<Record<string, string>>
) {
  const blobs = new Map<string, Buffer>();
  const fingerprints = Object.entries(files).map(([id, path]) => {
    const asset = workspace.assets[id];
    if (!asset || (asset.sourceType !== "documentExtract" && !imageMimeTypes.has(asset.mimeType))) {
      throw new Error(`Asset ${id} must be a fixture image or document extract.`);
    }
    const bytes = readFileSync(resolve(directory, path));
    if (!bytes.length) throw new Error(`Fixture asset ${id} is empty.`);
    blobs.set(asset.storageKey, bytes);
    return { id, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
  });
  const port: NonNullable<AgentTurnHost["sourceAssets"]> = {
    documents: {
      async get(storageKey) {
        const bytes = blobs.get(storageKey);
        return bytes ? new Blob([new Uint8Array(bytes)]) : null;
      }
    },
    async collectImages(current, ids, signal) {
      const attachments: AiProviderImageAttachment[] = [];
      const entries: VisualInputPackEntry[] = [];
      const skippedObjectIds: string[] = [];
      let byteLength = 0;
      for (const objectId of selectAiProviderImageAttachmentCandidates(current, ids)) {
        signal.throwIfAborted();
        const object = current.objects[objectId];
        const asset = object.type === "image" && object.assetId ? current.assets[object.assetId] : undefined;
        if (!asset) continue;
        const bytes = blobs.get(asset.storageKey);
        if (!bytes || !imageMimeTypes.has(asset.mimeType) || bytes.length > MAX_AGENT_INPUT_IMAGE_BYTES ||
          byteLength + bytes.length > MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES || attachments.length >= MAX_AGENT_INPUT_IMAGE_COUNT) {
          skippedObjectIds.push(objectId);
          entries.push({ objectId, representation: "single", status: "failed" });
          continue;
        }
        byteLength += bytes.length;
        attachments.push({
          id: asset.id, kind: "image", objectId, objectIds: [objectId],
          mimeType: asset.mimeType, dataUrl: `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
          byteSize: bytes.length, representation: "single", status: "ready"
        });
        entries.push({ objectId, representation: "single", status: "ready", attachmentId: asset.id });
      }
      return {
        attachments, entries, skippedObjectIds,
        warning: skippedObjectIds.length ? `Lab image pixels omitted: ${skippedObjectIds.join(", ")}` : undefined
      };
    }
  };
  return { port, fingerprints };
}
