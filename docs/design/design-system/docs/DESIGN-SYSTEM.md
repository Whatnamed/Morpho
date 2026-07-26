# Morpho Design System

Morpho is a **desktop, light-mode, AI-assisted design workspace** for the concept
phase of product and industrial design. A project lives on one continuous
tldraw canvas: the designer drops in material, forms a design definition,
develops concept imagery, keeps modifying it, and assembles boards and decks.

> **This system mirrors the shipped app, not the v1 design documents.** Where the
> two disagree, the code wins — see "Where the code moved past the docs" below.

### What Morpho is not

Not a dashboard, not a card-heavy SaaS back office, not a node/workflow editor,
not a Figma clone, not a dark sci-fi AI tool, and not an editorial marketing
site pasted into a workspace.

### Surfaces

One product: the Morpho desktop workspace. Five permanent parts — two floating
top clusters, a vertically-centred left rail, the canvas, the AI conversation
panel at lower right, and an on-demand detail popover at the bottom — plus
drawers, a search layer, a selection toolbar and a delivery panel over the top.
The project home exists but is still being reworked upstream and is **not**
modelled here.

---

## Sources

| Source | Role |
|---|---|
| `Whatnamed/Morpho` — `src/app/globals.css` (9,647 lines) | **Visual source of truth.** All tokens, object materials, chrome and panel geometry are read from here. |
| `src/features/workspace/**` | Component structure, copy, icon usage, interaction rules. |
| `src/domain/morpho/stageRegions.ts` | The six stage-region colour presets. |
| `design/Morpho_Light_Design_System_v1_CN_EN.md` | The original visual language. Still the best statement of *why*; superseded on specifics. |
| `design/Morpho_UI_原型设计说明_v1.md` | Product/interaction intent and the 夜航 / Nightrail sample project. |
| `design/references/morpho_workspace_anchor_v2.html`, `design/explorations/m3-…` | Earlier prototypes; historical only. |

See `github.md` for the repo association and the file-by-file screen map.

### Where the code moved past the docs

- Images are **square-cornered** with the caption floating *outside* the frame — not rounded cards with an info footer.
- The bottom bar became a **tabbed detail popover**; `.detail-bar` is dead CSS.
- The AI panel has **no title bar and no task-mode switcher**; intent comes from the selection and the message.
- Operation progress became the **agent-process disclosure**, not a step-list card.
- **Drafts are canvas objects** (`proposalDraft`), which the v1 doc forbade.
- The rail is **vertically centred**; stage regions are real, colour-tinted shapes with their own toolbar.
- Headline **letter-spacing is 0** everywhere; the wordmark is weight 650.
- Icons are **Lucide**, not a bespoke set.

---

## CONTENT FUNDAMENTALS

Morpho's product language is **Simplified Chinese**, written plainly. English
appears only in the wordmark and a handful of technical labels.

**Voice.** Quiet, factual, second-person-implicit. The product says what
happened and offers one next step. Labels are verb-first and short: `导入`,
`归档`, `输出`, `继续发展图像`, `局部修改`, `设为后续默认参考`, `恢复并定位`,
`调研已选资料`, `保存`.

**The AI is a calm design partner, not a system:**

> 差别主要在转角：v2 把导向、扶持和照明合成一条构件，另外两张仍是分离的。

**Confirmations explain consequences, never parameters:**

> 用「柔光轨道 v3」替换当前后续默认参考。之后相关生成会默认延续它的比例、轨道结构、
> 材质和柔光基线；已有图和交付内容不会被替换。

**Failures always say what was kept:**

> 这次修改没有完成。原图与修改要求已保留。 `[重试] [修改后重试] [取消并保留原图]`

**Honesty rules.** Claim only what happened — `已提取文字`, not 已完整解析;
`已抓取摘要`, not 已全文抓取. Costs are deferred, not invented:
`费用以服务商控制台为准`. Never surface provider names, model IDs, prompts,
token counts or queue internals.

**Casing and punctuation.** No ALL-CAPS, in either script. Middle dot `·`
separates metadata (`来自方向 A · 视觉迭代 2`); slash joins bilingual names
(`夜航 / Nightrail`); 「」 wraps quoted source snippets. **No emoji anywhere.**
No exclamation marks.

