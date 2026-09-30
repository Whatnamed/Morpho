# Morpho — Project Instructions

## 1. Project purpose and sources of truth

Morpho is an AI-assisted workspace for product and industrial-design concept development. It is a continuous design-project workspace, not a generic dashboard, node-workflow editor, model console, or replacement for Figma, PowerPoint, CAD, BOM, or PLM tools.

Before changing code, read this file first, then read only the task-relevant canonical material:

- Product behavior and semantics: `docs/product/README_本次更新说明.md` and the relevant `docs/product/00–05` document.
- Visual and interaction rules: `docs/design/README.md`, then the relevant design-system or UI document.
- Current implemented architecture and decisions: `docs/architecture/README.md`.
- Real run/test/deploy procedures: `docs/operations/README.md` and `docs/operations/runbook.md`.
- Remediation work: `docs/operations/remediation-program-map.md` plus the current package Plan when one exists.
- `docs/archive/`, `docs/design/archive/`, historical milestone documents, and research/audit reports are evidence or history, not alternate current requirements.

For implementation facts, current code is authoritative. For intended product behavior, current product documents are authoritative. Treat disagreement between them as an explicit gap to resolve in the task; do not silently choose an old document or archived prototype.

## 2. Non-negotiable product boundaries

- Preserve one continuous project workspace with the canvas as the dominant surface. Canvas coordinates, grouping, or proximity must never determine business semantics, status, relationships, design-definition membership, default reference, or delivery inclusion.
- Keep one continuous AI conversation surface. Stages are internal context/spatial landmarks, not mandatory workflow gates; Compare is a local operation, not a persistent stage or thread.
- AI suggestions and generated semantic content are editable proposals. They must not silently send, mutate authoritative project state, promote candidate analysis to key conclusions, replace an applied definition, choose a main direction, set a default reference, or make important delivery decisions without the required user authority/confirmation.
- Hide, delete, and eliminate are distinct actions and must remain distinct in data and UI.
- Every generated image is a new object. Replacing a default reference or editing an upstream source must not silently rewrite existing images, historical relations, or stable DeliveryReferences.
- Delivery preparation organizes content and references; it must not become a Figma/Keynote/PPT editor.
- Do not expose project-memory files, stage-record internals, Context frames, model routing, prompt internals, queues, or storage mechanics as normal product UI.

## 3. Engineering and data boundaries

- Keep canvas rendering/interaction separate from Morpho domain logic. Do not infer domain meaning from visual placement.
- Keep domain types/state transitions, persistence, AI orchestration, server/provider access, and UI responsibilities separated. Avoid files that combine unrelated database, provider, state-transition, and large rendering concerns.
- Preserve stable identities. Assets, canvas instances, semantic objects, revisions, relations, DeliveryReferences, and AI tasks are different concepts and must not be collapsed.
- Prefer deterministic structured state changes and explicit inputs/outputs.
- Use TypeScript strictly; do not introduce `any` to bypass incomplete modeling.
- Avoid speculative abstractions, unnecessary global state, and dependencies without a demonstrated need.
- Do not silently replace a core dependency or external service. Record confirmed core technical decisions in `docs/architecture/decisions.md`.
- Never commit API keys, tokens, credentials, copied real `.env` files, or secrets. Public environment-variable names belong in `.env.example`.

## 4. Visual implementation boundaries

- Follow `docs/design/design-system/docs/DESIGN-SYSTEM.md` for visual work.
- Preserve a warm, calm, light-mode, image-led workspace in which the canvas remains primary and controls/panels float above it.
- Do not turn the product into a permanent three-column dashboard, equal-card grid, stage-progress UI, or node/workflow-wire editor.
- Use the existing design tokens instead of re-declaring arbitrary global tokens. Use Chinese as the default product UI language unless a surface intentionally requires otherwise.
- Motion should explain state changes, not decorate them.

## 5. Testing and verification

- Add or update automated tests when changing domain rules, state transitions, object/revision relations, DeliveryReferences, AI authority/action boundaries, persistence contracts, or API validation.
- For meaningful changes, run the relevant subset of formatting/linting, type checking, unit tests, build, and browser-level checks. Use the runbook when the task reaches release/deployment boundaries.
- Do not add low-value visual snapshot tests merely to create coverage.
- If a check cannot run, state the exact blocker and do not claim it passed.
- Manual visual inspection does not prove state or relationship correctness.

## 6. Git, commit, push, and worktree discipline

- Keep changes focused. Do not rewrite, delete, or reformat unrelated files, and do not use destructive Git commands that discard user work.
- A completed task must not remain only in the local worktree unless the user explicitly asks for that. Split distinct concerns into a small number of coherent commits, push the task branch to the configured remote, and report the real commit SHA(s), branch, and push status.
- By default, use the primary Morpho worktree `D:\Morpho`, develop on a dedicated task branch, and merge into `main` after the task is accepted.
- Ordinary serial tasks do not automatically need an extra worktree; task size, importance, or risk alone is not a reason to create one. Create an extra worktree only for an explicit isolation need: parallel development, multiple Agents operating concurrently, a primary worktree occupied long-term, preserving an independent working state, or running different versions side by side.
- Additional Morpho worktrees belong under `D:\Morpho-Worktrees\<task-or-branch>` unless the user explicitly chooses another visible project location. Do not create project worktrees inside harness-managed hidden directories such as `.codex`.
- Before creating or removing a worktree, inspect `git worktree list --porcelain`. Reuse a suitable clean worktree when appropriate. Before removal, verify tracked/untracked state and that no unique unmerged or unpushed commits need preservation; remove through normal Git worktree commands and then prune stale entries.
- If actual Git/worktree state differs from a Plan's assumptions, use the current repository state instead of forcing obsolete branch/worktree steps.
- Before reporting completion, summarize what changed, affected files, verification performed, anything still unverified, and the pushed commit/branch state.

## 7. Plans and documentation

- One-off Implementation Plans, long execution prompts, and similar coding-agent task material belong under the project-root `temp\prompts\`. They are transient execution material, not long-term canonical documentation.
- Do not create empty planning documents merely to make the repository appear complete, and do not promote temporary Plans into `docs/` just because they are long.
- After an implementation is accepted, durable facts should live in code, the appropriate canonical document, the remediation Program Map when applicable, and Git history.
- Keep `docs/architecture/architecture.md` aligned with implemented architecture, `docs/architecture/decisions.md` with confirmed technical decisions, and `docs/operations/runbook.md` with real operational procedures.
- Update documentation only when code or a confirmed decision makes the statement true. Do not duplicate the product definition across technical documents.
