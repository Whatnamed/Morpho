import type {
  AssetId,
  AssetRecord,
  DeliveryGap,
  DeliveryReference,
  DeliveryReferenceId,
  DeliveryReferenceSnapshot,
  DeliverySectionDraft,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace
} from "./types";

export const DELIVERY_OUTPUT_FORMAT = "morpho-delivery-output";
export const DELIVERY_OUTPUT_VERSION = "1";

export type DeliveryOutputAvailability =
  | "embedded"
  | "referenceOnly"
  | "missingBinary"
  | "sizeMismatch"
  | "noBinaryExpected";

export type DeliveryOutputIntegrityStatus = "ready" | "warning" | "blocked";

export type DeliveryOutputDiagnosticCode =
  | "delivery_output_target_missing"
  | "delivery_output_not_delivery"
  | "delivery_output_no_sections"
  | "delivery_output_no_references"
  | "delivery_output_reference_missing"
  | "delivery_output_reference_section_mismatch"
  | "delivery_output_asset_missing_metadata"
  | "delivery_output_asset_missing_binary"
  | "delivery_output_asset_size_mismatch"
  | "delivery_output_asset_path_collision"
  | "delivery_output_source_unavailable"
  | "delivery_output_open_gaps"
  | "delivery_output_pending_drafts"
  | "delivery_output_reference_only"
  | "invalid_delivery_output_format"
  | "invalid_delivery_output_version"
  | "invalid_delivery_output_structure"
  | "invalid_delivery_output_reference_consistency"
  | "invalid_delivery_output_asset_path"
  | "invalid_delivery_output_runtime_leak";

export type DeliveryOutputDiagnostic = {
  code: DeliveryOutputDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
};

export type DeliveryOutputManifest = {
  format: typeof DELIVERY_OUTPUT_FORMAT;
  outputVersion: typeof DELIVERY_OUTPUT_VERSION;
  createdAt: string;
  sourceProject: {
    id: string;
    title: string;
    subtitle: string;
  };
  delivery: {
    id: string;
    title: string;
    summary: string;
    format: "board" | "presentation";
  };
  integrity: {
    status: DeliveryOutputIntegrityStatus;
    diagnostics: DeliveryOutputDiagnostic[];
  };
  sections: Array<{
    id: string;
    title: string;
    purpose?: string;
    order: number;
    narrative?: string;
    referenceIds: string[];
  }>;
  references: Array<{
    referenceId: string;
    sectionId?: string;
    order: number;
    sourceObjectId?: string;
    sourceAssetId?: string;
    snapshot: DeliveryReferenceSnapshot;
    editorial?: {
      caption?: string;
      note?: string;
    };
    availability: DeliveryOutputAvailability;
    outputAssetPath?: string;
  }>;
  assets: Array<{
    assetId: string;
    originalFileName: string;
    mimeType: string;
    expectedByteLength: number;
    actualByteLength?: number;
    availability: DeliveryOutputAvailability;
    outputAssetPath?: string;
    referencedBy: string[];
    sourceType: AssetRecord["sourceType"];
    url?: string;
    domain?: string;
  }>;
  gaps: Array<{
    id: string;
    label: string;
    sectionId?: string;
    status: "open" | "resolved";
    origin: "manual" | "deliveryDraft";
  }>;
  pendingSectionDrafts: Array<{
    id: string;
    deliveryObjectId: string;
    sectionId: string;
    title?: string;
    status: string;
    narrative: string;
    captions: Array<{
      referenceId: string;
      caption: string;
    }>;
    suggestedGaps: Array<{
      label: string;
    }>;
  }>;
};

export type DeliveryOutputMarkdown = Record<
  "README.md" | "delivery-outline.md" | "captions-and-copy.md" | "gaps-and-next-steps.md" | "asset-index.md" | "source-map.json",
  string
>;

export type CreateDeliveryOutputManifestResult =
  | {
      status: "ready" | "warning";
      manifest: DeliveryOutputManifest;
      diagnostics: DeliveryOutputDiagnostic[];
    }
  | {
      status: "blocked";
      reason: string;
      diagnostics: DeliveryOutputDiagnostic[];
    };

export type DeliveryOutputAssetCandidate = DeliveryOutputManifest["assets"][number];

