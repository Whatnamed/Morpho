# Morpho Technical Decisions

## 2026-06-23: Use Next.js App Router

Decision: use `next`, `react`, and `react-dom` for the formal application foundation.

Reason: the current task asks for a stable Next.js + TypeScript application in the existing project root. The App Router gives a production-oriented structure without introducing a separate temporary project.

Current scope: one static app route with a client-side workspace. No server actions, route handlers, backend API, deployment, or auth are implemented.

## 2026-06-23: Use tldraw as the Canvas SDK

Decision: use `tldraw` for the real canvas layer.

Reason: Morpho needs pan, zoom, selection, and extensible canvas object rendering. A custom `morpho-object` shape bridges tldraw canvas instances to Morpho domain objects.

Boundary: canvas coordinates are stored only as visual placement in `canvas.instances`. Domain semantics remain in Morpho objects and relations.

## 2026-06-23: Use localStorage for Initial Local Persistence

Decision: persist the current workspace to browser `localStorage`.

Reason: the current scope requires refresh recovery without a real backend, Supabase, login, cloud storage, or AI key.

Boundary: this is a local persistence adapter, not the future storage model. It can be replaced by a database or sync layer without moving domain types into UI components.

## 2026-06-23: Use Vitest for Domain Boundary Tests

Decision: use `vitest` for deterministic domain tests.

Reason: Morpho product rules require automated tests for object relations, state changes, and AI action boundaries. The first tests cover canvas movement and AI suggestion draft behavior.

## 2026-06-23: Use lucide-react for Interface Icons

Decision: use `lucide-react` for compact toolbar, rail, AI, and detail icons.

Reason: the app needs recognizable icon buttons without adding a large UI component system.

## 2026-06-23: Pin ESLint to 9.x

Decision: use `eslint@^9.39.0` with `eslint-config-next@16.2.9`.

Reason: `eslint@10.5.0` installed by `latest` triggered a runtime incompatibility in the React rule stack used by `eslint-config-next`. ESLint 9 satisfies Next's peer dependency and lint runs successfully.

## 2026-06-23: Use Schema Version 2 for Core Workspace Semantics

Decision: move the local workspace data model to schema version `2`.

Reason: Morpho needs structural separation between visibility, deletion, direction state, default references, and delivery references before adding more project-entry, import, AI, or export behavior.

Implemented fields include object `visibility`, `deliveryReferences`, and scoped `decisionRecords`.

## 2026-06-23: Keep Decision Records Semantic

Decision: `DecisionRecord` is not a universal operation log.

Reason: hidden and restore actions are temporary workspace operations and should not pollute the object's decision history. Decision records are reserved for project-level decisions such as default-reference changes, direction status changes, delivery-reference changes, and reasoned deletion.

## 2026-06-23: Snapshot Delivery References

Decision: delivery modules store `DeliveryReference` IDs, and each delivery reference stores a display snapshot.

Reason: delivery content must remain stable when its source object is renamed, hidden, deleted, replaced by a new default reference, or continued into a new version.

## 2026-06-23: Preserve Raw localStorage on Migration Failure

Decision: localStorage migration is pure, and failed migration does not overwrite stored raw data.

Reason: localStorage is temporary, but it already represents real local project state. Future database or sync migration should follow the same rule: migration failure must be recoverable and must not silently reset project data to seed content.
