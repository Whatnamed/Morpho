repo: Whatnamed/Morpho
branch: main
path: src

## Last sync

date: 2026-07-26T00:00:00Z
source: read from the locally mounted working copy (`Morpho/`), not fetched through the GitHub API — no commit sha is known, so none is recorded.

### Updated in this project

- Realigned the whole design system to the shipped workspace: tokens now mirror `globals.css` `:root` exactly, including the glass recipe, `--shadow-float` and the six stage-region presets.
- Replaced the hand-rolled icon set with Lucide (the library the app imports) and documented the exact glyphs each surface uses.
- Rebuilt canvas objects as the ten distinct material families the app draws — square-cornered images with floating captions, spined files, vertical-marker conclusions, folded-corner drafts.
- Rebuilt the AI surface on the shipped composition: frosted panel with no title bar, agent-process disclosure, citations, proposal card, status pill.

## Screen map

| Project file | Repo files |
|---|---|
| `tokens/*.css` | `src/app/globals.css` `:root`, `src/domain/morpho/stageRegions.ts` |
| `components/canvas/*` | `src/features/workspace/tldraw/MorphoShapeUtil.tsx`, `StageRegionShapeUtil.tsx`, `PendingImageShapeUtil.tsx`, `globals.css` `.morpho-object-*` |
| `components/chrome/FloatingCluster.jsx` | `src/features/workspace/components/TopControls.tsx` |
| `components/chrome/LeftRail.jsx` | `src/features/workspace/components/LeftRail.tsx` |
| `components/chrome/SideDrawer.jsx` | `src/features/workspace/components/OverlayDrawers.tsx` |
| `components/chrome/DetailPopover.jsx` | `src/features/workspace/components/BottomDetailBar.tsx` |
| `components/chrome/SelectionToolbar.jsx` | `src/features/workspace/components/SelectionToolbar.tsx`, `StageRegionToolbar.tsx`, `CanvasIconButton.tsx` |
| `components/chrome/WorkspaceStarter.jsx` | `src/features/workspace/components/WorkspaceStarter.tsx` |
| `components/ai/AiPanel.jsx`, `Message.jsx`, `AiComposer.jsx`, `InlineCard.jsx` | `src/features/workspace/components/AiConversationPanel.tsx`, `ProposalDraftCard.tsx` |
| `components/ai/AgentProcess.jsx` | `src/features/workspace/components/AgentProcessDisclosure.tsx` |
| `components/controls/Icon.jsx` | every `lucide-react` import under `src/features` |
| `ui_kits/morpho-workspace/` | `src/features/workspace/WorkspaceClient.tsx` and the components above |

## Sync history

- 2026-07-26 — first association recorded; divergence between the v1 design docs and the shipped app catalogued.

## Not mirrored

`src/features/projects/ProjectHomeClient.tsx` and the `.phome-*` styles (project
home) are still being reworked upstream, so the design system does not model
them yet. Auth, delivery panels and the document reader exist in the app but are
documented rather than componentised — say so before designing against them.
