# Morpho Architecture Documentation

## Current status

As of 2026-08-04, the repository contains one formal A+ Agent Runtime. The current source of
truth is the code on `main` plus the documents listed below; historical milestone documents are
not alternate implementation guides.

- `schemaVersion` is 16 and project data remains browser-local first.
- `main` and `refactor/agent-runtime-a-plus` are closed at the same release commit.
- A+ Phase A and Phase B are complete; the repository is in the healthy observation window before
  Phase C.
- The earliest scheduled read-only observation audit is `2026-08-06 10:28:24 Asia/Shanghai`.
- Phase C is not authorized or executed. The checked-in B cleanup Migration and B archive remain
  in place for the separately authorized future gate.

## How to use this folder

Read the current documents first. Use a historical document only to understand the decision or
implementation state at the time it was written, and do not copy its routes, schema numbers,
runtime names, model defaults, or deployment claims into current work without rechecking the code.

## Current authoritative documents

| Document | Use | Do not use it for |
|---|---|---|
| [`architecture.md`](./architecture.md) | Current implemented module boundaries, routes, persistence, providers, and deployment paths | Historical migration narrative or live deployment evidence beyond what it explicitly records |
| [`decisions.md`](./decisions.md) | Confirmed technical decisions and explicit supersession boundaries | Treating an old dated entry as the current implementation when a later A+ entry supersedes it |
| [`../operations/runbook.md`](../operations/runbook.md) | Real install, local checks, release gates, database safeguards, and deployment/observation procedure | Authorization to run remote writes or Phase C |
| [`../product/README_本次更新说明.md`](../product/README_本次更新说明.md) | Current product-rule document index and v3.2 status | Backend or deployment architecture |

## Current release and migration state

| Document | State | Use |
|---|---|---|
| [`agent-runtime-a-plus-migration.md`](./agent-runtime-a-plus-migration.md) | Phase A complete; Phase B complete; observation window active; Phase C deferred and unauthorized | Current A+ trust boundary, release evidence, phase ledger, and the one remaining observation gate |

This ledger records that the two additive migrations
`20260729012105_add_agent_turn_journal.sql` and
`20260729093000_add_agent_turn_external_actions.sql` were applied and verified. The irreversible
`20260729190000_remove_agent_runtime_b_proofs.sql` cleanup was not applied. The Phase C-before
observation audit is not an automatic authorization to run that cleanup.

## Historical milestones and audit evidence

The following documents preserve implementation milestones and audit evidence. They may contain
old `/api/ai/agent`, `/api/ai/chat`, MiMo, lane, checkpoint, or pre-v3.2 descriptions because those
descriptions were true at their recorded baseline:

- M4 documents: [`m4-2-main-flow-demo.md`](./m4-2-main-flow-demo.md),
  [`m4-3-context-runtime.md`](./m4-3-context-runtime.md)
- M5 documents: [`m5-project-continuity-runtime.md`](./m5-project-continuity-runtime.md),
  [`m5-b1-conversation-semantic-records.md`](./m5-b1-conversation-semantic-records.md),
  [`m5-b2-conversation-checkpoints.md`](./m5-b2-conversation-checkpoints.md),
  [`m5-c-comparison-and-decision-writeback.md`](./m5-c-comparison-and-decision-writeback.md),
  [`m5-d1-document-reading-and-location.md`](./m5-d1-document-reading-and-location.md),
  [`m5-d2-document-fragments-and-source-traceability.md`](./m5-d2-document-fragments-and-source-traceability.md)
- Later feature milestones: [`m6-delivery-preparation-and-stable-references.md`](./m6-delivery-preparation-and-stable-references.md),
  [`m7-a-archive-backup-contract.md`](./m7-a-archive-backup-contract.md),
  [`m7-b-c-project-bundles-and-restore.md`](./m7-b-c-project-bundles-and-restore.md),
  [`m8-delivery-output-package.md`](./m8-delivery-output-package.md),
  [`m9-a-local-runtime-reliability.md`](./m9-a-local-runtime-reliability.md)
- Audit and measurement evidence: [`ai-continuity-convergence-audit.md`](./ai-continuity-convergence-audit.md),
  [`performance-baseline.md`](./performance-baseline.md), and [`asset-gc-evaluation.md`](./asset-gc-evaluation.md)

Historical documents explain what was built or considered. They do not authorize runtime changes,
remote database actions, or Phase C cleanup.

## Retained superseded approaches

These materials remain for migration traceability but are not current architecture:

- Runtime B, its Lease/proof chain, and the temporary Runtime Selector;
- lane-scoped conversation checkpoints as a history boundary;
- early Operation Runtime and compatibility-route descriptions;
- pre-v3.2 Context and model-routing assumptions.

The current A+ Runtime is `WorkspaceClient.tsx → agentTurnRunner.ts → AgentTurnCoordinator →
/api/ai/agent/turns/**`. `/api/ai/chat` remains an independent bounded text route with no formal
workspace-panel caller. Compatibility fields such as `conversationCheckpoints` and `laneKey` stay
in the schema and migration code where needed for local compatibility and audit; their presence
does not restore the superseded runtime.