**Closed vocabularies.** Object types: 图片 · 文件 · 文本 · 链接 · 图片合集 ·
研究与分析 · 文档片段 · 关键结论 · 待确认草案 · 设计定义 · 概念方向 · 交付准备.
Image roles: 参考图 · 预览 · 概念图 · 主视觉 · 场景视觉 · CMF 研究 · 细节研究 ·
结构示意 · 交互示意 · 交付素材. Direction states: 待预览方向 · 主方向 · 备选方向 ·
已淘汰方向 · 待复核方向. Detail tabs: 信息 · 来源 · 版本 · 关联 · 决策.

**Suggestions fill the composer; they never send.** Delivery modules state real
gaps and counts (`章节：4 · 引用：6 · 开放待补：1`) — never a percentage, never 已完成.

---

## VISUAL FOUNDATIONS

**Character.** Quiet authority, editorial precision, spacious composition, soft
industrial, image-first, calm interaction. A designer's desk and project wall.

**Colour.** Warm fog-white surfaces (`--canvas #f7f5f1`, `--surface #fcfbf8`;
pure white only for menus and popovers), deep graphite text
(`--text-primary #211f1b`). Two accents: **warm umber `#8e4c24`** for brand
actions, the definition bar and the rail's active entry; **muted blue-gray
`#6d7f88`** for selection, focus, relations, and every active row in drawers and
tab strips. Semantic colours (`--success #4e6b52`, `--warning #8a6834`,
`--danger #a6453a`) appear only as coloured text on a soft fill.

**Type.** Geist → Inter → system UI. Weights live between 430 and 700, mostly
5xx–6xx. **Headline letter-spacing is 0** — only micro labels track out
(0.05–0.1em). Chrome runs small: 13px chat body at 1.72 line-height, 12px card
body, 11px metadata, 10px role labels, 9px source lines.

**Spacing.** The app writes spacing inline; the rhythm is 4 / 6 / 8 / 10 / 12 /
14 / 16 / 18 / 24 / 28. Fixed geometry: rail 46px centred 25px from the edge;
drawers 340px at left 84, bottom 82; AI panel `min(426px, 100vw−56)` ×
`min(640px, 100vh−128)` at right 28, bottom 82; clusters at top 22, inset 24.

**Backgrounds.** The canvas is a solid `--canvas` fill, tldraw **world-space
dots** at `rgba(77,66,54,.26)`, and two washes: a radial bloom at 34%/22% and a
vertical white→canvas gradient. No lines, no graph paper, no photographic
backgrounds, no patterns. Imagery is the user's own project material.

**Object material identity.** Ten canvas families, each with a different
*composition*, not merely a different border colour:

| Family | Treatment |
|---|---|
| 图片 | square-cornered visual, `0 14px 34px` float shadow, caption floating below the frame |
| 文件 | 4px blue-gray spine, outlined page mark, three ghost text lines, radius `4 10 10 4` |
| 文档片段 | inset 2px quote rule, radius 3, no border |
| 研究与分析 | warm paper, brown 分析 marker, small double-rule mark bottom-right |
| 关键结论 | 40px vertical marker column (`writing-mode: vertical-rl`) beside the statement |
| 设计定义 | 5px umber bar, radius `0 8 8 0`, no border, 17px title |
| 概念方向 | circled arrow head, title with a bottom hairline, keyword line |
| 待确认草案 | umber edge, folded corner, 待确认 pill |
| 交付准备 | sage edge, wireframe of the assembled page |
| 文本 | tinted panel, 2×28px tick rule, no border or shadow |

**Radii.** 4 chips · 8 buttons · 9 icon buttons · 10 canvas objects · 12
drawers · 13 clusters · 16 rail, stage regions and composer · 22 AI panel · pill
for status marks and round controls.

