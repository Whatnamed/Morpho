# Morpho

Morpho 是面向产品与工业设计的 AI 工作台。设计师可以把资料、研究、方向和图像放在同一画布上，借助 Agent 读取资料、比较方案并准备交付。

仓库中可以运行的是 v3.2 Web 工作台。下一代以桌面端 Design Agent 为主，Web 版本是否继续提供、桌面技术栈及专业设计策略仍待确定。[下一阶段产品与工程方向](docs/product/next-generation-direction.md)

## 本地运行

使用 Node.js 24（与 CI 一致）和 npm。在仓库根目录复制 `.env.example` 为 `.env.local`。只体验本地画布时设置 `MORPHO_AUTH_REQUIRED=false`。

```sh
npm ci
npm run dev
```

打开 [localhost:3000](http://localhost:3000)。首次打开会载入内置案例。AI 请求使用服务端配置的 Supabase 和 Provider。开发 Agent 时，`npm run agent:lab` 可离线执行一次固定响应的工具调用。

## 从哪里开始

| 任务 | 入口 |
| --- | --- |
| 修改现行产品或工作台交互 | [v3.2 产品规则](docs/product/README_本次更新说明.md) · [设计规范](docs/design/README.md) |
| 定位领域命令、项目存储、Agent 或 API | [现行架构](docs/architecture/architecture.md) · [技术决策](docs/architecture/decisions.md) |
| 配置、测试、运行 Agent Lab、部署 Web | [运行手册](docs/operations/runbook.md) |
| 更新内置案例 | [案例导入](docs/operations/case-study-seed.md) |
| 阅读既有研究或复核旧验收 | [研究索引](docs/research/README.md) · [历史基线](docs/archive/README.md) |
