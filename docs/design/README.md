# Morpho Design Sources

## Purpose

This folder contains the current visual and interaction references for the Morpho desktop workspace.

These documents guide implementation. They do not define database schema, AI routing, persistence, authentication, storage, or backend architecture.

## Reading order

1. `design-system/docs/DESIGN-SYSTEM.md`
   The current design system, exported from the Claude Design project and
   verified against the shipped code (tokens mirror `src/app/globals.css`
   `:root`; stage presets mirror `src/domain/morpho/stageRegions.ts`).
   `design-system/README.md` explains the package layout;
   `design-system/docs/SOURCE-MAP.md` maps every directory to repo files.

2. `Morpho_UI_原型设计说明_v1.md`
   Defines the required UI states, interaction presentation, example project, and prototype behavior.

3. `references/morpho_workspace_anchor_v2.html`
   A visual and interaction anchor for canvas composition, overlay behavior, spacing, density, panning, zooming, selection feedback, and AI panel placement.

## Conflict handling

* Product behavior and object semantics are defined by `docs/product/00–05`.
* UI interaction presentation is defined by `Morpho_UI_原型设计说明_v1.md`.
* Visual styling and spatial composition are defined by `design-system/`
  (`docs/DESIGN-SYSTEM.md` plus `tokens/*.css`). The design system mirrors the
  shipped app; where it and the code disagree, `src/app/globals.css` wins and
  the design system should be re-exported.
* The anchor HTML is visual reference only and must not override product rules or visual-system rules.

## Design-system package notes

* The token layer IS wired into the build (2026-07-27): `src/design-system/`
  holds the app-side copy of `design-system/tokens/*.css` (minus `fonts.css`),
  imported once at the top of `src/app/globals.css`, whose duplicated `:root`
  block was removed. Token values change in the design-system project first,
  then the export overwrites `docs/design/design-system/` **and**
  `src/design-system/tokens/` is updated to match — keep the two copies
  identical.
* Component templates (`design-system/components/**`) remain reference-only
  and are not part of the build.
* `design-system/tokens/fonts.css` loads Geist from Google Fonts for
  design-tool previews only — never import it into the app. The app serves
  Geist via `next/font` in `src/app/layout.tsx`.
* The project home (`.phome-*`) and the login screen are intentionally not
  componentised there yet; both were restyled from the same Claude Design
  project's handoff (see git history 6143297 / 57b0e41).

## Anchor HTML rules

`references/morpho_workspace_anchor_v2.html` must not be copied directly into production code.

Do not reuse its:

* fixed HTML structure;
* absolute object positions;
* inline SVG product content;
* mock object data;
* temporary interaction logic;
* `Nightfield`, “安静的仪器”, or compact tactical-tool example content.

Use it only to understand:

* full-canvas composition;
* floating interface layers;
* panel density;
* canvas navigation feel;
* local relationship visibility;
* selected-object feedback;
* AI overlay behavior;
* bottom detail-surface behavior.

## Demo content

The deployable built-in case study is generated from the current editable Morpho backup. Its project content is intentionally real and may remain in progress.

`Morpho_UI_原型设计说明_v1.md` still contains `夜航 / Nightrail` as a v1 prototype illustration. Treat that material as visual-reference history, not as deployable runtime seed data.

## Archive

`archive/` contains earlier visual experiments and superseded documents,
including `Morpho_Light_Design_System_v1_CN_EN.md` (the v1 design system,
replaced by `design-system/` on 2026-07-27 — still the best statement of the
original *why*, superseded on specifics). Archived files must not be used as
current visual requirements unless the user explicitly asks to revisit them.
