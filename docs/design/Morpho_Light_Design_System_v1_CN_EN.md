# Morpho Light Design System v1  
# Morpho 浅色设计系统 v1

> **Status / 状态**: Current visual source of truth for the first Morpho prototype  
> **Scope / 范围**: Desktop light-mode concept workspace only  
> **Reference basis / 参考来源**: The user-approved “Minimalist — Crafted for Precision” visual direction, translated for Morpho’s canvas workspace  
> **Not included / 本版不包含**: Dark mode, final brand identity, final icon set, production-level accessibility audit, or backend implementation rules

---

## 0. Purpose / 文档用途

**EN**  
This document defines the visual and spatial language for Morpho’s first light-mode prototype. It is not a generic marketing-site style guide. It should guide the workspace, canvas, floating controls, AI conversation surface, object treatments, selection states, and delivery-preparation views.

**中文**  
本文定义 Morpho 第一版浅色原型的视觉与空间语言。它不是普通官网风格指南，而是用于指导工作台、无限画布、浮动控件、AI 对话层、画布对象、选中状态和交付准备页面的统一规则。

### Use this document as / 使用优先级

```text
This document
> Morpho UI prototype specification
> Approved visual reference screenshots
> Earlier Stitch-generated design files
```

```text
本文档
> Morpho UI 原型设计说明
> 已确认的视觉参考截图
> 之前 Stitch 生成的设计文件
```

---

# 1. Design premise / 设计前提

## 1.1 Core idea / 核心想法

**EN**  
Morpho should feel like a quiet, precise product-design studio where a project grows across one continuous canvas. It should be visually refined enough to feel editorial and premium, but operationally practical enough to support research, concept development, image iteration, comparison, and delivery preparation.

**中文**  
Morpho 应呈现为一个安静、精确的产品设计工作室：项目在一张连续画布上逐步生长。它既要有编辑感和高级感，也必须能够承载调研、设计定义、图像发展、方案比较和交付准备等真实工作。

## 1.2 Visual personality / 视觉人格

| English | 中文 |
|---|---|
| Quiet authority | 安静但有分量 |
| Editorial precision | 编辑式精确感 |
| Spacious composition | 有呼吸感的空间构图 |
| Soft industrial | 柔和的工业感 |
| Restrained materiality | 克制的材质与表面表达 |
| Image-first workspace | 图像优先的工作台 |
| Calm interaction | 不打扰的交互反馈 |

## 1.3 What Morpho is not / Morpho 不是什么

**EN**
- Not a generic dashboard
- Not a card-heavy SaaS application
- Not a node editor
- Not a Figma clone
- Not a 3D material inspector
- Not a dark sci-fi AI tool
- Not an editorial website copied into a workspace

**中文**
- 不是通用 Dashboard
- 不是卡片堆叠式 SaaS 后台
- 不是节点工作流编辑器
- 不是 Figma 的复制品
- 不是 3D 材质或参数编辑器
- 不是科幻发光式 AI 工具
- 不是把编辑感官网直接搬进工作台

---

# 2. Foundational visual principles / 基础视觉原则

## 2.1 Space before UI / 先有空间，再有界面

**EN**  
The full screen should read as one continuous canvas first. Navigation, tools, chat, details, and temporary controls are floating layers placed over the canvas. They should not divide the screen into permanent rigid columns.

**中文**  
整个屏幕首先应被感知为一张连续画布。导航、工具、聊天、详情和临时控件都应是叠加在画布上的浮动层，而不是将页面切成固定的三栏或多栏。

## 2.2 Negative space is functional / 留白是功能，不是装饰

**EN**  
Large areas of quiet space make the project readable. Do not fill every area with cards, labels, or controls. Use open space to separate project phases, branches, and visual routes.

**中文**  
大面积的安静空白用于帮助阅读项目。不要把每个区域塞满卡片、标签或控件。应利用空白来区分项目重点、方案分叉与视觉路线。

## 2.3 Objects keep their material identity / 对象保留自身材料感

**EN**  
Images, files, research notes, key insights, design definitions, directions, and delivery modules should not all use one generic card shell. Their appearance should communicate what they are.

