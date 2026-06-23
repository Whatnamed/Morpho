# Morpho — Project Instructions

## 1. Project purpose

Morpho is an AI-assisted workspace for product and industrial-design concept development.

It is not:

* a generic SaaS dashboard;
* a node-workflow editor;
* a Figma or PowerPoint replacement;
* a CAD, engineering, manufacturing, BOM, or PLM tool;
* a model-control console.

The product must preserve a continuous project workspace in which materials, research, conclusions, design definition, concept directions, images, and delivery preparation coexist on one canvas.

## 2. Required reading order

Before changing code, read this file first.

Then read only the documents relevant to the task:

### Product rules

* `docs/product/README_本次更新说明.md`
* `docs/product/00_Morpho_v3_规则继承、覆盖与完整性账本.md`
* `docs/product/01_Morpho_产品定义与总体流程.md`
* `docs/product/02_Morpho_工作台、画布与对象规则.md`
* `docs/product/03_Morpho_AI工作流程、阶段Context与连续性机制.md`
* `docs/product/04_Morpho_状态、版本、项目记录与记忆.md`
* `docs/product/05_Morpho_项目入口、资产、搜索、导入与归档.md`

### Design rules

* `docs/design/README.md`
* `docs/design/Morpho_UI_原型设计说明_v1.md`
* `docs/design/Morpho_Light_Design_System_v1_CN_EN.md`

### Historical materials

* `docs/archive/` and `docs/design/archive/` are historical reference only.
* Do not use archived v1, v2, or trial prototype files as current product requirements.
* Do not reuse the `Nightfield`, “安静的仪器”, tactical-tool, or compact-field-tool content from the anchor HTML as official Morpho demo content.
* Official demo content is `夜航 / Nightrail`, as defined in the UI prototype specification.

## 3. Priority when documents conflict

1. Explicit current product rules in `docs/product/00–05`
2. `README_本次更新说明.md`
3. UI behavior and required states in `Morpho_UI_原型设计说明_v1.md`
4. Visual system and tokens in `Morpho_Light_Design_System_v1_CN_EN.md`
5. `references/morpho_workspace_anchor_v2.html` for visual and interaction feeling only
6. Archived documents and earlier prototypes

The anchor HTML is not production code. Do not copy its fixed layout, absolute positions, mock data, or hand-written interaction logic into the application.

## 4. Non-negotiable product behavior

* The workspace is one continuous project space: floating UI layers over a dominant canvas.
* Canvas position is visual organization only. It must never determine object semantics, status, relationships, design-definition inclusion, default reference, or delivery inclusion.
* The right side is a continuous AI conversation surface, never a full-height object inspector.
* The left navigation locates regions on the canvas. It must not switch the user into separate stage pages or separate AI chats.
* The bottom detail surface appears only when needed and shows direct information, source, version, relation, or decision context.
* Clicking an AI suggestion fills editable natural language into the input. It must not automatically send, generate, mutate project state, or switch context.
* Stages are internal context and spatial landmarks, not mandatory step-by-step gates or progress tracking.
* Compare is a local operation, not a dedicated workflow stage or persistent thread.
* Any image can be continued, locally modified, used as a reference, or developed into an angle, scenario, CMF, detail, or explanatory image.
* “后续默认参考” is optional. Replacing it must not silently replace existing images, delivery references, or unrelated work.
* Hide, delete, and eliminate are different actions and must remain different in data and UI.
* Delivery preparation organizes materials, references, captions, descriptions, and gaps. It must not become a Figma, Keynote, or PPT editor.
* Do not expose project memory files, stage records, Context internals, model routing, prompt details, task queues, or internal storage mechanics as product UI.

## 5. Engineering boundaries

* Keep canvas rendering and interaction separate from Morpho domain logic.
* Do not infer business meaning from canvas coordinates, visual grouping, or visual proximity.
* Keep domain types, persistence, AI orchestration, and UI components in separate modules.
* Do not put database access, model API calls, complex state transitions, and large visual components in one file.
* Prefer small focused modules with explicit inputs and outputs.
* Use TypeScript strictly. Do not introduce `any` to bypass incomplete modeling.
* Do not create fake production abstractions for future features that have no current use.
* Avoid unnecessary global state. Keep UI-local state close to the component that owns it.
* Do not add a dependency merely because it looks convenient.

## 6. Core data principles

* Every meaningful project object needs a stable identity independent of its visual placement.
* Assets, canvas instances, semantic objects, versions, relations, delivery references, and AI tasks must not be treated as the same thing.
* Every AI-generated image creates a new object. It must not overwrite the original image.
* Delivery references are stable instances. Editing, replacing, or deleting their upstream source must not silently mutate the delivery reference.
* Structured state changes should be deterministic when possible.
* AI may summarize or draft semantic content, but it must not silently convert candidate analysis into key conclusions, replace an applied design definition, choose a main direction, set a default reference, or make important delivery decisions.

## 7. Visual implementation rules

* Follow `Morpho_Light_Design_System_v1_CN_EN.md`.
* Preserve a warm, calm, light-mode, image-led workspace.
* The canvas should read as the primary surface. Top controls, left rail, AI conversation, and detail surfaces should float above it.
* Do not build a permanent three-column shell that narrows the canvas.
* Do not create equal-width card grids, dashboard metric panels, stage progress widgets, colorful badge stacks, workflow wires, node ports, or large dashed stage boxes.
* Different object types must retain different visual treatments.
* Use design tokens rather than scattering arbitrary colors, spacing, shadows, and radii.
* Use Chinese as the default product UI language unless a specific interface intentionally needs bilingual content.
* Motion should explain state changes, not decorate.

## 8. Dependencies and external services

* Before adding a core dependency or external service, record the decision in `docs/architecture/decisions.md` once that file exists.
* A core dependency includes a framework, canvas engine, database, authentication provider, file-storage provider, AI provider, state-management foundation, or major UI component system.
* Do not silently replace an existing core dependency.
* Before adding a non-trivial dependency, check whether the current stack can solve the problem cleanly.
* Never commit API keys, tokens, database secrets, local credentials, or copied `.env` files.
* Keep public environment-variable names in `.env.example` once integrations are introduced; never put real values there.

## 9. Testing and verification

* For domain rules, object relations, state changes, version behavior, delivery references, AI action boundaries, and API validation: add or update automated tests.
* For visual exploration, do not create low-value snapshot tests before the interaction is stable.
* After a meaningful change, run the relevant formatting, linting, type-checking, unit tests, build, and any browser-level checks available in the project.
* If a command cannot run, state exactly what blocked it and do not claim success.
* Do not treat manual visual inspection as proof that relationship or state logic is correct.

## 10. Git and change discipline

* Keep each change focused on one coherent concern.
* Do not rewrite, delete, or reformat unrelated files.
* Do not use destructive Git commands that discard user work.
* Do not commit or push unless the user explicitly requests it.
* Before finishing a task, report:

  * what changed;
  * which files changed;
  * which commands were run;
  * what passed;
  * what remains unverified.

## 11. Documentation discipline

* Do not create empty planning documents merely to make the repository look complete.
* When implementation begins, maintain:

  * `docs/architecture/architecture.md` for current implemented architecture;
  * `docs/architecture/decisions.md` for confirmed technical decisions;
  * `docs/operations/runbook.md` for real install, run, test, build, and deployment commands.
* Update these documents only when code or confirmed decisions make the content true.
* Do not duplicate the product definition in technical documents.