**Shadows.** `--shadow-object 0 5px 16px/.035` · `--shadow-float 0 10px 28px/.07`
· `--shadow-panel 0 6px 24px/.05` · `--shadow-popover 0 12px 36px/.08` ·
`--shadow-ai-panel 0 18px 54px/.11`. Images get an inset white top highlight plus
`0 14px 34px/.1`. No inner shadows elsewhere; selection never lifts.

**Transparency and blur.** One glass recipe for persistent chrome —
`rgba(252,251,248,.8)` + `blur(18px) saturate(1.05)` + an `rgba(78,68,58,.11)`
hairline — shared by clusters, rail, selection toolbar and AI panel. Temporary
surfaces (drawers, dialogs, search) use the denser plate gradient
`#fffefb .98 → #f8f5ef .96` at `blur(20px)`. Warm frost, never glassmorphism.

**Selection.** Ring + halo + soft shadow
(`0 0 0 2px outline, 0 0 0 7px halo, 0 8px 28px`), no lift. Design-trace members
get the umber equivalent. Eliminated directions stay on the canvas at 0.68
opacity. Relationship curves are thin blue-gray strokes, one layer deep — no
arrows, no ports, no animated dashes, no global graph.

**Hover and press.** Hover adds a soft `--surface-muted` fill and lifts text from
secondary to primary; brand buttons darken to `#78401f`; cards lift 1–2px; press
is `scale(.97)` over 120ms. Focus is a 2px `--selection-halo` outline at offset 2.

**Motion.** `--duration-fast 140ms` for colour, `--duration-ui 200ms` with
`cubic-bezier(.2,.7,.2,1)` for surfaces. Popovers fade in with a 6px rise and
`scale(.985)`. The agent-process panel opens by animating
`grid-template-rows: 0fr → 1fr`. Only two loops exist: a 1.7s text shimmer while
streaming and a 2.6s shimmer on a pending image. Everything stops under
`prefers-reduced-motion`.

**Imagery.** Warm-neutral, restrained: warm off-white walls, low-saturation
olive-grey and deep sandstone, soft amber light. Never cyber-purple, hospital
blue, grain-heavy photography or stock people.

**Explicitly prohibited.** Full-width nav bars · a permanent three-column shell ·
an AI panel that resizes the canvas · full-height inspectors · node ports and
workflow graphs · dashed stage boxes · equal-width card grids on the canvas ·
multiple saturated accents in one view · glassmorphism, glow or neon · progress
bars, stage percentages, task boards · exposing project memory, model routing or
prompt detail.

---

## ICONOGRAPHY

Morpho uses **Lucide** (`lucide-react`, imported across the workspace) at 13–16px
with the library's default stroke weight. There is no bespoke icon set, no icon
font, and no SVG sprite.

Sizes: 16 in the rail and icon buttons · 15 in toolbar and inline actions · 14 in
plain and brand buttons · 13 in agent-activity rows and the project caret · 11 in
a locked stage title.

The `Icon` component wraps the Lucide UMD build and `MORPHO_ICONS` lists the exact
glyphs each surface imports: rail (`plus map boxes eye-off notebook-text search`),
top controls (`search square-dashed-mouse-pointer import package-open archive
download chevron-down home`), AI panel (`chevron-left chevron-down send square`),
agent process (`chevron-down search file-text image wrench`), selection toolbar
(30 glyphs incl. `sparkles pen-line git-compare git-branch badge-check scan-search
pin lock-keyhole trash-2 more-horizontal`), stage toolbar (`droplets paint-bucket
scan rotate-ccw lock-keyhole lock-keyhole-open eye-off`), delivery, document
reader, starter and auth.

**Emoji are never used.** Unicode carries a few marks instead: `·` between
metadata, `↗` as a locate affordance, `→` in the direction head, `×` on
dismissable notes. Small dots (5–6px) carry state; single characters
(图 / 文 / 链 / 结论 / 摘 / 定义 / 分析) act as material marks.

**No logo exists in the sources.** The mark is set type — "Morpho" at weight 650,
tracking 0 — and the AI entry is a round badge with the letter **M**. Do not draw
or reconstruct a logotype.

---

## Components

Every family below exists in the shipped app. Each has a sibling `.d.ts` and
`.prompt.md`; each directory has a `@dsCard` thumbnail.