export function createDeliveryOutputManifest(
  workspace: MorphoWorkspace,
  input: { deliveryObjectId: MorphoObjectId; createdAt?: string }
): CreateDeliveryOutputManifestResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const target = workspace.objects[input.deliveryObjectId];
  if (!target) {
    return blocked("找不到要导出的交付准备包。", diagnostic("delivery_output_target_missing", "error", "Target delivery object is missing."));
  }
  if (target.type !== "delivery") {
    return blocked("当前对象不是交付准备包，无法导出。", diagnostic("delivery_output_not_delivery", "error", "Target object is not a delivery object."));
  }
  if (!Array.isArray(target.sections) || target.sections.length === 0) {
    return blocked("当前交付准备包还没有章节，暂时无法导出。", diagnostic("delivery_output_no_sections", "error", "Delivery object has no sections."));
  }

  const diagnostics: DeliveryOutputDiagnostic[] = [];
  const sections = [...target.sections]
    .sort((left, right) => left.order - right.order)
    .map((section, order) => ({
      id: section.id,
      title: section.title,
      purpose: section.purpose,
      order,
      narrative: section.narrative,
      referenceIds: [...section.referenceIds]
    }));
  const sectionIds = new Set(sections.map((section) => section.id));
  const deliveryReferenceIds = new Set(target.references);
  const assets = new Map<AssetId, DeliveryOutputManifest["assets"][number]>();
  const references: DeliveryOutputManifest["references"] = [];

  for (const section of sections) {
    for (const referenceId of section.referenceIds) {
      if (!deliveryReferenceIds.has(referenceId)) {
        diagnostics.push(
          diagnostic(
            "delivery_output_reference_missing",
            "error",
            `Section ${section.id} references ${referenceId}, but it is not owned by the selected delivery package.`,
            `sections.${section.id}.referenceIds`
          )
        );
        continue;
      }
    }
  }

  for (const referenceId of target.references) {
    const reference = workspace.deliveryReferences[referenceId];
    if (!reference || reference.deliveryObjectId !== target.id) {
      diagnostics.push(diagnostic("delivery_output_reference_missing", "error", `Delivery reference ${referenceId} is missing.`, `references.${referenceId}`));
      continue;
    }
    if (!reference.sectionId || !sectionIds.has(reference.sectionId)) {
      diagnostics.push(
        diagnostic(
          "delivery_output_reference_section_mismatch",
          "error",
          `Delivery reference ${referenceId} points to a missing section.`,
          `references.${referenceId}.sectionId`
        )
      );
    }
    const section = sections.find((candidate) => candidate.id === reference.sectionId);
    if (section && !section.referenceIds.includes(reference.id)) {
      diagnostics.push(
        diagnostic(
          "delivery_output_reference_section_mismatch",
          "error",
          `Delivery reference ${referenceId} is not listed by its section.`,
          `references.${referenceId}`
        )
      );
    }

    const source = reference.sourceObjectId ? workspace.objects[reference.sourceObjectId] : undefined;
    if (reference.sourceObjectId && !source) {
      diagnostics.push(
        diagnostic(
          "delivery_output_source_unavailable",
          "warning",
          `Source object ${reference.sourceObjectId} is unavailable; stable snapshot will be used.`,
          `references.${referenceId}.sourceObjectId`
        )
      );
    }

    const assetId = resolveReferenceAssetId(reference);
    const asset = assetId ? workspace.assets[assetId] : undefined;
    const referenceAvailability = resolveReferenceAvailability(reference, source, asset);
    const outputAssetPath =
      asset && referenceAvailability !== "referenceOnly" && referenceAvailability !== "noBinaryExpected"
        ? outputAssetPathForAsset(asset)
        : undefined;

    references.push({
      referenceId: reference.id,
      sectionId: reference.sectionId,
      order: reference.order ?? section?.referenceIds.indexOf(reference.id) ?? 0,
      sourceObjectId: reference.sourceObjectId,
      sourceAssetId: assetId,
      snapshot: reference.snapshot,
      editorial: reference.editorial,
      availability: referenceAvailability,
      outputAssetPath
    });

    if (assetId) {
      if (!asset) {
        diagnostics.push(
          diagnostic(
            "delivery_output_asset_missing_metadata",
            "warning",
            `Asset metadata for ${assetId} is missing.`,
            `references.${referenceId}.sourceAssetId`
          )
        );
        continue;
      }
      const existing = assets.get(asset.id);
      if (existing) {
        existing.referencedBy.push(reference.id);
        continue;
      }
      assets.set(asset.id, {
        assetId: asset.id,
        originalFileName: asset.fileName,
        mimeType: asset.mimeType,
        expectedByteLength: asset.size,
        availability: asset.sourceType === "originalLink" ? "referenceOnly" : "missingBinary",
        outputAssetPath: asset.sourceType === "originalLink" ? undefined : outputAssetPathForAsset(asset),
        referencedBy: [reference.id],
        sourceType: asset.sourceType,
        url: asset.url,
        domain: asset.domain
      });
    }
  }

  const pendingSectionDrafts = Object.values(workspace.deliverySectionDrafts)
    .filter((draft) => draft.deliveryObjectId === target.id && draft.status === "pending")
    .map(toOutputDraft);
  const gaps = target.gaps.map(toOutputGap);

  if (target.references.length === 0) {
    diagnostics.push(
      diagnostic(
        "delivery_output_no_references",
        "warning",
        "Delivery has sections but no stable references; output will be text-only."
      )
    );
  }
  if (gaps.some((gap) => gap.status === "open")) {
    diagnostics.push(diagnostic("delivery_output_open_gaps", "warning", "Delivery output still has open gaps."));
  }
  if (pendingSectionDrafts.length > 0) {
    diagnostics.push(diagnostic("delivery_output_pending_drafts", "warning", "Delivery output has pending section drafts."));
  }
  if ([...assets.values()].some((asset) => asset.availability === "referenceOnly")) {
    diagnostics.push(diagnostic("delivery_output_reference_only", "warning", "Delivery output contains reference-only link assets."));
  }

  const integrityStatus = diagnostics.some((item) => item.severity === "error")
    ? "blocked"
    : diagnostics.some((item) => item.severity === "warning")
      ? "warning"
      : "ready";

  const manifest: DeliveryOutputManifest = {
    format: DELIVERY_OUTPUT_FORMAT,
    outputVersion: DELIVERY_OUTPUT_VERSION,
    createdAt,
    sourceProject: {
      id: workspace.project.id,
      title: workspace.project.title,
      subtitle: workspace.project.subtitle
    },
    delivery: {
      id: target.id,
      title: target.title,
      summary: target.summary,
      format: target.format
    },
    integrity: {
      status: integrityStatus,
      diagnostics: dedupeDiagnostics(diagnostics)
    },
    sections,
    references,
    assets: [...assets.values()],
    gaps,
    pendingSectionDrafts
  };

  const validation = validateDeliveryOutputManifest(manifest);
  if (validation.status === "failed") {
    return {
      status: "blocked",
      reason: validation.reason,
      diagnostics: [...manifest.integrity.diagnostics, ...validation.diagnostics]
    };
  }
  if (integrityStatus === "blocked") {
    return {
      status: "blocked",
      reason: "交付输出结构无效，暂时无法导出。",
      diagnostics: manifest.integrity.diagnostics
    };
  }
  return {
    status: integrityStatus,
    manifest,
    diagnostics: manifest.integrity.diagnostics
  };
}