**中文**  
图片、文件、研究笔记、关键结论、设计定义、概念方向和交付模块不应都套进同一种通用卡片壳。对象本身的样式应帮助用户理解它是什么。

## 2.4 Interface chrome stays quiet / 界面壳层保持安静

**EN**  
Controls should be visible when needed but never compete with the work. The most visually important items on the canvas should be the user’s materials, concepts, and images—not toolbars.

**中文**  
控件需要在需要时可见，但不能抢走作品本身的注意力。画布上最有视觉重量的应是用户资料、方案和图片，而不是工具条。

---

# 3. Theme scope / 主题范围

## 3.1 This iteration / 当前版本

**EN**  
Only the light theme is defined in this document. Do not create or imply a dark theme in the current prototype.

**中文**  
本文档只定义浅色主题。当前原型不要生成、暗示或混入深色主题。

## 3.2 Light theme character / 浅色主题气质

**EN**
- Warm fog-white rather than pure white
- Quiet editorial warmth rather than fashion styling
- Deep graphite text rather than absolute black
- Low-chroma surfaces rather than blue-tinted enterprise UI
- A limited warm umber accent for brand-level actions
- A muted blue-gray accent for selection and relationship feedback

**中文**
- 使用暖雾白，而不是纯白
- 有安静的编辑感温度，但不是时尚 Lookbook
- 使用深石墨文字，而不是绝对纯黑
- 使用低饱和表面，而不是企业蓝灰后台
- 少量暖褐色用于品牌级主操作
- 低饱和蓝灰用于选中与关系反馈

---

# 4. Semantic color system / 语义颜色系统

## 4.1 Core tokens / 核心令牌

| Token | Value | Use / 用途 |
|---|---:|---|
| `--canvas` | `#F7F5F1` | Main infinite canvas / 主无限画布 |
| `--surface` | `#FCFBF8` | Floating panels, AI surface / 浮动面板、AI 对话层 |
| `--surface-raised` | `#FFFFFF` | Menus, popovers, focused panels / 菜单、弹层、聚焦面板 |
| `--surface-muted` | `#F0ECE6` | Hover fills, soft containers / Hover 底、轻量容器 |
| `--surface-selected` | `#EEF1F1` | Light selected background / 轻量选中底色 |
| `--text-primary` | `#211F1B` | Primary text / 主文字 |
| `--text-secondary` | `#69625A` | Secondary information / 次级信息 |
| `--text-muted` | `#978F86` | Metadata, placeholders / 元信息、占位文本 |
| `--border-subtle` | `#E4DED6` | Default borders / 默认边框 |
| `--border-strong` | `#D4CCC2` | Stronger dividers / 明确分隔线 |
| `--accent-brand` | `#8E4C24` | Primary brand action / 品牌级主操作 |
| `--accent-brand-hover` | `#78401F` | Brand action hover / 主操作悬停 |
| `--accent-brand-soft` | `#EEE0D4` | Brand accent wash / 品牌强调浅底 |
| `--accent-select` | `#6D7F88` | Selection, local route, focus / 选择、局部路线、焦点 |
| `--accent-select-soft` | `#E4EAEB` | Selection soft fill / 选中浅填充 |
| `--success` | `#4E6B52` | Quiet success feedback / 克制的成功反馈 |
| `--warning` | `#8A6834` | Attention or review / 待关注、待复核 |
| `--danger` | `#A6453A` | Destructive actions / 破坏性操作 |

## 4.2 Color usage rules / 颜色使用规则

**EN**
- Use warm umber (`--accent-brand`) for one clear primary action in a local context.
- Do not use brown for selected objects, version routes, or AI-generated relationships.
- Use blue-gray (`--accent-select`) for selected objects, local route emphasis, focus, and direct relationship hints.
- Do not use more than one saturated accent inside the same small surface.
- Avoid large colored cards. Color should support hierarchy, not replace it.

**中文**
- 暖褐色 `--accent-brand` 只用于局部环境中最明确的一个主操作。
- 不要用棕色表示对象选中、版本路线或 AI 关系。
- 蓝灰 `--accent-select` 用于选中对象、局部路线强调、焦点和直接关系提示。
- 同一个小表面内不要同时出现多个高饱和强调色。
- 避免大面积彩色卡片。颜色只服务层级，不替代层级。

