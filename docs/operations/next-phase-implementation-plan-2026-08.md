# Morpho Next Phase Implementation Plan

Date: 2026-08-22

## Current assessment

Morpho has completed the major architecture migration work. The repository is currently beyond foundation development and is in the hardening and product-capability refinement stage.

Current confirmed state:

- Next.js + TypeScript application foundation is established.
- tldraw continuous canvas workspace is implemented.
- local-first project storage model is implemented.
- schemaVersion 17 data model is active.
- A+ Agent Runtime is the only production runtime.
- Runtime B fallback architecture has been removed.
- AI capability layer is integrated for text, image generation, image understanding, and controlled research flows.
- Performance evidence and Phase 5 integration records have been added.

## Phase objective

Move Morpho from an architecturally stable AI workspace into a reliable daily-use design assistant.

The next phase should prioritize correctness, observability, workflow quality, and designer-facing capability rather than adding large new subsystems.

## Priority 1 — Agent Runtime reliability audit

Goals:

- Verify every Turn lifecycle transition.
- Ensure interrupted, failed, cancelled, and recovered turns have deterministic outcomes.
- Validate idempotent finalization paths.
- Remove remaining ambiguous states.

Tasks:

- Audit client coordinator state transitions.
- Audit server journal boundaries.
- Add failure matrix tests.
- Verify retry and recovery behavior.
- Verify context compaction does not lose continuity.

Acceptance criteria:

- Every turn ends in exactly one terminal state.
- Recovery behavior is test-covered.
- No hidden fallback paths remain.

## Priority 2 — AI capability layer refinement

Goals:

Improve the quality of AI-assisted design workflows.

Tasks:

- Review research operation quality.
- Review image development flows.
- Improve proposal/confirmation boundaries.
- Verify citation and source handling.
- Improve multi-reference image workflows.

Acceptance criteria:

- AI suggestions remain editable proposals.
- Important project decisions require explicit user confirmation.
- Generated assets preserve source relationships.

## Priority 3 — Project continuity and memory validation

Goals:

Ensure long projects remain coherent.

Tasks:

- Validate Context Frame generation.
- Test compaction at realistic project sizes.
- Verify memory revision behavior.
- Verify stage records and project summaries.

Acceptance criteria:

- Long conversations retain project identity.
- Compaction does not alter authoritative project state.

## Priority 4 — Product workflow polish

Goals:

Improve the designer experience without changing the core model.

Tasks:

- Improve empty project onboarding.
- Improve AI conversation integration.
- Improve canvas object discoverability.
- Improve delivery preparation experience.
- Improve visual feedback for long-running operations.

Avoid:

- Building dashboard-style UI.
- Turning stages into mandatory workflows.
- Adding unnecessary backend synchronization.

## Priority 5 — Technical cleanup

Tasks:

- Remove obsolete migration remnants where safe.
- Review duplicated documentation.
- Review unused compatibility code.
- Maintain architecture decision records.

## Recommended implementation order

1. Runtime lifecycle audit.
2. Failure and recovery test coverage.
3. Context/memory stress testing.
4. AI capability workflow improvements.
5. Designer-facing UX refinement.
6. Cleanup and documentation updates.

## Verification requirements

Before merging any phase:

- npm lint
- npm typecheck
- npm test
- npm build
- browser workflow validation

Every change should report:

- changed files;
- verification performed;
- remaining uncertainty.
