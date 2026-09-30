# Remediation Audit Evidence

本目录归档 Morpho 在制定 Remediation Program 期间产生的前置研究、底座评估与跨领域专项审计原始报告。

## 文件性质与使用说明

1. **历史研究与审计证据（Historical Research / Audit Evidence）**
   - 本目录下所有文档均为制定整改计划时冻结的历史调查与审计证据；
   - 完整保留了原始调查报告正文、发现条目、基线 SHA、日期、验证范围与 limitation 声明；
   - 未对原报告正文进行改写或按后续讨论重塑结论。

2. **基线代表性**
   - 每份报告仅代表其正文明确记录的代码基线（如 `HEAD 2e801ed`、`8c17c9f` 或 `3e77491` 等）；
   - 各报告中提出的初步拆分建议、假设或历史标记，不代表后续架构裁决的最终结论。

3. **非当前实现事实来源**
   - 本目录文件**不是**当前代码实现（Current Implementation）的自动事实来源；
   - 当前产品事实与规范始终以最新代码及 Canonical 规范文档为准：
     - 产品规范：`docs/product/`
     - 架构文档：`docs/architecture/`
     - 运维规范：`docs/operations/runbook.md`

4. **整改计划与依赖依据**
   - Remediation 的最终裁决范围、包切分、跨包边界、依赖顺序、准备度与执行状态，始终以统一调度入口为准：
     - `docs/operations/remediation-program-map.md`

## 归档文件索引

| 文件 | 原始主题 / 对应基线 | 关联 Remediation 范围 |
|---|---|---|
| [`01-agent-harness-audit.md`](./01-agent-harness-audit.md) | 01 Agent Harness 专项审计 (`8c17c9f`) | P2A / P2B |
| [`02-project-truth-audit.md`](./02-project-truth-audit.md) | 02 Project Truth / Domain Semantics 专项审计 | P1A / P1B-1 / P1B-2 |
| [`03-modularity-dependency-audit.md`](./03-modularity-dependency-audit.md) | 03 Modularity & Dependency Architecture 专项审计 | P1B / P2 (ownership 定点参考) |
| [`04-visual-intelligence-audit.md`](./04-visual-intelligence-audit.md) | 04 Visual Intelligence / Image Lifecycle 专项审计 (`2e801ed`) | P4 |
| [`05-research-evidence-audit.md`](./05-research-evidence-audit.md) | 05 Research / Evidence / Document Intelligence 专项审计 | P1B-1 / P2B / P0 parser |
| [`06-workspace-canvas-audit.md`](./06-workspace-canvas-audit.md) | 06 Workspace / Canvas Interaction 专项审计 | P6H / P6I |
| [`07-delivery-handoff-audit.md`](./07-delivery-handoff-audit.md) | 07 Delivery / Handoff 专项审计 | P5 |
| [`cross-domain-coherence-remediation.md`](./cross-domain-coherence-remediation.md) | CROSS 跨领域一致性与整改架构裁决 (`2e801ed`) | 全局架构收口、C1–C11 映射 |
| [`external-side-effect-provider-reliability.md`](./external-side-effect-provider-reliability.md) | EXT 外部副作用与 Provider 可靠性完整审查 (`2e801ed`) | P3S / P3A / P3B |
| [`foundational-technology-architecture-review.md`](./foundational-technology-architecture-review.md) | TECH-A 底座技术与架构适用性审查 (`2e801ed`) | P0 事务 ACK、存储演进边界 |
| [`foundational-technology-architecture-review-dr1.md`](./foundational-technology-architecture-review-dr1.md) | TECH-B 底座技术与架构适用性第二审查 (`2e801ed`) | P0 / O1 / 存储 trigger 判断 |

> 注：Eval 体系与 Design Intelligence 审查已直接维护在 `docs/research/` 根目录：
> - `docs/research/real-world-project-eval-acceptance-architecture.md` (EVAL)
> - `docs/research/design-intelligence-capability-orchestration-review.md` (DESIGN)
> 本目录不保留重复副本。
