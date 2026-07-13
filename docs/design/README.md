# Morpho Design Sources

## Purpose

This folder contains the current visual and interaction references for the Morpho desktop workspace.

These documents guide implementation. They do not define database schema, AI routing, persistence, authentication, storage, or backend architecture.

## Reading order

1. `Morpho_UI_原型设计说明_v1.md`
   Defines the required UI states, interaction presentation, example project, and prototype behavior.

2. `Morpho_Light_Design_System_v1_CN_EN.md`
   Defines visual language, spatial composition, design tokens, object treatment, selection feedback, floating surfaces, and motion.

3. `references/morpho_workspace_anchor_v2.html`
   A visual and interaction anchor for canvas composition, overlay behavior, spacing, density, panning, zooming, selection feedback, and AI panel placement.

## Conflict handling

* Product behavior and object semantics are defined by `docs/product/00–05`.
* UI interaction presentation is defined by `Morpho_UI_原型设计说明_v1.md`.
* Visual styling and spatial composition are defined by `Morpho_Light_Design_System_v1_CN_EN.md`.
* The anchor HTML is visual reference only and must not override product rules or visual-system rules.

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

`archive/` contains earlier visual experiments. Archived files must not be used as current visual requirements unless the user explicitly asks to revisit them.