---

# 5. Typography / 字体系统

## 5.1 Typeface / 字体

**Primary / 主字体**: Geist  
**Fallback / 回退字体**: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif

**EN**  
Use Geist as the primary UI typeface because it is precise, compact, and clean without feeling cold. Keep weights restrained. The system should feel edited, not loudly branded.

**中文**  
主字体使用 Geist。它精确、紧凑、干净，但不会显得过于冰冷。字重需要保持克制，让界面像经过编辑，而不是在强行强调品牌。

## 5.2 Type scale / 字体层级

| Role | Size / Line Height | Weight | Typical usage / 典型用途 |
|---|---|---:|---|
| Display | `40 / 48` | 400–500 | Empty states, project start / 空状态、项目起点 |
| Heading L | `28 / 36` | 500 | Major workspace section title / 大区域标题 |
| Heading M | `20 / 28` | 500 | Object detail title / 对象详情标题 |
| Heading S | `16 / 24` | 500–600 | Panel title, direction title / 面板标题、方向标题 |
| Body L | `16 / 26` | 400 | Long AI response, definition / 长 AI 回复、设计定义 |
| Body M | `14 / 22` | 400 | Standard content / 常规内容 |
| Body S | `12 / 18` | 400–500 | Metadata, secondary descriptions / 元信息、辅助说明 |
| Label | `11 / 16` | 500–600 | UI labels, object roles / UI 标签、对象角色 |

## 5.3 Typographic rules / 排版规则

**EN**
- Headlines should be medium weight, not heavy bold.
- Large text is rare in the workspace. Reserve it for intentional moments.
- Metadata should use softer color before reducing size too aggressively.
- Small labels may use subtle letter spacing (`0.03em–0.05em`) but should not be over-capitalized.
- Avoid all-caps as the default style for Chinese UI labels.

**中文**
- 标题以中等字重为主，不要使用过重粗体。
- 大标题在工作台中应少用，只在真正需要强调的时刻出现。
- 元信息优先降低对比度，不要一味缩得太小。
- 小标签可以使用轻微字距（`0.03em–0.05em`），但不要过度大写化。
- 中文 UI 标签不要默认全部大写。

---

# 6. Spacing and layout rhythm / 间距与布局节奏

## 6.1 Base scale / 基础尺度

```text
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96
```

**EN**  
Use 4px as the fine adjustment unit. Use 8px as the common internal rhythm. Use 24px and above to create meaningful spatial separation.

**中文**  
以 4px 为细调单位，以 8px 为常规内部节奏。24px 以上用于建立真正有意义的空间分隔。

## 6.2 Layout spacing / 布局间距

| Area | Rule / 规则 |
|---|---|
| Canvas edge inset | `24–32px` minimum / 最少 `24–32px` |
| Floating panel padding | `20–24px` / `20–24px` |
| Compact control spacing | `8–12px` / `8–12px` |
| Major canvas clusters | `48–96px` / `48–96px` |
| AI panel internal spacing | `16–24px` / `16–24px` |
| Object group separation | Prefer open space before borders / 先用空白再用边框 |

## 6.3 Workspace geometry / 工作台几何规则

**EN**
- The canvas occupies the full viewport beneath all floating UI.
- Do not center all content in a fixed web container.
- Do not use fixed 12-column webpage grids in the canvas.
- Use horizontal movement for project progression and vertical space for branches, comparisons, or side explorations.
- The canvas should support both focused clusters and large quiet gaps.

**中文**
- 画布应占据所有浮动 UI 下方的完整视口。
- 不要把画布内容限制在居中的网页容器内。
- 不要在画布中使用固定的 12 栏网页栅格。
- 项目推进主要使用横向空间，分支、比较和局部探索使用纵向空间。
- 画布需要同时容纳聚焦内容群和大面积安静空隙。

---

# 7. Shape, border, and elevation / 形状、边框与层级

## 7.1 Corner radius / 圆角

