# Morpho 设计系统 — 仓库版

从 Morpho 设计系统项目导出，目标仓库 `Whatnamed/Morpho`（`main`，`src/`）。
里面全部是**真实可运行的 React 源码**，不是设计稿导出——tokens 逐条对齐当前
`src/app/globals.css` 的 `:root`，组件逐个对齐 `src/features/workspace/` 的
已发布实现（对照表见 `docs/SOURCE-MAP.md`）。

## 放进仓库

```
cp -R morpho-design-system src/design-system
```

`src/design-system/` 与 `src/features/`、`src/domain/` 平级。默认 `@/*` → `src/*`
的路径别名已经够用，无需改 tsconfig。

### 1. 接上 tokens

`src/app/globals.css` 顶部（在自己的规则之前）：

```css
@import "../design-system/tokens.css";
```

然后把 `globals.css` 里 `:root` 那一段变量声明**删掉**——它们现在由
`tokens/*.css` 提供，同名重复声明会让两处各自漂移，这正是这次要解决的问题。
`.morpho-object-*`、`.phome-*` 这些类选择器留在 `globals.css` 不动。

### 2. 用组件

```tsx
import { Button, Icon, AiPanel, MorphoObject, StageRegion } from '@/design-system';
```

也可以直接指到文件，按需拆包更干净：

```tsx
import { CanvasIconButton, ToolbarDivider } from '@/design-system/components/chrome/SelectionToolbar.jsx';
```

65 个导出，四个族：`canvas/`（画布材质）、`chrome/`（悬浮控件层）、
`ai/`（对话面板）、`controls/`（基础控件）。每个组件旁边有：

- `Name.d.ts` — props 类型，TS 会自动解析 `./Name.jsx` 到它
- `Name.prompt.md` — 用法与设计约束，写给人也写给 AI

### 3. 依赖

只有一个新增运行时依赖，仓库里应该已经有了：

```
npm i lucide-react
```

`components/controls/Icon.jsx` 是**为仓库改写过的版本**：设计系统里那份从
`window.lucide` UMD 取图标（浏览器端预览用），这份从 `lucide-react` 取，
所以 SSR 正常。API 一样，还是 kebab-case：`<Icon name="git-branch" size={14} />`。

React 19 / Next 15 下这些组件都是客户端组件（有 `useState`），放在已经带
`'use client'` 的文件里引用，或自己在页面顶部加。

## 字体

`tokens/fonts.css` 目前从 Google Fonts 拉 Geist。仓库里应该换成
`next/font/local` 或 `next/font/google`，把那行 `@import` 删掉，
只保留 `--font-sans` 由 Next 的 CSS 变量喂进来。

## 没包含什么

- **规范卡片和 UI kit**（`guidelines/*.html`、`ui_kits/morpho-workspace/`）——
  它们依赖设计系统的运行时，只在设计系统项目里能跑。要看规范去那边看。
- **项目主页**（`ProjectHomeClient.tsx` / `.phome-*`）——上游还在改，没建模。
- **交付面板、文档阅读器、登录**——`docs/DESIGN-SYSTEM.md` 里有文字描述，
  没有组件。要做这几块界面之前先说一声。

## 保持同步

改动方向应该是单向的：**tokens 和材质在设计系统里改，然后重新导出覆盖
`src/design-system/`**。反过来在仓库里直接改这个目录，下次导出就会被冲掉。
业务逻辑（数据、tldraw shape util、路由）一律留在 `src/features/`，
这个目录只放外观。

`docs/SOURCE-MAP.md` 记着每个目录对应哪些仓库文件，做 review 时对着看。
