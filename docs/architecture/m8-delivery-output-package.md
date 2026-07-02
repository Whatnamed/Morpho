# M8 Delivery Output Package

M8 adds a real delivery output package for taking one prepared delivery package into external layout tools. It is not a project archive, editable backup, restore path, PPT/PDF/Figma generator, cloud share, or final board layout system.

## Scope

The output package is built from one selected `delivery` object only:

- sections and their current applied narratives;
- stable delivery reference snapshots;
- editorial captions and notes;
- referenced local assets or link metadata;
- recorded gaps;
- pending section drafts, explicitly marked as unapplied.

It does not scan the whole canvas, export all workspace objects, include full chat history, include raw workspace JSON, or replace stable references with newer source-object state.

## Format

The manifest format is independent from workspace schema v13 and M7 package formats:

```text
format: morpho-delivery-output
outputVersion: 1
```

The pure contract lives in `src/domain/morpho/deliveryOutput.ts`. It creates and validates the manifest, collects asset candidates, reports ready/warning/blocked diagnostics, and builds Markdown files without using `Blob`, `File`, IndexedDB, `fflate`, or browser APIs.

## Zip Layout

Each export creates one zip named like:

```text
morpho-delivery-<safe-delivery-title>-<YYYY-MM-DD>.zip
```

The zip contains:

```text
output-manifest.json
README.md
delivery-outline.md
captions-and-copy.md
gaps-and-next-steps.md
asset-index.md
source-map.json
assets/
  <assetId>--<safe-original-file-name>
```

`source-map.json` is a structured source/reference map, not a workspace dump. It stores delivery reference IDs, section IDs, source object/asset IDs, stable snapshots, editorial notes, output asset paths, availability, and link URL/domain when relevant.

## Asset Rules

Assets are derived only from the selected delivery object's stable references, primarily `DeliveryReference.sourceAssetId` and snapshot preview/source-file asset fields. Unrelated workspace assets, hidden objects, eliminated directions, and unreferenced source files are not exported.

Availability states:

- `embedded`: local Blob exists and byte size matches metadata, so the file is written under `assets/`.
- `referenceOnly`: original link or link source; no fake local file is created.
- `missingBinary`: metadata expects a local Blob, but it is unavailable; the package can still export with warnings.
- `sizeMismatch`: a Blob is readable but byte size differs; the real Blob is still embedded and clearly marked.
- `noBinaryExpected`: text, research, key conclusion, direction, and similar references that have no local binary.

The browser client in `src/features/delivery-output/deliveryOutputClient.ts` reads only the manifest asset candidates from IndexedDB and never writes workspace state, localStorage, catalog data, or BlobStore entries.

## Warning And Blocked Boundary

Export is blocked when the selected object is missing, is not a delivery object, has no sections, has broken section/reference structure, has an invalid manifest, or zip generation fails.

Export may continue with warnings when there are no stable references but section text exists, open gaps, pending drafts, reference-only links, missing local binaries, or size mismatches. Missing assets are not silently omitted as success and are never replaced with empty files.

## Stable References And Drafts

Delivery references remain stable snapshots. If the source object changes or disappears after being added to delivery preparation, M8 exports the saved snapshot and reports source availability instead of pulling new source data.

Pending section drafts are exported only in `gaps-and-next-steps.md` and the manifest's `pendingSectionDrafts` list. They are labeled as unapplied and do not become official section narratives, captions, gaps, decisions, or project memory during export.

## UI Boundary

The top `输出` control opens a lightweight floating panel in the workspace. The panel selects an active delivery package, runs a real asset preflight, shows a concise Chinese summary, and downloads the zip. It does not become a dashboard, wizard, inspector, page switch, layout editor, restore entry, or model-control surface.