export function collectDeliveryOutputAssetCandidates(
  _workspace: MorphoWorkspace,
  manifest: DeliveryOutputManifest
): DeliveryOutputAssetCandidate[] {
  return manifest.assets.filter((asset) => asset.availability !== "referenceOnly" && asset.availability !== "noBinaryExpected");
}

export function buildDeliveryOutputMarkdown(manifest: DeliveryOutputManifest): DeliveryOutputMarkdown {
  return {
    "README.md": buildReadme(manifest),
    "delivery-outline.md": buildOutline(manifest),
    "captions-and-copy.md": buildCaptionsAndCopy(manifest),
    "gaps-and-next-steps.md": buildGapsAndNextSteps(manifest),
    "asset-index.md": buildAssetIndex(manifest),
    "source-map.json": JSON.stringify(buildSourceMap(manifest), null, 2)
  };
}

export function validateDeliveryOutputManifest(value: unknown):
  | { status: "ok"; manifest: DeliveryOutputManifest; diagnostics: DeliveryOutputDiagnostic[] }
  | { status: "failed"; reason: string; diagnostics: DeliveryOutputDiagnostic[] } {
  const diagnostics: DeliveryOutputDiagnostic[] = [];
  if (!isRecord(value)) {
    return failedValidation([diagnostic("invalid_delivery_output_structure", "error", "Manifest must be a JSON object.")]);
  }
  if (value.format !== DELIVERY_OUTPUT_FORMAT) {
    diagnostics.push(diagnostic("invalid_delivery_output_format", "error", `Expected ${DELIVERY_OUTPUT_FORMAT}.`, "format"));
  }
  if (value.outputVersion !== DELIVERY_OUTPUT_VERSION) {
    diagnostics.push(diagnostic("invalid_delivery_output_version", "error", `Expected outputVersion ${DELIVERY_OUTPUT_VERSION}.`, "outputVersion"));
  }
  if (containsRuntimeLeak(value)) {
    diagnostics.push(diagnostic("invalid_delivery_output_runtime_leak", "error", "Manifest must not expose runtime storage keys or object URLs."));
  }
  if (!isRecord(value.delivery) || (value.delivery.format !== "board" && value.delivery.format !== "presentation")) {
    diagnostics.push(diagnostic("invalid_delivery_output_structure", "error", "Delivery metadata is invalid.", "delivery"));
  }
  if (!Array.isArray(value.sections) || !Array.isArray(value.references) || !Array.isArray(value.assets)) {
    diagnostics.push(diagnostic("invalid_delivery_output_structure", "error", "Manifest sections, references, and assets must be arrays."));
  }
  if (diagnostics.length > 0) {
    return failedValidation(diagnostics);
  }

  const manifest = value as DeliveryOutputManifest;
  const sectionIds = new Set(manifest.sections.map((section) => section.id));
  const referenceIds = new Set(manifest.references.map((reference) => reference.referenceId));
  const sectionOrders = manifest.sections.map((section) => section.order);
  const sectionOrdersAreStable =
    sectionOrders.every((order) => Number.isInteger(order) && order >= 0) &&
    new Set(sectionOrders).size === sectionOrders.length &&
    sectionOrders
      .slice()
      .sort((left, right) => left - right)
      .every((order, index) => order === index);
  if (!sectionOrdersAreStable) {
    diagnostics.push(diagnostic("invalid_delivery_output_structure", "error", "Section order is not stable.", "sections"));
  }
  for (const section of manifest.sections) {
    for (const referenceId of section.referenceIds) {
      if (!referenceIds.has(referenceId)) {
        diagnostics.push(
          diagnostic(
            "invalid_delivery_output_reference_consistency",
            "error",
            `Section ${section.id} references missing delivery reference ${referenceId}.`,
            `sections.${section.id}.referenceIds`
          )
        );
      }
    }
  }
  for (const reference of manifest.references) {
    if (reference.sectionId && !sectionIds.has(reference.sectionId)) {
      diagnostics.push(
        diagnostic(
          "invalid_delivery_output_reference_consistency",
          "error",
          `Reference ${reference.referenceId} points to missing section ${reference.sectionId}.`,
          `references.${reference.referenceId}.sectionId`
        )
      );
    }
  }
  const outputPaths = manifest.assets.map((asset) => asset.outputAssetPath).filter((path): path is string => Boolean(path));
  if (new Set(outputPaths).size !== outputPaths.length) {
    diagnostics.push(diagnostic("invalid_delivery_output_asset_path", "error", "Asset output paths must be unique.", "assets"));
  }
  for (const asset of manifest.assets) {
    for (const referenceId of asset.referencedBy) {
      if (!referenceIds.has(referenceId)) {
        diagnostics.push(
          diagnostic(
            "invalid_delivery_output_reference_consistency",
            "error",
            `Asset ${asset.assetId} references unknown delivery reference ${referenceId}.`,
            `assets.${asset.assetId}.referencedBy`
          )
        );
      }
    }
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return failedValidation(diagnostics);
  }
  return { status: "ok", manifest, diagnostics };
}

