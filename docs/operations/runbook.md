# Morpho Runbook

## Install

Use the repository `.npmrc` registry setting.

```bash
npm.cmd install
```

## Development Server

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Expected local URL:

```text
http://127.0.0.1:3000
```

In the current Codex shell, long-lived background startup could not be kept alive because PowerShell `Start-Process` fails on duplicated `Path` / `PATH` environment keys and shell-spawned background jobs are cleaned up when the tool command exits. A temporary dev server was started in-process and verified with HTTP `200`.

## Checks

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Current expected results:

- `lint`: ESLint completes with no reported problems.
- `typecheck`: `tsc --noEmit` completes.
- `test`: Vitest runs `src/domain/morpho/workspace.test.ts`.
- `build`: `next build` completes and prerenders `/`.

## Current Persistence

The browser stores the workspace under:

```text
morpho.workspace.nightrail.v1
```

Clearing localStorage resets the app to the seeded `夜航 / Nightrail` workspace.

## Not Implemented

The current code does not include:

- backend APIs;
- Supabase or any other database;
- authentication;
- cloud file storage;
- real AI/model calls;
- multiplayer sync;
- export package generation;
- deployment automation.