| Element | Radius |
|---|---:|
| Small tags, chips, inner elements | `4px` |
| Buttons, inputs, small controls | `6–8px` |
| Floating panels, context menus | `10–12px` |
| Image objects and document objects | `8–12px` |
| AI conversation surface | `16–20px` |
| Full pill | Only for compact status chips / 仅用于小型状态标签 |

**EN**  
Avoid overly round “friendly SaaS” shapes. The system should feel softened, not inflated.

**中文**  
避免过度圆润的“亲和 SaaS”形状。系统应是柔和的，而不是膨胀可爱的。

## 7.2 Borders / 边框

```css
--border-default: 1px solid rgba(78, 68, 58, 0.14);
--border-quiet: 1px solid rgba(78, 68, 58, 0.08);
--border-focus: 1px solid #6D7F88;
```

**EN**  
Use borders to clarify object boundaries and surface changes. Avoid stacking border + strong shadow + colored background on the same element.

**中文**  
边框用于说明对象边界和表面层级。不要在同一个元素上同时叠加明显边框、重阴影和彩色背景。

## 7.3 Elevation / 阴影与层级

| Level | Use / 用途 | Shadow |
|---|---|---|
| 0 | Canvas objects with no lift / 无需抬升的画布对象 | none or near-none |
| 1 | Floating controls and panels / 浮动控件与面板 | `0 6px 24px rgba(30,24,18,.05)` |
| 2 | Menus and active popovers / 菜单与激活弹层 | `0 12px 36px rgba(30,24,18,.08)` |
| Focus | Selected object / 选中对象 | no lift; use outline + halo / 不抬升，用描边与光晕 |

**EN**  
Depth comes from placement, surface contrast, and subtle shadows—not dramatic elevation.

**中文**  
层级主要来自位置、表面差异和极轻阴影，而不是强烈抬升感。

---

# 8. Workspace composition / 工作台构图

## 8.1 Full-canvas first / 画布优先

**EN**  
The workspace must read as one full canvas. UI should be layered above it.

**中文**  
工作台必须首先呈现为一整张画布。UI 是叠加在画布上的层。

## 8.2 Top controls / 顶部控件

**EN**
- Use two small floating clusters instead of a full-width navigation bar.
- Top-left cluster: Morpho mark, project name, optional quiet context.
- Top-right cluster: search, view controls, import, export / archive.
- Use translucent warm-white surfaces or no visible container until hover.
- Keep the top layer shallow and visually quiet.

**中文**
- 使用两个小型浮动控件组，不使用整条固定导航栏。
- 左上：Morpho 标识、项目名称、可选的轻量项目语境。
- 右上：搜索、视图控制、导入、输出 / 归档。
- 使用半透明暖白表面，或默认不显示容器、Hover 后再显现。
- 顶部层要薄、安静。

## 8.3 Left rail / 左侧工具栏

**EN**
- A narrow floating rail, inset from the canvas edge.
- A circular create / add action near the top.
- Minimal icon controls below: area navigation, assets, hidden items, project actions.
- No user-avatar block, large version badge, or fixed white sidebar shell.
- Rail should feel like a creative tool accessory, not application navigation.

**中文**
- 一根窄小的浮动工具栏，和画布边缘保持内缩距离。
- 顶部附近放圆形的新建 / 添加入口。
- 下方保留少量图标：区域导航、资产、隐藏内容、项目入口。
- 不要用户头像块、大版本号或固定白色侧栏壳。
- 工具栏要像创作工具附件，而不是传统应用导航栏。

## 8.4 Right AI panel / 右侧 AI 面板

**EN**
- AI panel is expanded by default, but it is an overlay—not a page column.
- Anchor it toward the lower-right side of the canvas.
- Recommended width: `420–460px`.
- Recommended height: `55–65vh`.
- It overlaps the canvas and never permanently pushes or narrows it.
- When collapsed, reduce it to a compact floating trigger near the lower-right corner.
- It should remain a continuous conversation surface, never an object property inspector.

**中文**
- AI 面板默认展开，但它是覆盖层，不是页面栏。
- 锚定在画布右下侧。
- 建议宽度：`420–460px`。
- 建议高度：`55–65vh`。
- 它覆盖画布，但不能永久挤压或缩窄画布。
- 收起后变成右下角紧凑的浮动入口。
- 它始终是连续聊天层，不能变成对象属性检查器。

