import { describe, expect, it } from "vitest";

import {
  parseDeliverySectionDraftPayload,
  sanitizeDeliverySectionDraftStreamForDisplay,
  stripDeliverySectionDraftTechnicalBlocks,
  validateDeliverySectionDraftPayload
} from "./deliverySectionDraftBlock";

describe("delivery section draft structured block", () => {
  const authorization = {
    deliveryObjectId: "delivery-a",
    sectionId: "section-a",
    referenceIds: ["ref-a", "ref-b"]
  };

  it("parses valid prose plus morphoDeliverySectionDraft without exposing raw JSON", () => {
    const result = parseDeliverySectionDraftPayload([
      "这里是普通说明。",
      "```json",
      JSON.stringify({
        morphoDeliverySectionDraft: {
          title: "章节标题建议",
          narrative: "本节说明文字。",
          captions: [{ referenceId: "ref-a", caption: "主图图注" }],
          suggestedGaps: [{ label: "补一张安装示意" }]
        }
      }),
      "```"
    ].join("\n"));

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.draft.narrative).toBe("本节说明文字。");
    expect(validateDeliverySectionDraftPayload(result.draft, authorization)).toEqual({ status: "ok" });
  });

  it("rejects malformed, wrong-reference, too-many-gap, and mixed proposal blocks", () => {
    expect(parseDeliverySectionDraftPayload("```json\n{\"morphoDeliverySectionDraft\": bad\n```").status).toBe("failed");
    expect(
      parseDeliverySectionDraftPayload([
        "```json",
        JSON.stringify({ morphoConceptDirectionProposal: { title: "方向", summary: "", directions: [] } }),
        "```",
        "```json",
        JSON.stringify({ morphoDeliverySectionDraft: { narrative: "说明", captions: [], suggestedGaps: [] } }),
        "```"
      ].join("\n")).status
    ).toBe("blockedByProposal");
    expect(
      parseDeliverySectionDraftPayload([
        "```json",
        JSON.stringify({ morphoResearchProposal: { title: "研究", summary: "摘要", findings: [] } }),
        "```",
        "```json",
        JSON.stringify({ morphoDeliverySectionDraft: { narrative: "说明", captions: [], suggestedGaps: [] } }),
        "```"
      ].join("\n")).status
    ).toBe("blockedByProposal");

    const wrongReference = parseDeliverySectionDraftPayload(
      `\`\`\`json\n${JSON.stringify({
        morphoDeliverySectionDraft: {
          narrative: "本节说明文字。",
          captions: [{ referenceId: "missing-ref", caption: "错误图注" }],
          suggestedGaps: []
        }
      })}\n\`\`\``
    );
    expect(wrongReference.status).toBe("ok");
    if (wrongReference.status !== "ok") {
      throw new Error(wrongReference.reason);
    }
    expect(validateDeliverySectionDraftPayload(wrongReference.draft, authorization).status).toBe("failed");

    const tooManyGaps = parseDeliverySectionDraftPayload(
      `\`\`\`json\n${JSON.stringify({
        morphoDeliverySectionDraft: {
          narrative: "本节说明文字。",
          captions: [],
          suggestedGaps: Array.from({ length: 9 }, (_, index) => ({ label: `gap-${index}` }))
        }
      })}\n\`\`\``
    );
    expect(tooManyGaps.status).toBe("ok");
    if (tooManyGaps.status !== "ok") {
      throw new Error(tooManyGaps.reason);
    }
    expect(validateDeliverySectionDraftPayload(tooManyGaps.draft, authorization).status).toBe("failed");
  });

  it("rejects the whole delivery draft when captions or gaps contain invalid items", () => {
    const malformedCaption = parseDeliverySectionDraftPayload(
      `\`\`\`json\n${JSON.stringify({
        morphoDeliverySectionDraft: {
          narrative: "A valid narrative.",
          captions: [{ referenceId: "ref-a" }],
          suggestedGaps: []
        }
      })}\n\`\`\``
    );
    expect(malformedCaption.status).toBe("failed");

    const overlongCaption = parseDeliverySectionDraftPayload(
      `\`\`\`json\n${JSON.stringify({
        morphoDeliverySectionDraft: {
          narrative: "A valid narrative.",
          captions: [{ referenceId: "ref-a", caption: "x".repeat(501) }],
          suggestedGaps: []
        }
      })}\n\`\`\``
    );
    expect(overlongCaption.status).toBe("failed");

    const emptyGap = parseDeliverySectionDraftPayload(
      `\`\`\`json\n${JSON.stringify({
        morphoDeliverySectionDraft: {
          narrative: "A valid narrative.",
          captions: [],
          suggestedGaps: [{ label: " " }]
        }
      })}\n\`\`\``
    );
    expect(emptyGap.status).toBe("failed");

    const duplicateCaptionReference = parseDeliverySectionDraftPayload(
      `\`\`\`json\n${JSON.stringify({
        morphoDeliverySectionDraft: {
          narrative: "A valid narrative.",
          captions: [
            { referenceId: "ref-a", caption: "Caption A" },
            { referenceId: "ref-a", caption: "Caption B" }
          ],
          suggestedGaps: []
        }
      })}\n\`\`\``
    );
    expect(duplicateCaptionReference.status).toBe("ok");
    if (duplicateCaptionReference.status !== "ok") {
      throw new Error(duplicateCaptionReference.reason);
    }
    expect(validateDeliverySectionDraftPayload(duplicateCaptionReference.draft, authorization).status).toBe("failed");
  });

  it("hides delivery and non-delivery technical blocks from visible delivery replies", () => {
    const reply = [
      "可见说明。",
      "```json",
      JSON.stringify({ morphoResearchProposal: { title: "研究", summary: "摘要", findings: [] } }),
      "```",
      "```json",
      JSON.stringify({ morphoDeliverySectionDraft: { narrative: "说明", captions: [], suggestedGaps: [] } }),
      "```"
    ].join("\n");

    const stripped = stripDeliverySectionDraftTechnicalBlocks(reply);
    expect(stripped).toBe("可见说明。");
    expect(stripped).not.toContain("morphoResearchProposal");
    expect(stripped).not.toContain("morphoDeliverySectionDraft");
    expect(sanitizeDeliverySectionDraftStreamForDisplay("可见说明。\n```json\n{\"morphoResearchProposal\":")).toBe("可见说明。");
  });
});