export function updateDeliveryOutputManifestAssetAvailability(
  manifest: DeliveryOutputManifest,
  resolvedAssets: Array<{
    assetId: string;
    availability: DeliveryOutputAvailability;
    actualByteLength?: number;
    outputAssetPath?: string;
  }>
): DeliveryOutputManifest {
  const resolvedById = new Map(resolvedAssets.map((asset) => [asset.assetId, asset]));
  const diagnostics = manifest.integrity.diagnostics.filter(
    (item) => item.code !== "delivery_output_asset_missing_binary" && item.code !== "delivery_output_asset_size_mismatch"
  );
  const assets = manifest.assets.map((asset) => {
    const resolved = resolvedById.get(asset.assetId);
    if (!resolved) {
      return asset;
    }
    if (resolved.availability === "missingBinary") {
      diagnostics.push(
        diagnostic("delivery_output_asset_missing_binary", "warning", `Local binary for ${asset.assetId} is missing.`, `assets.${asset.assetId}`)
      );
    }
    if (resolved.availability === "sizeMismatch") {
      diagnostics.push(
        diagnostic(
          "delivery_output_asset_size_mismatch",
          "warning",
          `Local binary for ${asset.assetId} has a different byte length.`,
          `assets.${asset.assetId}`
        )
      );
    }
    return {
      ...asset,
      availability: resolved.availability,
      actualByteLength: resolved.actualByteLength,
      outputAssetPath: resolved.outputAssetPath ?? asset.outputAssetPath
    };
  });
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const references = manifest.references.map((reference) => {
    const asset = reference.sourceAssetId ? assetById.get(reference.sourceAssetId) : undefined;
    return asset
      ? {
          ...reference,
          availability: asset.availability,
          outputAssetPath: asset.outputAssetPath
        }
      : reference;
  });
  const status = diagnostics.some((item) => item.severity === "error")
    ? "blocked"
    : diagnostics.some((item) => item.severity === "warning")
      ? "warning"
      : "ready";
  return {
    ...manifest,
    integrity: {
      status,
      diagnostics: dedupeDiagnostics(diagnostics)
    },
    references,
    assets
  };
}

