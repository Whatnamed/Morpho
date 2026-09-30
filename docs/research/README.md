# Morpho Research & Audit Evidence

本目录包含 Morpho 项目的背景调研、评估架构、能力编排审查与历史修复审计证据。

## 目录性质与定位

- **非权威规范**：本目录下的所有文件均为探索性调研、分析评估或特定历史基线的审计证据，**不直接定义当前产品规则或当前架构实现**。
- **产品规则来源**：产品行为与设计语义以 [`docs/product/`](../product/README_本次更新说明.md) 为准。
- **架构实现来源**：已落地工程架构与决策以 [`docs/architecture/`](../architecture/README.md) 为准。
- **修复计划来源**：长期代码与体系修复规划以 [`docs/operations/remediation-program-map.md`](../operations/remediation-program-map.md) 为准。

---

## 1. 行业与交互研究（Background Research）

作为产品探索与设计决策的参考输入，不构成系统约束：

| 文档 | 说明 | 原文件名 |
|---|---|---|
| [`product-design-concept-ai-workspace-benchmarks.md`](./product-design-concept-ai-workspace-benchmarks.md) | 产品与工业设计概念阶段 AI 工作台竞品格局、流程分段与机会点分析 | `deep-research-report1.md` |
| [`product-design-concept-ai-interaction-patterns.md`](./product-design-concept-ai-interaction-patterns.md) | 44 项面向概念阶段的小功能与交互细节清单（上下文容器、画布中心工作区、选区 AI 等） | `deep-research-report2.md` |

---

## 2. 评估架构与能力审查（Evaluative Architecture Reviews）

用于指导 Eval 基准设计与模型能力编排的系统分析：

| 文档 | 说明 | 状态与用途 |
|---|---|---|
| [`real-world-project-eval-acceptance-architecture.md`](./real-world-project-eval-acceptance-architecture.md) | 真实项目评测与验收架构设计（4 层 Eval 体系、离线快照、确定性打分） | 评测套件设计输入 |
| [`design-intelligence-capability-orchestration-review.md`](./design-intelligence-capability-orchestration-review.md) | 设计智能能力编排、策略路由与模型协同审查 | 能力层演化参考 |

---

## 3. 历史修复审计证据（Remediation Audits Archive）

详见子目录独立索引：[`remediation-audits/README.md`](./remediation-audits/README.md)。

收录 2026 年 9 月开展的一揽子跨领域与专项审计证据（7 份专项审计报告、Cross-Domain 报告、EXT 外部副作用审查、TECH-A 基础技术审查、TECH-B 审查）。全部报告均绑定其产生时的代码基线（如 `2e801ed` / `8c17c9f`），作为 [`docs/operations/remediation-program-map.md`](../operations/remediation-program-map.md) 的只读回溯证据。
