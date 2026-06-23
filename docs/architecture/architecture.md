# Morpho Implemented Architecture

## Current Runtime

Morpho is currently a single Next.js App Router application in this repository root.

The implemented workspace is client-side React on top of a static Next route:

- `src/app/layout.tsx` imports global styles and tldraw CSS.
- `src/app/page.tsx` renders the Morpho workspace.
- `src/features/workspace/` owns the visible workbench experience.
- `src/domain/morpho/` owns product-domain types, seed data, and deterministic domain actions.
- `src/infrastructure/persistence/` owns browser localStorage access.

No backend API, database, authentication, object storage, cloud sync, or real AI provider is implemented yet.

## Key Boundaries

Canvas rendering is separated from Morpho domain state:

- Morpho objects are stable domain records in `src/domain/morpho/types.ts`.
- Canvas placement lives in `canvas.instances`.
- tldraw custom shapes store `objectId` and `instanceId` only as a rendering bridge.
- Moving a tldraw shape updates canvas instance position; it does not change object type, status, relation, direction state, default reference, or delivery inclusion.

AI UI is currently simulated:

- The right panel is a continuous conversation surface.
- Selection suggestions fill an editable draft input.
- Suggestions do not automatically send, generate, or mutate project state.
- The local modification simulation creates new image objects only after the user presses the send/execute button in local edit mode.

Persistence is local only:

- Morpho workspace data is serialized to `localStorage` with schema version `1`.
- tldraw store persistence is not used separately; shapes are rebuilt from the persisted Morpho workspace.

## Implemented UI Surfaces

- Full-screen tldraw canvas with custom Morpho object shapes.
- Floating top controls.
- Narrow floating left rail.
- AI conversation panel over the lower-right canvas area.
- Always-available AI expand/collapse trigger.
- Bottom detail surface that appears only for selected objects.
- Project map, asset, hidden-content, and search overlays.

## Demo Project

The seed workspace uses the official demo content:

- `夜航 / Nightrail`
- Main direction: `方向 A：柔光轨道`
- Default reference image: `柔光轨道 v2`
- Alternative direction: `方向 B：家具化支撑岛`
- Eliminated direction: `方向 C：软性引导带`

Historical `Nightfield`, tactical-tool, and “安静的仪器” demo content is not used.