## 8.5 Bottom detail bar / 底部详情栏

**EN**
- Appears only after object selection.
- Floats near the lower center or lower edge.
- Starts compact: object name + key actions.
- Expands on demand to show Info, Source, Version, Related, Decision.
- Do not turn it into a large always-on editor toolbar.

**中文**
- 仅在选中对象后出现。
- 浮在底部中央或底部边缘。
- 初始紧凑显示：对象名称 + 关键操作。
- 用户按需展开后才显示信息、来源、版本、关联、决策。
- 不要把它做成常驻的大型编辑器工具条。

---

# 9. Canvas language / 画布语言

## 9.1 Canvas surface / 画布表面

**EN**
- Use warm fog-white `--canvas`.
- Optional grid or dot texture must be extremely subtle.
- Recommended grid opacity: `0.025–0.04`.
- Do not use strong graph paper, dark dots, or visible design-tool grid lines.
- The canvas should feel tactile and calm, closer to refined paper than a technical blueprint.

**中文**
- 使用暖雾白 `--canvas`。
- 可选的网格或点阵必须极弱。
- 建议网格透明度：`0.025–0.04`。
- 不要使用明显的方格纸、深色点阵或强技术制图网格。
- 画布应有安静的纸面感，而不是工程蓝图感。

## 9.2 Stage landmarks / 阶段定位

**EN**
- Stages are spatial landmarks, not large boxed containers.
- Use small quiet labels such as “Research”, “Definition”, “Visual Development”, or “Delivery”.
- A stage may use an extremely faint wide wash or soft edge zone.
- Do not use giant dashed rounded rectangles.
- Do not force equal grids or rows inside a stage.

**中文**
- 阶段是空间定位点，不是大号容器。
- 使用小而安静的标签，如“调研”“设计定义”“视觉发展”“交付准备”。
- 阶段可使用极淡的宽范围底色或柔边区域。
- 不要使用大号虚线圆角框。
- 不要强制阶段内部变成等宽网格或整齐排版。

## 9.3 Object composition / 对象构图

**EN**
- Use loose horizontal clusters to communicate progression.
- Use vertical offsets to communicate branches, variants, comparisons, or local experiments.
- Preserve meaningful gaps between clusters.
- Avoid aligning every object to a strict card grid.
- Images should frequently act as visual anchors.

**中文**
- 使用松散的横向对象群表达推进。
- 使用纵向偏移表达分支、变体、比较和局部探索。
- 内容群之间保留有意义的间隙。
- 不要把所有对象强行对齐成卡片网格。
- 图片应经常承担画面中的视觉锚点作用。

---

# 10. Object treatment / 对象样式规则

## 10.1 Image objects / 图片对象

**EN**
- Images should feel like image tiles, not dashboard cards.
- Use an image-first composition.
- Add only minimal title, role label, or source cue below or near the image.
- Avoid long text blocks inside image containers.
- Use a light edge or subtle backing surface only when image contrast needs support.

**中文**
- 图片应像图片对象，而不是 Dashboard 卡片。
- 以图像为主。
- 仅在图片下方或附近提供最少量的标题、角色标签或来源线索。
- 不要在图片容器内塞长文字。
- 仅在图片对比不足时使用轻边框或浅色衬底。

## 10.2 Research and analysis / 研究与分析

**EN**
- Research objects should feel like restrained editorial documents.
- Use soft paper-like surfaces, not bright colored note cards.
- Highlight only one key phrase or one conclusion at a time.
- Keep sources and metadata quiet.

**中文**
- 研究对象应有克制的编辑文档感。
- 使用柔和纸面表面，不做鲜艳便签卡。
- 每次只突出一个关键句或一个结论。
- 来源和元信息保持安静。

## 10.3 Key insights / 关键结论

**EN**
- Compact, high-legibility statement objects.
- They may be almost borderless.
- Use role label + one concise insight.
- Avoid large colored rectangles.