**`components/canvas/`** — `CanvasSurface` · `StageRegion` · `MorphoObject` ·
`RoleLabel` · `ImageObject` · `ProductVisual` · `PendingImageObject` ·
`FileObject` · `DocumentFragmentObject` · `LinkObject` ·
`ImageCollectionObject` · `ResearchObject` · `KeyConclusionObject` ·
`DefinitionObject` · `DirectionObject` · `ProposalDraftObject` ·
`DeliveryObject` · `TextObject`

**`components/chrome/`** — `FloatingCluster` · `ToolbarGroup` · `Wordmark` ·
`ProjectName` · `ClusterDivider` · `LeftRail` · `RailButton` · `RailSeparator` ·
`SideDrawer` · `DrawerNote` · `DrawerGroupTitle` · `MapItem` · `AssetRow` ·
`DetailPopover` · `DetailRow` · `DetailInlineAction` · `DetailMeta` ·
`SelectionToolbar` · `ToolbarGroupInline` · `ToolbarDivider` ·
`CanvasIconButton` · `StageColorSwatch` · `ToolbarPopover` ·
`WorkspaceStarter` · `SaveToast`

**`components/controls/`** — `Button` · `Chip` · `ModeToggle` · `Tooltip` ·
`Icon` (with `MORPHO_ICONS`)

**`components/ai/`** — `AiPanel` · `AiToggle` · `AiQueue` · `Message` ·
`MessageParagraph` · `ThinkingRow` · `CitationList` · `AgentProcess` ·
`AgentActivity` · `AgentNote` · `AiComposer` · `ImageSettings` · `InlineCard` ·
`ProposalCard`

### Intentional additions

- **`ProductVisual`** — the app's own inline concept renders, lifted out of
  `MorphoShapeUtil.renderVisual` so mocks show the same artwork.
- **`Icon`** — a thin wrapper so consumers reach Lucide the same way the app does.

### Documented but not componentised

Delivery preparation / output panels, the document reader, the research picker,
the proposal detail dialog, the project bundle panel, login, and the project
home. They exist in `globals.css` and `src/features`; ask before designing
against them.

---

## UI kit

`ui_kits/morpho-workspace/` — a click-through recreation of the workspace at
1440 × 1024: stage regions and camera navigation, selection with the floating
toolbar, the tabbed detail popover, the AI conversation with agent process,
citations, a saveable proposal, image generation with failure and recovery, the
default-reference confirm, four drawers, ⌘K search, and the blank-project
starter. See its `README.md`.

---

## Index

| Path | What it is |
|---|---|
| `styles.css` | Global entry — `@import` list only. Consumers link this. |
| `tokens/colors.css` | Shipped `:root` colours + glass, plate, stage-region and material accents |
| `tokens/typography.css` | Font stack, sizes, weights, tracking, line heights |
| `tokens/spacing.css` | Rhythm + fixed workspace geometry |
| `tokens/shape.css` | Radii and blur recipes |
| `tokens/elevation.css` | Object / panel / popover / image / selection shadows |
| `tokens/motion.css` | Durations, easing, press and lift |
| `tokens/fonts.css` | Geist via Google Fonts (see caveats) |
| `components/canvas · chrome · controls · ai` | Components + `@dsCard` thumbnails |
| `ui_kits/morpho-workspace/` | Workspace recreation |
| `guidelines/*.html` | 19 foundation specimen cards (Colors, Type, Spacing, Brand) |
| `github.md` | Repo association, sync record, screen map |
| `thumbnail.html` · `SKILL.md` | Homepage tile · agent-skill entry point |

---

## Caveats

- **No font binaries.** The app names Geist first but ships no files; this system loads it from Google Fonts. Drop real files into `assets/fonts/` and swap the `@import` in `tokens/fonts.css`.
- **No logo asset**, by design of the source. The wordmark is set type.
- **No photographic imagery.** `ProductVisual` carries the app's own concept renders; real project imagery would still improve every mock.
- **Project home is not modelled** — it is mid-rework upstream.
- **Dark mode is out of scope** and must not be implied.
