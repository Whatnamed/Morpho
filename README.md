# Morpho

Morpho 是一个面向产品与工业设计概念发展的 AI 辅助工作台。

它把资料、研究、关键结论、设计定义、概念方向、图像发展、项目上下文和交付准备放在同一个连续画布项目空间中，而不是拆成一组互不相干的页面、流程节点或文档。

## English Summary

Morpho is an AI-assisted concept-development workspace for product and industrial designers. It brings research materials, design definition, concept directions, image development, project context, and delivery preparation into one continuous canvas-based project space.

## 当前状态

当前仓库已经建立正式 Next.js + TypeScript 工程基础，并实现了一个可运行的桌面端工作台：

- `/` 项目首页：新建、继续最近、搜索和打开本地项目；
- `/projects/[projectId]` 项目工作台；
- 主导性的连续 tldraw 画布；
- 浮动顶部控件、左侧窄工具轨、右下连续 AI 对话面板；
- 选中对象后出现的底部详情栏；
- Morpho 领域对象、画布实例、资产、项目 catalog、本地持久化和语义状态边界；
- `schemaVersion: 4` 的 local-first 数据底座，包括隐藏、删除、淘汰、后续默认参考、交付稳定引用、安全迁移、IndexedDB 二进制资产、连续 AI 消息和轻量 Operation / Proposal 状态；
- 服务端 MiMo 流式文本聊天 route；
- 服务端 GrsAI 图像生成 route，图像任务可选择模型、比例和支持的规格；成功结果会保存为新的本地资产和新的图像对象。

当前 MiMo 文本聊天尚不发送图片像素；图片相关文本回复只能基于对象标题、摘要和用户描述。GrsAI 图像生成按静态模型 catalog 和服务端 profile 组装请求，默认模型为 `nano-banana-fast`；`nano-banana-*` 与 `gpt-image-2` 请求字段分开处理，不混用 `imageSize`。

Milestone 3 开始引入受控 AI Operation Runtime。Operation 只保存轻量状态、输入快照、Proposal、citation snapshot 和 IndexedDB artifact 引用；Research Operation 不实现无限自主 Agent Loop，保存研究草案前必须由用户确认。

## Morpho 用来做什么

- 从一句话、图片、文件、链接、草图或已有设计材料开始项目；
- 在连续画布上组织资料、研究与候选分析；
- 保留关键结论，并形成当前有效设计定义；
- 发展概念方向和图像，而不是被线性阶段强制闯关；
- 对任意图像继续发展、局部修改、比较、衍生或作为参考；
- 准备交付内容，但不替代 Figma、Keynote、PPT、CAD 或专业排版工具；
- 保留项目关系、版本、决策、交付引用和可复用上下文。

## Morpho 不是

- 通用项目管理 Dashboard；
- 节点工作流编辑器；
- Figma、PPT、CAD、工程、BOM 或 PLM 替代品；
- 模型控制台；
- 强制线性的六步流程。

## 技术栈

- Next.js App Router
- React
- TypeScript
- tldraw
- Vitest
- ESLint

当前没有实现数据库、登录、云存储、多人协作、复杂文档解析、导出或部署自动化。

## 本地开发

使用仓库内 `.npmrc` 指定的 registry。

```bash
npm.cmd install
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

本地访问：

```text
http://127.0.0.1:3000
http://127.0.0.1:3000/projects/project-nightrail
```

如需真实 AI 调用，复制 `.env.example` 为 `.env.local` 并填写服务端变量：

```text
MORPHO_AI_PROVIDER=mimo
MORPHO_MIMO_API_KEYS=
MORPHO_MIMO_API_KEY=
MORPHO_MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MORPHO_MIMO_TEXT_MODEL=mimo-v2.5-pro
MORPHO_MIMO_MULTIMODAL_MODEL=mimo-v2.5
MORPHO_MIMO_WEB_SEARCH_ENABLED=false

MORPHO_GRS_API_KEY=
MORPHO_GRS_BASE_URL=https://grsaiapi.com
MORPHO_GRS_DEFAULT_MODEL=nano-banana-fast
MORPHO_GRS_IMAGE_MODEL=

MORPHO_ALLOW_PAID_SMOKE_TESTS=false
```

不要把真实 Key 放进客户端代码、`NEXT_PUBLIC_*`、localStorage、日志或 Git 提交。

常用检查：

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

完整运行说明见 [`docs/operations/runbook.md`](docs/operations/runbook.md)。

## 文档地图

### 产品规则

- [`docs/product/README_本次更新说明.md`](docs/product/README_本次更新说明.md)
- [`docs/product/00_Morpho_v3_规则继承、覆盖与完整性账本.md`](docs/product/00_Morpho_v3_规则继承、覆盖与完整性账本.md)
- [`docs/product/01_Morpho_产品定义与总体流程.md`](docs/product/01_Morpho_产品定义与总体流程.md)
- [`docs/product/02_Morpho_工作台、画布与对象规则.md`](docs/product/02_Morpho_工作台、画布与对象规则.md)
- [`docs/product/03_Morpho_AI工作流程、阶段Context与连续性机制.md`](docs/product/03_Morpho_AI工作流程、阶段Context与连续性机制.md)
- [`docs/product/04_Morpho_状态、版本、项目记录与记忆.md`](docs/product/04_Morpho_状态、版本、项目记录与记忆.md)
- [`docs/product/05_Morpho_项目入口、资产、搜索、导入与归档.md`](docs/product/05_Morpho_项目入口、资产、搜索、导入与归档.md)

### 设计规则

- [`docs/design/README.md`](docs/design/README.md)
- [`docs/design/Morpho_UI_原型设计说明_v1.md`](docs/design/Morpho_UI_原型设计说明_v1.md)
- [`docs/design/Morpho_Light_Design_System_v1_CN_EN.md`](docs/design/Morpho_Light_Design_System_v1_CN_EN.md)
- [`docs/design/references/morpho_workspace_anchor_v2.html`](docs/design/references/morpho_workspace_anchor_v2.html)

### 工程文档

- [`docs/architecture/architecture.md`](docs/architecture/architecture.md)
- [`docs/architecture/decisions.md`](docs/architecture/decisions.md)
- [`docs/operations/runbook.md`](docs/operations/runbook.md)

## 官方示例项目

当前官方 demo 项目是：

> 夜航 / Nightrail  
> 为独居老人的夜间起身与卫浴路径设计一套低施工、非医疗化的连续辅助系统。

不要把历史原型内容，例如 `Nightfield`、“安静的仪器”、战术工具或 compact tactical-light 方案，当成 Morpho 当前正式产品内容。

## Agent 指令

所有编码 Agent 在修改仓库前必须先阅读 [`AGENTS.md`](AGENTS.md)。

Claude Code 可通过 [`CLAUDE.md`](CLAUDE.md) 读取同一套共享指令。