function buildReadme(manifest: DeliveryOutputManifest): string {
  const embedded = manifest.assets.filter((asset) => asset.availability === "embedded" || asset.availability === "sizeMismatch").length;
  const referenceOnly = manifest.assets.filter((asset) => asset.availability === "referenceOnly").length;
  const missingOrMismatch = manifest.assets.filter(
    (asset) => asset.availability === "missingBinary" || asset.availability === "sizeMismatch"
  ).length;
  const noBinary = manifest.references.filter((reference) => reference.availability === "noBinaryExpected").length;
  const openGaps = manifest.gaps.filter((gap) => gap.status === "open").length;
  const textOnlyLine =
    manifest.references.length === 0 ? "\n当前没有可带走的稳定素材；此包只包含已确认章节文字、缺口和来源结构。\n" : "";
  return [
    `# ${manifest.delivery.title}`,
    "",
    `- 输出包名称：${manifest.delivery.title}`,
    `- 来源项目：${manifest.sourceProject.title}`,
    `- 交付准备包：${manifest.delivery.title}（${formatLabel(manifest.delivery.format)}）`,
    `- 导出时间：${manifest.createdAt}`,
    `- 章节数量：${manifest.sections.length}`,
    `- 稳定引用数量：${manifest.references.length}`,
    `- 可导出本地资产数量：${embedded}`,
    `- 链接 / reference-only 内容数量：${referenceOnly}`,
    `- 无需本地文件内容数量：${noBinary}`,
    `- 缺失或大小异常资产数量：${missingOrMismatch}`,
    `- open gaps 数量：${openGaps}`,
    `- pending drafts 数量：${manifest.pendingSectionDrafts.length}`,
    textOnlyLine.trim(),
    "## 使用方式",
    "",
    "将 `assets/` 中可用素材导入 Figma / PPT / Keynote，再按 `delivery-outline.md` 组织章节与叙事。`captions-and-copy.md` 提供已应用图注与说明，`source-map.json` 提供追溯映射。",
    "",
    "此包不是项目归档，也不能恢复为可编辑项目；它不包含完整 workspace、聊天记录、restore 数据或最终排版文件。",
    "",
    "## 完整性提醒",
    "",
    `此输出包包含 ${embedded} 项可用本地素材，${referenceOnly} 项链接引用，${missingOrMismatch} 项缺失或大小异常本地二进制。`,
    "缺失素材没有伪造为空文件，具体情况见 `asset-index.md`。"
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildOutline(manifest: DeliveryOutputManifest): string {
  const lines = ["# 交付结构", ""];
  for (const section of manifest.sections) {
    lines.push(`## ${section.order + 1}. ${section.title}`, "");
    lines.push(`- purpose：${section.purpose ?? "未填写"}`);
    lines.push(`- narrative：${section.narrative ?? "未填写"}`);
    lines.push("- 稳定引用：");
    const refs = section.referenceIds
      .map((referenceId) => manifest.references.find((reference) => reference.referenceId === referenceId))
      .filter((reference): reference is DeliveryOutputManifest["references"][number] => Boolean(reference));
    if (refs.length === 0) {
      lines.push("  - 暂无稳定引用");
    }
    for (const reference of refs) {
      lines.push(
        `  - ${reference.snapshot.title} | 类型：${reference.snapshot.sourceType} | source：${reference.sourceObjectId ?? "无"} | 素材：${reference.outputAssetPath ?? availabilityLabel(reference.availability)}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildCaptionsAndCopy(manifest: DeliveryOutputManifest): string {
  const lines = ["# 图注与文案", ""];
  for (const section of manifest.sections) {
    lines.push(`## ${section.title}`, "");
    lines.push("### 已应用章节叙事", "");
    lines.push(section.narrative ?? "未填写");
    lines.push("", "### 稳定引用文案", "");
    for (const referenceId of section.referenceIds) {
      const reference = manifest.references.find((item) => item.referenceId === referenceId);
      if (!reference) {
        continue;
      }
      lines.push(`- ${reference.snapshot.title}`);
      lines.push(`  - caption：${reference.editorial?.caption ?? "未填写"}`);
      lines.push(`  - note：${reference.editorial?.note ?? "未填写"}`);
      lines.push(`  - source snapshot：${reference.snapshot.summary ?? reference.snapshot.body ?? "无摘要"}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildGapsAndNextSteps(manifest: DeliveryOutputManifest): string {
  const lines = ["# 待补内容与未应用草稿", "", "## 已记录 gaps", ""];
  if (manifest.gaps.length === 0) {
    lines.push("- 暂无已记录 gap");
  }
  for (const gap of manifest.gaps) {
    lines.push(`- ${gap.label} | ${gap.status} | section：${gap.sectionId ?? "未绑定"} | 来源：${gap.origin}`);
  }
  lines.push("", "## 未应用的 section drafts", "", "以下内容尚未应用，不代表当前交付内容。", "");
  if (manifest.pendingSectionDrafts.length === 0) {
    lines.push("- 暂无未应用草稿");
  }
  for (const draft of manifest.pendingSectionDrafts) {
    lines.push(`### ${draft.title ?? draft.id}`);
    lines.push(`- 状态：${draft.status}`);
    lines.push(`- section：${draft.sectionId}`);
    lines.push(`- narrative：${draft.narrative}`);
    lines.push("- captions：");
    lines.push(...listOrEmpty(draft.captions.map((caption) => `  - ${caption.referenceId}: ${caption.caption}`), "  - 无"));
    lines.push("- suggested gaps：");
    lines.push(...listOrEmpty(draft.suggestedGaps.map((gap) => `  - ${gap.label}`), "  - 无"));
  }
  return lines.join("\n");
}

function buildAssetIndex(manifest: DeliveryOutputManifest): string {
  const lines = ["# 素材索引", ""];
  if (manifest.assets.length === 0) {
    lines.push("- 暂无参与输出的本地素材");
  }
  for (const asset of manifest.assets) {
    lines.push(`## ${asset.originalFileName}`);
    lines.push(`- asset id：${asset.assetId}`);
    lines.push(`- mime type：${asset.mimeType}`);
    lines.push(`- expected byte size：${asset.expectedByteLength}`);
    lines.push(`- actual byte size：${asset.actualByteLength ?? "未读取"}`);
    lines.push(`- source type：${asset.sourceType}`);
    lines.push(`- 状态：${availabilityLabel(asset.availability)}`);
    lines.push(`- output package path：${asset.outputAssetPath ?? "无"}`);
    lines.push(`- 被引用：${asset.referencedBy.join("、") || "无"}`);
    if (asset.url) {
      lines.push(`- URL：${asset.url}`);
    }
    if (asset.domain) {
      lines.push(`- domain：${asset.domain}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildSourceMap(manifest: DeliveryOutputManifest) {
  const assetById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
  return {
    format: manifest.format,
    outputVersion: manifest.outputVersion,
    deliveryObjectId: manifest.delivery.id,
    references: manifest.references.map((reference) => {
      const asset = reference.sourceAssetId ? assetById.get(reference.sourceAssetId) : undefined;
      return {
        referenceId: reference.referenceId,
        sectionId: reference.sectionId,
        sourceObjectId: reference.sourceObjectId,
        sourceAssetId: reference.sourceAssetId,
        snapshot: reference.snapshot,
        editorial: reference.editorial,
        outputAssetPath: reference.outputAssetPath,
        availability: reference.availability,
        url: asset?.url,
        domain: asset?.domain
      };
    })
  };
}

function resolveReferenceAvailability(
  reference: DeliveryReference,
  source: MorphoObject | undefined,
  asset: AssetRecord | undefined
): DeliveryOutputAvailability {
  if (asset?.sourceType === "originalLink" || source?.type === "link" || reference.snapshot.sourceType === "link") {
    return "referenceOnly";
  }
  const assetId = resolveReferenceAssetId(reference);
  if (assetId) {
    return "missingBinary";
  }
  if (["image", "file"].includes(reference.snapshot.sourceType)) {
    return "missingBinary";
  }
  return "noBinaryExpected";
}

function resolveReferenceAssetId(reference: DeliveryReference): AssetId | undefined {
  return reference.sourceAssetId ?? reference.snapshot.previewAsset?.assetId ?? reference.snapshot.sourceFile?.sourceExtractAssetId;
}

function outputAssetPathForAsset(asset: AssetRecord): string {
  return `assets/${safePathPart(asset.id)}--${safeFileName(asset.fileName)}`;
}

function safeFileName(fileName: string): string {
  const trimmed = fileName.trim() || "asset";
  const safe = trimmed.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "asset";
}

function safePathPart(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function toOutputGap(gap: DeliveryGap): DeliveryOutputManifest["gaps"][number] {
  return {
    id: gap.id,
    label: gap.label,
    sectionId: gap.sectionId,
    status: gap.status,
    origin: gap.origin
  };
}

function toOutputDraft(draft: DeliverySectionDraft): DeliveryOutputManifest["pendingSectionDrafts"][number] {
  return {
    id: draft.id,
    deliveryObjectId: draft.deliveryObjectId,
    sectionId: draft.sectionId,
    title: draft.title,
    status: draft.status,
    narrative: draft.narrative,
    captions: draft.captions.map((caption) => ({ ...caption })),
    suggestedGaps: draft.suggestedGaps.map((gap) => ({ ...gap }))
  };
}

function blocked(reason: string, ...diagnostics: DeliveryOutputDiagnostic[]): CreateDeliveryOutputManifestResult {
  return { status: "blocked", reason, diagnostics };
}

function diagnostic(
  code: DeliveryOutputDiagnosticCode,
  severity: DeliveryOutputDiagnostic["severity"],
  message: string,
  path?: string
): DeliveryOutputDiagnostic {
  return { code, severity, message, path };
}

function failedValidation(diagnostics: DeliveryOutputDiagnostic[]) {
  return {
    status: "failed" as const,
    reason: "Delivery output manifest failed validation.",
    diagnostics: dedupeDiagnostics(diagnostics)
  };
}

function dedupeDiagnostics(diagnostics: DeliveryOutputDiagnostic[]): DeliveryOutputDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.severity}|${diagnostic.path ?? ""}|${diagnostic.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function containsRuntimeLeak(value: unknown): boolean {
  if (typeof value === "string") {
    return value.startsWith("blob:") || value.startsWith("storage:");
  }
  if (Array.isArray(value)) {
    return value.some(containsRuntimeLeak);
  }
  if (isRecord(value)) {
    return Object.entries(value).some(([key, entry]) => key === "storageKey" || containsRuntimeLeak(entry));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatLabel(format: "board" | "presentation"): string {
  return format === "board" ? "展板" : "演示文稿";
}

function availabilityLabel(availability: DeliveryOutputAvailability): string {
  switch (availability) {
    case "embedded":
      return "已打包";
    case "referenceOnly":
      return "仅链接引用";
    case "missingBinary":
      return "缺失本地文件";
    case "sizeMismatch":
      return "文件大小异常";
    case "noBinaryExpected":
      return "无需本地二进制";
  }
}

function listOrEmpty(lines: string[], empty: string): string[] {
  return lines.length > 0 ? lines : [empty];
}
