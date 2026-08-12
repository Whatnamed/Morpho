# M7-A Archive and Backup Contract

## Scope

This note records the M7-A domain contract for Morpho project archive and editable backup manifests.

## What M7-A adds

- A human-readable archive manifest for reading, review, and handoff.
- An editable project backup manifest for future restoration into a new independent project copy.
- Structured asset inventory and reference diagnostics that describe current workspace assets and known references without exposing runtime storage keys.
- Structural validation for external manifests with readable failure diagnostics.
- A sanitization boundary for backup snapshots that excludes transient UI state from long-lived project facts.
- A restore gate where backup creation is blocked when restore-critical integrity problems are already known.
- Authoritative deep validation of current-schema editable snapshots, including bounded primitive/container
  structure, discriminated Morpho objects, record key/id consistency, finite canvas geometry, current
  revision ownership, and restore-critical references.

## What M7-A does not add

- No download UI, export buttons, zip/bundle generation, Blob downloads, or IndexedDB binary export.
- No restore write path, restore UI, import wizard, cloud sync, or merge flow.
- No schema upgrade is introduced by this validation work. The current Workspace schema remains v17 and
  the manifest version remains `1`.

## Manifest families

### Human-readable archive

- `format`: `morpho-human-readable-archive`
- `manifestVersion`: `1`
- Purpose: reading, review, handoff, and future package generation.
- Default chat scope: `none`
- Default project continuity scope: `none`
- Includes:
  - current design definitions, key conclusions, concept directions;
  - delivery packages, sections, gaps, stable references, and pending section drafts;
  - visual-route objects with role, variant, direction, branch, and default-reference state;
  - research objects, readable source index entries, and citation snapshots;
  - decisions, traceability records, and optional scoped conversation / continuity sections.

### Editable project backup

- `format`: `morpho-editable-project-backup`
- `manifestVersion`: `1`
- Purpose: future restore into a new editable project copy.
- Default chat scope: `none`
- Default project continuity scope: `current`
- Includes the structured workspace snapshot required for future restore, but with portable asset metadata only and normalized UI state.
- Backup chat scope is intentionally narrower than archive chat scope: editable backup supports only `none` or `full`, never `decisionSummary`.
- Chat scope is enforced in the snapshot:
  - `chat: none` -> clear `ai.messages`, compaction, summary revisions, provider frames, and Compare analyses
  - `chat: full` -> preserve the current canonical messages, compaction, summary revisions, provider frames, and Compare analyses
- Project continuity scope is enforced in the snapshot:
  - `projectContinuity: current` -> preserve current structured continuity state
  - `projectContinuity: recordEntriesNone` -> preserve the continuity container but clear `recordEntries`

## Workspace schema vs manifest version

- `workspace.schemaVersion` describes the live application data model.
- `manifestVersion` describes archive or backup format evolution.
- M7-A keeps them independent.

## Asset contract

- Portable inventory entries use stable `portableBundleKey` values such as `assets/<sourceAssetId>`.
- Portable manifests do not store runtime `storageKey` values or Blob URLs.
- Asset binary integrity is not verified in M7-A; every binary is reported honestly as not verified.
- Inventory diagnostics must surface orphaned metadata, missing metadata, and invalid inventory structure.
- Editable backup validation also rejects runtime-only leaks and asset-inventory mismatches in the backup snapshot.

## UI-state boundary

- Backup snapshots keep canvas view and canvas instances because they are part of the editable workspace layout.
- Backup snapshots normalize transient UI state:
  - `activeDrawer` becomes `null`;
  - `lastSelectionIds` becomes `[]`;
  - `aiOpen` becomes `true`;
  - `ui.canvasView` is synchronized to `canvas.view`;
  - `ui.workIntent` is normalized to `discussion` because it is a transient AI interaction state, not a long-term project fact.

## Restore contract

- Restore creates a new independent project copy.
- Restore must remap project identity.
- Restore must regenerate runtime storage keys.
- Restore must not silently merge with an existing project.
- Asset ID remapping must update referenced asset indices consistently.

## How M7-B consumes archive manifests

- M7-B should treat `morpho-human-readable-archive` as a reading and handoff source, not as a restorable workspace dump.
- It can safely consume:
  - project overview;
  - design definitions, key conclusions, directions;
  - delivery packages, stable references, and section drafts;
  - visual-route objects;
  - research objects, source index entries, and citation snapshots;
  - integrity diagnostics.
- Missing asset metadata may remain as archive warnings. M7-B should surface those warnings instead of rejecting the archive when the archive is still structurally readable.

## How M7-C consumes editable backup manifests

- M7-C should treat `morpho-editable-project-backup` as the only restore-oriented manifest family.
- It must require a fully valid manifest before starting restore.
- It must restore into a new independent project copy, regenerate runtime asset storage keys, and keep asset/reference remapping consistent across the workspace snapshot.
- If backup validation fails, M7-C must stop before any restore write begins.
- Current-schema snapshots are validated before normalization can fill or coerce malformed fields. Historical
  snapshots first use the existing Workspace migration chain and then pass the same current-schema validator.
  This is one current Workspace contract, not a second backup-only schema.
- Stable delivery snapshots may retain a deleted or hidden upstream source. Current canvas instances,
  working-state selections, document-fragment source/extract links, revision owners, proposal targets,
  delivery package/section links, and delivery-draft references must resolve according to their live semantics.

## Historical boundary note

The items below were intentionally out of scope at M7-A time:

- reading IndexedDB binary payloads for real file-completeness checks;
- creating portable asset bundles and downloadable zip packages;
- executing restore transactions into localStorage and IndexedDB.

Those behaviors are now implemented by M7-B / M7-C. See `docs/architecture/m7-b-c-project-bundles-and-restore.md` for the current bundle and restore layer.
