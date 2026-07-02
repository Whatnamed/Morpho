# M7-A Archive and Backup Contract

## Scope

This note records the M7-A domain contract for Morpho project archive and editable backup manifests.

## What M7-A adds

- A human-readable archive manifest for reading, review, and handoff.
- An editable project backup manifest for future restoration into a new independent project copy.
- Structured asset inventory and reference diagnostics that describe current workspace assets and known references without exposing runtime storage keys.
- Structural validation for external manifests with readable failure diagnostics.
- A sanitization boundary for backup snapshots that excludes transient UI state from long-lived project facts.

## What M7-A does not add

- No download UI, export buttons, zip/bundle generation, Blob downloads, or IndexedDB binary export.
- No restore write path, restore UI, import wizard, cloud sync, or merge flow.
- No schema upgrade. Workspace schema remains v13.

## Manifest families

### Human-readable archive

- `format`: `morpho-human-readable-archive`
- `manifestVersion`: `1`
- Purpose: reading, review, handoff, and future package generation.
- Default chat scope: `none`
- Default project continuity scope: `none`

### Editable project backup

- `format`: `morpho-editable-project-backup`
- `manifestVersion`: `1`
- Purpose: future restore into a new editable project copy.
- Default chat scope: `none`
- Default project continuity scope: `current`

## Workspace schema vs manifest version

- `workspace.schemaVersion` describes the live application data model.
- `manifestVersion` describes archive or backup format evolution.
- M7-A keeps them independent.

## Asset contract

- Portable inventory entries use stable `portableBundleKey` values such as `assets/<sourceAssetId>`.
- Portable manifests do not store runtime `storageKey` values or Blob URLs.
- Asset binary integrity is not verified in M7-A; every binary is reported honestly as not verified.
- Inventory diagnostics must surface orphaned metadata, missing metadata, and invalid inventory structure.

## Restore contract

- Restore creates a new independent project copy.
- Restore must remap project identity.
- Restore must regenerate runtime storage keys.
- Restore must not silently merge with an existing project.
- Asset ID remapping must update referenced asset indices consistently.

