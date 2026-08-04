# M4.2 Main Flow Demo

Date: 2026-06-26

This document records the implemented M4.2 vertical slice. It is an engineering status note, not a replacement for the product definition.

Historical note: text AI has since moved from MiMo to the AiJWS / OpenAI-compatible A+ resources under
`/api/ai/agent/turns/**`, and the deployable built-in project is now `project-morpho-case-study`. The
`project-nightrail` path below is the M4.2-era demo project and is not a current route. See
`architecture.md` and `../operations/runbook.md` for current behavior.

## Implemented Flow

1. Real local material enters the workspace through paste, drag/drop, or the import button.
2. Parseable files produce bounded local `documentExtract` assets in IndexedDB.
3. Selected parsed files and selected images can enter MiMo research context.
4. Research operations record the proposal for audit and auto-create a research card.
5. Key conclusions, design definitions, and concept directions remain proposal/application flows with explicit state boundaries.
6. Direction-preview and visual-development requests auto-route from natural language when the user has not manually overridden the task mode.
7. Visual generation asks MiMo for a structured plan, validates it locally, then calls GrsAI per plan item.
8. Each generated image becomes a new object with generation metadata, source relations, direction ownership, and optional visual-branch routing.
9. Selecting an object can show a read-only design-chain trace in the bottom detail surface and a temporary canvas overlay.

## Document Context

Supported local extraction:

- Markdown and plain text;
- text-layer PDF through `pdfjs-dist`;
- PPTX slide text through `fflate`.

Boundaries:

- scanned PDFs, OCR, legacy `.ppt`, DOC/DOCX, embedded images, table fidelity, and layout reconstruction are not implemented;
- extracted text is stored as a separate IndexedDB asset, not in workspace JSON;
- local extracts are labeled as local object sources and are not network citations.

## Operation Boundaries

Provider-backed tasks still pass through one active Operation gate.

Research:

- may use selected document extracts, selected image visual input, workspace context, and optional MiMo web search;
- auto-creates a research card after a valid structured result;
- does not auto-apply key conclusions, design definitions, directions, default references, direction state, or delivery choices.

Visual generation:

- validates MiMo visual-plan object IDs and direction/branch scope before GrsAI calls;
- records the plan, result object IDs, and per-item failures;
- creates new images only and never overwrites source images or existing delivery references.

Design trace:

- is recomputed from current domain data at view time;
- does not persist new state;
- uses canvas positions only to draw overlay lines between already-known semantic records.

## Demo Verification Targets

The minimum local verification for this slice is:

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Recommended browser smoke path:

1. Open `/projects/project-nightrail`.
2. Select an existing image or direction object.
3. Open the bottom detail surface and click `查看设计链路`.
4. Confirm the trace summary lists upstream research, conclusions, definition, direction, and related images when present.
5. Confirm the canvas trace overlay is temporary and disappears when the trace is closed.
