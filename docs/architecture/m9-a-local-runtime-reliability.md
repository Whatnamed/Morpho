# M9-A Local Runtime Reliability

M9-A keeps Morpho local-first and does not add Supabase, account login, cloud sync, collaboration, AI access protection, Blob garbage collection, or a full WorkspaceClient rewrite.

## Workspace Persistence

Workspace persistence is coordinated by `src/features/workspace/workspacePersistence.ts`.

- Normal workspace updates are debounced for 400 ms.
- Continuous updates are forced to save at least once every 1200 ms.
- The controller always writes the latest scheduled workspace, not the first stale snapshot.
- `flush()` performs the localStorage write synchronously through the existing local project store.

The React hook flushes pending changes on:

- `window.pagehide`;
- `document.visibilitychange` when the page becomes hidden;
- `window.beforeunload`;
- project switch cleanup;
- workspace hook unmount.

The hook does not persist the initial blank workspace before a project has loaded. If loading or migration fails, automatic persistence is disabled so the fallback blank workspace cannot overwrite existing project data.

## Workspace And Catalog Results

`persistProjectWorkspaceAndSummary(...)` writes the workspace first and the project catalog second.

- If workspace write fails, catalog write is skipped and the result stage is `workspace`.
- If catalog write fails, the already-written workspace is kept and the result stage is `catalog`.
- Only when both writes succeed is the persistence state marked saved.

This mirrors localStorage reality: there is no multi-key transaction, so the app reports the true boundary instead of pretending the full project is saved.

## User-Visible Failure

Normal saved or saving states do not add a permanent dashboard. A failed local save shows a small inline warning near the project title: `本地保存失败`.

The warning uses the raw failure reason only as a tooltip for diagnostics. Editing, canvas work, chat, archive, and delivery output are not blocked. The warning clears after a later successful write.

## Asset Object URL Cache

Image previews are coordinated by `src/features/workspace/workspaceAssetUrlCache.ts` and `useWorkspaceAssetUrls`.

- Only `originalImage` and `aiGeneratedImage` assets are read for preview URLs.
- Cache identity is `assetId + storageKey`.
- Unchanged image assets keep their existing object URL.
- Added image assets load only their own Blob from IndexedDB.
- Removed assets, assets that stop being image preview sources, changed storage keys, stale async reads, and hook unmount all revoke their object URLs.
- Failed IndexedDB reads are isolated so other image URLs remain visible.

This round does not delete any IndexedDB Blob and does not implement global Blob garbage collection. Deletion policy is a separate product and data-retention decision.

## CI

`.github/workflows/quality.yml` runs on pushes to `main` and on pull requests.

The workflow runs:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

It does not require `.env`, Vercel tokens, paid model smoke tests, publishing, deployment, or version changes.
