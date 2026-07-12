# Morpho

Morpho 是一个面向产品与工业设计概念发展的 AI 辅助工作台。

它把资料、研究、关键结论、设计定义、概念方向、图像发展、项目上下文和交付准备放在同一个连续画布项目空间中，而不是拆成一组互不相干的页面、流程节点或文档。

## English Summary

Morpho is an AI-assisted concept-development workspace for product and industrial designers. It brings research materials, design definition, concept directions, image development, project context, and delivery preparation into one continuous canvas-based project space.

## 当前状态

当前仓库已经建立正式 Next.js + TypeScript 工程基础，并实现了一个可运行的桌面端工作台：

- `/` 项目首页：新建、继续最近、搜索和打开本地项目；
- `/login` Supabase 邮箱密码登录与注册；
- `/projects/[projectId]` 项目工作台；
- 主导性的连续 tldraw 画布；
- 浮动顶部控件、左侧窄工具轨、右下连续 AI 对话面板；
- 选中对象后出现的底部详情栏；
- Morpho 领域对象、画布实例、资产、项目 catalog、本地持久化和语义状态边界；
- `schemaVersion: 13` 的 local-first 数据底座，包括隐藏、删除、淘汰、后续默认参考、交付稳定引用、安全迁移、IndexedDB 二进制资产、连续 AI 消息、轻量 Operation / Proposal 状态、来源语义快照、关键结论、唯一当前有效设计定义、方向 create / revise / split / merge、方向内 VisualBranch、正式图片角色和可重建工作状态；
- Supabase 仅保存账号身份、测试资格和 AI 每日额度；邮箱密码注册的测试用户自动成为 active tester，文本/生图额度为 `500 / 100`；
- 通过 AiJWS OpenAI-compatible 路径的服务端文本 AI route，支持普通文本、显式选中图片的视觉理解输入，以及受控 web search citation 事件；当前示例模型为 `gpt-5.6-terra`；
- 服务端 GrsAI 图像生成 route，图像任务可选择模型、比例和支持的规格；当前默认模型为 `gpt-image-2`，成功结果会保存为新的本地资产和新的图像对象；
- 当前正式环境已部署到 Vercel；Cloudflare/OpenNext 文件保留为备用能力，不是当前正式环境。

当前 AiJWS 文本 AI 在 `对话与分析` 或 `研究任务` 中会读取显式选中的 active 图片资产：少量图片逐张发送，较多图片自动整理为总览图以覆盖全部选中资料；隐藏图片、未选旧图和整张画布不会默认发送。`MORPHO_AI_WEB_SEARCH_ENABLED=true` 时，chat/research 可使用 provider 的 web-search 能力；`imageGeneration` 永不提供联网工具。来源列表只展示 provider 返回的 citation，不从模型正文猜测。GrsAI 图像生成按静态模型 catalog 和服务端 profile 组装请求；`nano-banana-*` 与 `gpt-image-2` 请求字段分开处理，不混用 `imageSize`。

当前受控 AI Operation Runtime 覆盖研究、图像生成、设计定义草案和概念方向草案。Operation 只保存轻量状态、输入快照、语义来源快照、Proposal、citation snapshot 和 IndexedDB artifact 引用；不会保存原始 provider payload、大附件或网页正文。保存或应用草案前必须由用户确认。

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
- Supabase Auth
- Vercel
- Vitest
- ESLint

Morpho 是 local-first：项目、画布、文件、图片和可恢复备份保存在当前浏览器的 localStorage / IndexedDB，而非 Supabase。账号登录不等于项目云端同步；跨设备继续使用时必须使用项目备份/恢复边界。当前仍不包含云端项目同步、云端文件存储、多人实时协作或最终 Figma/PPT/CAD 排版。

## 部署

当前正式环境部署在 Vercel，标准验证与部署构建为 `npm.cmd run build`。Cloudflare/OpenNext 保留为备用能力；相关文件和 `cf:*` scripts 不能当作当前正式部署路径，也不应为此删除。

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

如需本地认证或真实 AI 调用，复制 `.env.example` 为 `.env.local` 并填写对应值。`.env.example` 是环境变量名称、默认值和注释的唯一基线；不要从旧 README、历史 MiMo 配置或其他文档复制变量。

不要把真实 Key 放进客户端代码、`NEXT_PUBLIC_*`、localStorage、日志或 Git 提交。

`MORPHO_AI_*` 是当前文本 AI 的 OpenAI-compatible / AiJWS 路径，示例模型为 `gpt-5.6-terra`。图像默认模型为 `gpt-image-2`。`MORPHO_GRS_IMAGE_MODEL` 仅保留为 `MORPHO_GRS_DEFAULT_MODEL` 的兼容回退。`MORPHO_AUTH_REQUIRED=false` 只用于本地显式关闭认证；默认/`true` 时缺少 Supabase 公共配置会 fail closed，受保护页面只会进入显示配置错误的 `/login`，AI route 仍返回 503。

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
