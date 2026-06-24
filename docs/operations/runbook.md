# Morpho Runbook

## Install

Use the repository `.npmrc` registry setting.

```bash
npm.cmd install
```

## Environment

Copy `.env.example` to `.env.local` for local AI provider calls. Do not commit `.env.local`.

Text chat through MiMo:

```text
MORPHO_AI_PROVIDER=mimo
MORPHO_MIMO_API_KEY=
MORPHO_MIMO_MODEL=
MORPHO_MIMO_BASE_URL=
```

Image generation through GrsAI:

```text
MORPHO_GRS_API_KEY=
MORPHO_GRS_BASE_URL=
MORPHO_GRS_IMAGE_MODEL=
```

The browser image-task UI sends a selected model ID, aspect ratio, and optional size option to `/api/ai/image`. The route still requires the server-only GrsAI key, base URL, and environment model variable to be configured, but the provider request body is normalized on the server.

Current implemented behavior:

- default image model in the UI: `nano-banana-fast`;
- selectable image models come from `src/domain/morpho/grsImageModels.ts`;
- `nano-banana-*` profiles send `replyType: "json"` and send `imageSize` only when the selected model supports a size option;
- `gpt-image-2` sends pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`;
- generated image assets store intrinsic width, height, and aspect ratio when the browser can read them.

Without these variables, the app still runs locally, but provider routes return clear configuration errors instead of fake AI results.

## Development Server

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Expected local URLs:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/projects/project-nightrail
```

## Checks

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected results:

- `lint`: ESLint completes with no reported problems.
- `typecheck`: `tsc --noEmit` completes.
- `test`: Vitest runs domain, persistence, import, query, MiMo, and GrsAI tests.
- `build`: `next build` completes and prerenders static pages/routes where applicable.

## Current Local Persistence

Project catalog:

```text
morpho.projects.catalog.v1
```

Per-project workspace:

```text
morpho.project.${projectId}.workspace.v1
```

Legacy single-project key read for migration:

```text
morpho.workspace.nightrail.v1
```

Structured workspace data is schema version `3`. v1/v2 workspace data is migrated through pure migration functions. Migration success writes the new project workspace and catalog. Migration failure preserves old raw data and shows a recoverable warning instead of silently resetting to seed data.

Binary assets are stored in IndexedDB:

```text
database: morpho-assets-v1
store: asset-blobs
```

Workspace JSON stores only asset metadata and `assetId` references, not base64 file contents.

## Current Routes

```text
/                         project homepage
/projects/[projectId]     project workspace
/api/ai/chat              MiMo text chat proxy
/api/ai/image             GrsAI image generation proxy
```

## Not Implemented

The current code does not include:

- Supabase or any other database;
- authentication;
- cloud file storage;
- multiplayer sync;
- PDF/PPT/Word parsing;
- automatic web crawling;
- dynamic provider model-list fetching;
- export package generation;
- deployment automation.