**中文**
- 紧凑、易读的结论对象。
- 可以几乎没有边框。
- 使用类别标签 + 一句清楚结论。
- 避免大面积彩色矩形。

## 10.4 Design definition / 设计定义

**EN**
- A larger editorial document object.
- It may use a slightly raised near-white surface and clearer hierarchy.
- It should feel important but not like a modal or full page.
- Avoid filling it with internal system metadata.

**中文**
- 一个更大、更具文档感的对象。
- 可使用略微抬升的近白表面和更明确层级。
- 它应显得重要，但不是弹窗或整页。
- 不要塞入内部系统元数据。

## 10.5 Concept direction / 概念方向

**EN**
- Concise strategy object with direction name, one-sentence logic, and 2–3 keywords.
- Visually light. It should start a route, not become a large product card.
- Status should remain minimal and appear only when useful.

**中文**
- 紧凑的策略对象，包含方向名称、一句核心逻辑和 2–3 个关键词。
- 视觉上保持轻。它是路线起点，不是大产品卡。
- 状态保持最少，只在有意义时出现。

## 10.6 Delivery module / 交付模块

**EN**
- Shows content being assembled into a narrative structure.
- May include stable image references, title, caption, and content gaps.
- Do not make it look like a full Figma frame or slide editor.
- Use structure and whitespace rather than dense editor chrome.

**中文**
- 呈现内容正在被整理成叙事结构。
- 可包含稳定图片引用、标题、图注和内容缺口。
- 不要做得像完整 Figma 画板或幻灯片编辑器。
- 通过结构和留白，而不是密集工具栏，表达其功能。

---

# 11. Selection and relationship behavior / 选择与关系行为

## 11.1 Default state / 默认状态

**EN**
- No global relationship graph.
- No permanent spiderweb lines.
- No node ports, arrows, or workflow wires.
- Project structure is primarily visible through layout, proximity, stage landmarks, object groups, route alignment, and object roles.

**中文**
- 不显示全局关系图。
- 不显示常驻蜘蛛网式连线。
- 不显示节点端口、箭头或工作流线。
- 项目结构主要通过布局、距离、阶段定位、对象群、路线对齐和对象角色来表达。

## 11.2 Selected state / 选中状态

**EN**
- Selected object receives a `1–2px` blue-gray outline and a soft halo.
- Its local route becomes easier to read through a gentle background corridor or subtle alignment emphasis.
- Directly related objects become slightly clearer.
- Unrelated objects may become slightly quieter, but should not vanish or become strongly blurred.
- Only direct relationships may appear temporarily: parent version, child version, direction association, delivery reference, or direct downstream assets.
- Relationship curves, when shown, use thin solid low-opacity lines.
- Do not use animated dashes, moving particles, arrows, visible ports, or full-canvas wires.

**中文**
- 选中对象使用 `1–2px` 蓝灰描边和柔和光晕。
- 通过极浅的路线底色或轻微对齐强调，使它所在的局部路线更易阅读。
- 直接相关对象略微更清楚。
- 无关对象可以稍微安静，但不能消失或被强烈模糊。
- 仅可临时显示一层直接关系：父版本、子版本、所属方向、交付引用或直接下游素材。
- 关系曲线出现时，使用极细、低透明度的实线。
- 不要使用动画虚线、流动粒子、箭头、端口或全画布连线。

## 11.3 Selection token / 选中令牌

```css
--selection-outline: #6D7F88;
--selection-halo: rgba(109, 127, 136, 0.18);
--selection-route: rgba(109, 127, 136, 0.06);
--relationship-line: rgba(109, 127, 136, 0.42);
```

---

# 12. AI conversation surface / AI 对话层

## 12.1 Role / 角色

**EN**  
The AI panel is a calm design partner. It does not function as a system dashboard, object inspector, or control center.

**中文**  
AI 面板是一位安静的设计搭档。它不是系统 Dashboard、对象检查器或控制中心。

## 12.2 Expanded state / 展开状态

**EN**
- Float above the canvas.
- Use a near-white panel with a warm surface tint.
- Use one continuous rounded surface.
- Allow messages to be readable with generous line height.
- Suggestions should appear as light text actions or subtle chips, never as a wall of colored pills.
- Input area should feel integrated, not like a separate mobile chat composer.

