# Morpho Operations Documentation

本目录包含 Morpho 项目的运维手册、修复程序地图、部署说明、种子数据流程以及基准测量证据。

## 目录索引与权威边界

### 1. 核心现役运维与规划文档

| 文档 | 状态与用途 | 重点说明 |
|---|---|---|
| [`runbook.md`](./runbook.md) | **权威现役运维手册** | 包含本地构建、代码验证命令、发布门禁、数据库防线与安全操作规范。任何日常工程检查与部署以此为准。 |
| [`remediation-program-map.md`](./remediation-program-map.md) | **现役修复程序地图** | 包含 14 个 remediation package 的交付顺序、依赖图、验收标准及证据指纹。是当前中长期系统修复的唯一导航入口。 |
| [`p7-aggregate-disposition.md`](./p7-aggregate-disposition.md) | **P7 当前阶段处置 / 证据入口** | Overall deferred，incomplete baseline / not release-accepted；保留子阶段结论，P7C/L4 not_run / deferred。 |
| [`case-study-seed.md`](./case-study-seed.md) | **现役数据流程** | 内置案例项目（`project-morpho-case-study`）的生成、提取与更新规范。 |
| [`cloudflare-workers.md`](./cloudflare-workers.md) | **备用架构说明** | Cloudflare Workers / OpenNext 部署方案与打包边界。当前正式环境部署于 Vercel，本方案保留为备用能力。 |

---

### 2. 历史阶段规划

| 文档 | 状态 | 说明 |
|---|---|---|
| [`next-phase-implementation-plan-2026-08.md`](./next-phase-implementation-plan-2026-08.md) | **已废弃 / 历史里程碑记录** | 2026 年 8 月迁移完成后的阶段性计划；后续工作优先级已被 [`remediation-program-map.md`](./remediation-program-map.md) 正式接替。其前瞻建议不作为当前执行依据。 |

---

### 3. 生成的基准与足迹测量产物（Generated Measurement Evidence）

本目录下保留的 `*.generated.json` 文件由 `scripts/` 中的自动化测量脚本生成，被 [`docs/architecture/performance-phase5.md`](../architecture/performance-phase5.md) 等架构分析与性能文档直接引用：

- `performance-browser.generated.json`：浏览器交互性能采样记录
- `performance-node.generated.json`：Node 侧基础负载与序列化延迟校准记录
- `performance-phase5.generated.json`：Phase 5 交互延迟图谱与 Completeness 验证记录
- `performance-zip-crossover.generated.json`：ZIP 导入与解包 cross-over 测量数据
- `storage-footprint.generated.json`：存储占用与容量测量数据

> **说明**：此类文件为测试与分析产出的结构化只读证据，请勿手动编辑。如需重新生成，需在干净的工作树上按 runbook 流程执行对应 `scripts/measure-*.mjs` 脚本。
