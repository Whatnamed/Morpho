# M7-B And M7-C Project Bundles And Restore

## Scope

M7-B implements real downloadable Morpho project bundles.

M7-C implements strict editable-backup restore into a new independent local project copy.

This document records the implemented bundle and restore layer on top of the M7-A manifest contract.

## Bundle families

Two portable package kinds now exist:

- `humanArchive`
  - envelope `format`: `morpho-project-bundle`
  - manifest file: `archive-manifest.json`
  - purpose: reading, handoff, review, and later reference import
  - includes Markdown reading files and every locally readable asset binary that can still be collected
  - may export with warnings when local binaries are missing or byte lengths no longer match metadata

- `editableBackup`
  - envelope `format`: `morpho-project-bundle`
  - manifest file: `backup-manifest.json`
  - purpose: later restore into a new editable project copy
  - includes the backup manifest plus every required bundled binary
  - export is blocked when required binary payloads are missing or byte lengths do not match manifest metadata

Both bundle families use:

- `bundleVersion: "1"`
- logical asset bundle paths `assets/<sourceAssetId>`
- a top-level `bundle.json` envelope with file descriptors and diagnostics

## Implemented modules

- `src/domain/morpho/projectArchive.ts`
  - remains the M7-A manifest and manifest-validation layer

- `src/domain/morpho/projectBundles.ts`
  - defines bundle envelope shape
  - turns manifests plus collected asset payloads into bundle file layouts
  - validates archive and backup bundle structure against declared files and manifest asset inventory
  - plans editable-backup restore by remapping project identity and runtime storage keys

- `src/features/archive/projectBundleClient.ts`
  - reads IndexedDB blobs through the asset store
  - classifies bundle asset availability as `embedded`, `referenceOnly`, `missingRequiredBinary`, or `sizeMismatch`
  - zips downloadable files with `fflate`
  - unzips uploaded backups, validates them, and executes the local restore transaction

- `src/features/workspace/components/ProjectBundlePanel.tsx`
  - lightweight floating workspace panel for export and restore actions

## Human-readable archive output

Archive bundles currently contain:

- `bundle.json`
- `archive-manifest.json`
- `README.md`
- `project-overview.md`
- `research-and-sources.md`
- `directions-and-visuals.md`
- `decisions-and-process.md`
- `delivery-preparation.md`
- `asset-index.md`
- `conversation.md` only when archive chat scope is `full`
- `assets/<sourceAssetId>` only for binaries that were actually embedded

Archive validation accepts missing required asset binaries as warnings because the package is for reading, not restore.

## Editable backup output

Backup bundles currently contain:

- `bundle.json`
- `backup-manifest.json`
- `assets/<sourceAssetId>` for every required local binary

Backup validation rejects:

- wrong package kind or manifest format
- missing `bundle.json`
- missing backup manifest file
- missing required asset entries
- missing required bundled binaries
- bundled byte lengths that do not match manifest inventory metadata
- manifest-level scope or snapshot mismatches already enforced by M7-A

## Restore flow

Restore is intentionally new-copy-only.

Implemented sequence:

1. unzip uploaded package in memory
2. parse `bundle.json`
3. parse the declared backup manifest file
4. validate bundle envelope and backup manifest
5. validate required asset presence and byte lengths
6. generate a new local project id
7. generate a new restored project title such as `原标题（恢复副本）`
8. generate new runtime storage keys for every restored asset
9. write every new binary blob first
10. write the restored workspace JSON
11. write the updated project catalog
12. open the restored project

The restore path never overwrites the source project, never merges into the current workspace, and never reuses the original runtime storage keys.

## Failure handling

Browser localStorage and IndexedDB are not transactional together, so restore uses a visible near-atomic sequence:

- all validation happens before any write
- all blobs write to fresh storage keys
- written keys are tracked during restore
- any blob-write failure aborts restore and deletes newly written blobs
- if workspace or catalog persistence fails, the new workspace key is removed and newly written blobs are deleted

This does not implement global blob garbage collection for normal object deletion. It only adds the cleanup needed for restore rollback.