**中文**
- 浮在画布上方。
- 使用带轻微暖色的近白面板。
- 使用一个连续的大圆角表面。
- 消息排版要有较宽松的行高。
- 建议应以轻量文字操作或克制标签呈现，不能变成一墙彩色胶囊。
- 输入区应融合在面板里，不要像独立的手机聊天输入框。

## 12.3 Collapsed state / 收起状态

**EN**
- Compact floating trigger near the lower-right corner.
- Use a small icon plus optional short label.
- The trigger should feel present but not demand attention.
- Opening should feel like revealing a working surface, not opening a modal dialog.

**中文**
- 位于右下角的紧凑浮动入口。
- 可使用小图标 + 可选短标签。
- 入口要存在感适中，不主动抢注意力。
- 展开时像展开一块工作表面，而不是打开模态弹窗。

---

# 13. Controls and components / 控件与组件

## 13.1 Primary action / 主操作

**EN**
- One clear primary action per local surface.
- Use `--accent-brand`.
- Use 6–8px radius.
- Use medium weight text, not bold shouting.
- Use concise verb-first labels.

**中文**
- 每个局部表面最多一个明确主操作。
- 使用 `--accent-brand`。
- 使用 6–8px 圆角。
- 使用中等字重，不要大喊式粗体。
- 使用简短、动词优先的标签。

## 13.2 Secondary and ghost actions / 次级与幽灵操作

**EN**
- Prefer text-first or border-light controls.
- Hover should only add a soft surface fill.
- Avoid outlined buttons everywhere; use them selectively.

**中文**
- 优先使用文字优先或轻边框控件。
- Hover 只增加轻微表面填充。
- 不要到处使用描边按钮，只在必要时使用。

## 13.3 Status indicators / 状态标签

**EN**
- Compact and quiet.
- One core status per object maximum.
- Use neutral surface and text first; reserve accent for meaningful distinctions.
- Avoid progress percentages, task labels, and colorful badge stacks.

**中文**
- 紧凑且安静。
- 每个对象最多一个核心状态。
- 优先使用中性表面和文字，只有真正重要的区别才使用强调色。
- 避免进度百分比、任务标签和一串彩色 badge。

## 13.4 Toolbars / 工具条

**EN**
- Floating and compact.
- Prefer icon controls with clear tooltips.
- Use surface + fine border + soft shadow.
- Do not create thick white bars spanning the entire viewport.
- Keep the bottom toolbar intentionally small and contextual.

**中文**
- 浮动且紧凑。
- 优先使用图标控件，配清晰 tooltip。
- 使用表面 + 细边框 + 极轻阴影。
- 不要做横跨整个视口的厚白色工具栏。
- 底部工具栏要小，并且与当前语境相关。

---

# 14. Motion / 动效

## 14.1 Principles / 原则

**EN**
- Motion should explain state change, not decorate.
- Use smooth, low-amplitude transitions.
- Avoid playful bounce, neon pulse, flowing wires, or dramatic zooms.
- Most transitions should be `160–260ms`.

**中文**
- 动效用于解释状态变化，不用于装饰。
- 使用平滑、低幅度的过渡。
- 避免弹跳、霓虹脉冲、流动连线或夸张缩放。
- 大多数过渡保持在 `160–260ms`。

## 14.2 Recommended motion / 建议动效

| Event | Motion / 动效 |
|---|---|
| Floating panel opens | Fade + 8px slide / 淡入 + 8px 位移 |
| Object selection | Outline + soft halo fade-in / 描边与柔光淡入 |
| Direct relation reveal | Gentle opacity fade / 轻微透明度显现 |
| AI result placement | Short fade-up, no bounce / 短淡入上移，不弹跳 |
| Object hover | Surface or border shift, no lift unless needed / 表面或边框变化，非必要不抬升 |

---

# 15. Accessibility and readability / 可访问性与可读性

**EN**
- Maintain readable contrast between text and warm backgrounds.
- Do not rely on color alone to communicate project state.
- Selected state must combine outline, halo, and local route emphasis.
- Provide visible keyboard focus outlines.
- Keep small text above 11px whenever possible.
- Do not make thin gray metadata the only source of important information.

**中文**
- 保持文字与暖色背景之间的可读对比度。
- 不要只通过颜色表达项目状态。
- 选中状态必须同时使用描边、光晕和局部路线强调。
- 提供可见的键盘焦点描边。
- 尽可能让小文字不低于 11px。
- 不要让过细的灰色元信息成为重要信息的唯一来源。

---

# 16. Explicit prohibitions / 明确禁止项

## Do not use / 不要使用

- Full-width fixed website navigation bars  
  整条固定官网式导航栏

- Permanent three-column application shell  
  常驻三栏应用外壳

- AI panels that push the canvas width  
  会挤压画布宽度的 AI 栏

- Full-height inspector-style property panels  
  全高 Inspector 式属性面板

- Node ports, model graphs, workflow wires, or queues  
  节点端口、模型图、工作流连线或队列

- Large dashed stage boxes  
  大号虚线阶段框

- Equal-width card grids for canvas content  
  画布内容的等宽卡片网格

- Card-inside-card composition as a default  
  默认的卡片套卡片构图

- Multiple saturated accent colors in one view  
  单视图中出现多种高饱和强调色

- Strong blue enterprise buttons everywhere  
  满屏企业蓝主按钮

- Excessive brown/fashion-editorial decoration  
  过度棕色或时尚编辑装饰

- Strong glassmorphism, glow, neon, or sci-fi texture  
  强玻璃拟态、发光、霓虹或科幻纹理

---

# 17. Agent implementation instructions / 给 Agent 的执行说明

## English

Use this document as the visual source of truth for the Morpho light-mode workspace.

Prioritize:
1. Full-canvas spatial composition
2. Floating interface layers
3. Warm editorial light theme
4. Object-specific material treatment
5. Quiet interaction and selection feedback
6. Local-only relationship visibility

When a conflict occurs:
- Preserve product behavior from the Morpho UI prototype specification.
- Preserve visual language from this document.
- Do not copy website layouts or generic SaaS patterns into the workspace.

## 中文

将本文档作为 Morpho 浅色工作台的视觉规则源。

优先保证：
1. 全画布空间构图
2. 浮动界面层
3. 暖色编辑感浅色主题
4. 对象具有不同材料感
5. 安静的交互与选中反馈
6. 仅局部显示关系

发生冲突时：
- 产品行为以 Morpho UI 原型设计说明为准。
- 视觉语言以本文档为准。
- 不要把官网布局或通用 SaaS 模式直接搬进工作台。

---

# 18. Compact token block / 精简 Token 块

```css
:root {
  --canvas: #F7F5F1;
  --surface: #FCFBF8;
  --surface-raised: #FFFFFF;
  --surface-muted: #F0ECE6;
  --surface-selected: #EEF1F1;

  --text-primary: #211F1B;
  --text-secondary: #69625A;
  --text-muted: #978F86;

  --border-subtle: #E4DED6;
  --border-strong: #D4CCC2;

  --accent-brand: #8E4C24;
  --accent-brand-hover: #78401F;
  --accent-brand-soft: #EEE0D4;

  --accent-select: #6D7F88;
  --accent-select-soft: #E4EAEB;
  --selection-halo: rgba(109, 127, 136, 0.18);
  --selection-route: rgba(109, 127, 136, 0.06);
  --relationship-line: rgba(109, 127, 136, 0.42);

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 18px;

  --shadow-panel: 0 6px 24px rgba(30, 24, 18, 0.05);
  --shadow-popover: 0 12px 36px rgba(30, 24, 18, 0.08);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
}
```

---

# 19. One-sentence summary / 一句话总结

**EN**  
Morpho is a warm, editorial, light-mode product-design workspace where the canvas remains open and dominant, interface layers float quietly above it, images and ideas retain their own material identity, and relationships become explicit only when the user needs to inspect a local route.

**中文**  
Morpho 是一个带暖色编辑感的浅色产品设计工作台：画布始终开放并占据主导，界面层安静地浮在其上，图片与想法保持各自的材料感，关系只在用户需要查看局部路线时显现。
