# 附录 B：死代码、循环依赖、重复机制、前端样式与脚本测试审计

> 所属报告：[Morpho 下一阶段工程适用性审查报告](./report.md)
> 审查基线：`main` @ `d55062e7fcdc5dfe0f12b08e43523bee7223dac6`（2026-11-19）

## 1. 零生产调用方的文件与死导出清单（静态全量调用图核验）

通过解析 `src/` 与 `scripts/` 全部静态/动态 import、以及对所有 `/api/` 路径与关键符号全仓 `git grep` 核实：

### 1.1 完全无生产调用方的 API 路由与生产模块

| 文件路径 | 行数 | 生产调用方 | 现有测试/脚本调用方 | 历史成因与处置判断 |
|---|---:|---|---|---|
| `src/app/api/ai/chat/route.ts` | 316 | **0** | `route.test.ts`、`agentRuntimeArchitecture.test.ts:31`（强制断言文件存在！） | 早期 M2/M3 独立聊天路由；正式面板早在 2026-07 已全部切到 `/api/ai/agent/turns/**`，但 P3A/P3B 仍被迫给它接了 Effect/Result 托管，持续消耗维护成本 |
| `src/server/ai/request.ts` | 1,466 | **0**（仅被死亡的 `/api/ai/chat` import） | `src/server/ai/request.test.ts`（967 L） | 仅服务于 `/api/ai/chat` 的全套请求校验与旧 Prompt 组装 |
| `src/app/api/ai/effects/[effectId]/route.ts` | 53 | **0**（前端只调 `/effects/[effectId]/result`） | 仅 `scripts/p7b-l1b-ambiguity.mjs`、`scripts/p7b-l1b-cancellation.mjs` | P3A 为外部观察/取消预建的端点，前端从未接入 |
| `src/domain/operations/conceptDirectionProposal.ts` | 118 | **0** | `conceptDirectionProposal.test.ts` | Pre-Agent 时代解析自由文本 JSON 提案的旧 parser，已被工具调用替代 |
| `src/domain/operations/designDefinitionProposal.ts` | 94 | **0** | `designDefinitionProposal.test.ts` | 同上 |
| `src/domain/operations/researchProposal.ts` | 111 | **0** | `researchProposal.test.ts`、`researchSemanticPatch.test.ts` | 同上 |
| `src/features/workspace/agentStreamClient.ts` | 181 | **0** | `agentStreamClient.test.ts`、`AgentProcessDisclosure.dom.test.ts` | Pre-A+ 时代 SSE 客户端，已被 `agentTurnCoordinatorHttpHost.ts` 取代 |
| `src/features/workspace/agentStreamScripts.ts` | 110 | **0** | `agentStreamScripts.test.ts` | 留在 `src/features/workspace/` 里的测试脚本夹具 |
| `src/features/workspace/aiSendGuards.ts` | 53 | **0** | `aiSendGuards.test.ts` | M5-C 时代的旧 Compare 发送守卫 |
| `src/features/workspace/workspaceSnapshotHistory.ts` | 138 | **0** | `workspaceSnapshotHistory.test.ts` | 旧整份工作区快照 Undo，P6H 已替换为 `workspaceManualHistory.ts` |
| `src/app/api/build-provenance/route.ts` | 17 | **0**（应用业务无调用） | 仅 `e2e/p7-integrated.spec.ts`、`performance-phase5.spec.ts`、`performance-zip-crossover.spec.ts` | 专为离线性能/P7 验收防脏构建而建 |

### 1.2 混在 `src/` 生产目录中的测试/基准夹具与薄包装垫片

| 文件路径 | 行数 | 实际消费方 | 问题 |
|---|---:|---|---|
| `src/domain/morpho/caseStudy/legacyNightrailPristine.fixture.json` | 1,276（39 KB） | **`workspace.ts:36` 静态 import！** | 明明注释写着 test-only fixture，却通过 `workspace.ts` 打包进生产前端 bundle |
| `src/domain/morpho/caseStudy/currentCaseWorkspace.generated.json` | 26,468（1.50 MB） | **`workspace.ts:35` 静态 import！** | 被 29 个 prod 模块传递依赖；且仍为 schema v17，每次新建示例都现场迁移 |
| `src/features/workspace/performanceBenchmarks.ts` | 275 | 仅 `scripts/measure-performance.mjs` + 单测 | 基准测试工具混在业务 feature 目录 |
| `src/features/workspace/performanceScenarios.ts` | 120 | 同上 | 同上 |
| `src/features/workspace/storageFootprintScenarios.ts` | 148 | 仅 `scripts/measure-storage-footprint.mjs` + 单测（且单测硬读 `docs/operations/storage-footprint.generated.json`） | 同上 |
| `src/features/workspace/workspaceScaleFixtures.ts` | 285 | 仅 perf scripts + `e2e/support/` | 同上 |
| `src/shared/benchmarkSampling.ts` | 219 | 仅 `scripts/measure-performance.mjs` + 单测 | 同上 |
| `src/features/workspace/agentTurnHostFake.ts` | 117 | 单测 + `scripts/agent-lab/run.ts` | 测试 Fake 混在 prod 目录（同类 Fake 都在 `src/test/`） |
| `src/features/workspace/agentPromptRegistry.ts` | 1 | 薄 re-export 垫片（`export * from "@/shared/agentPromptRegistry"`） | 历史搬迁遗留 |
| `src/features/workspace/workspaceUndo.ts` | 3 | 薄 re-export 垫片（re-export `workspaceManualHistory.ts`） | 历史搬迁遗留 |

### 1.3 大型活跃文件中的死导出 / 无效代码（抽样核实）

| 位置 | 符号 | 核实结果 |
|---|---|---|
| `src/features/workspace/morphoAgent.ts:119-131` | `buildMorphoAgentSystemPrompt` | 接收 8 个重型参数，函数体为 `void input; return buildMorphoAgentStableSystemPrompt();`；**0 prod 调用** |
| `src/features/workspace/morphoAgent.ts:175-208` | `buildAgentDefaultMemoryPromptBlock` | 34 行；**0 prod 调用、0 test 调用** |
| `src/features/workspace/morphoAgent.ts:210-241` | `buildAgentConversationPromptBlock` | 32 行；**0 prod 调用** |
| `src/features/workspace/morphoAgent.ts:243-245` | `buildMorphoAgentInitialTools` | 3 行；**0 prod 调用、0 test 调用** |
| `src/domain/morpho/workspace.ts:545-637` | `assembleAiContext` | 93 行；已被 `taskContext.ts` 取代，**0 prod 调用**（仅 `workspace.test.ts`） |
| `src/domain/operations/operations.ts:1413` | `recordConceptDirectionProposal` | **0 prod 调用**（生产路径只用 `recordAndApplyConceptDirectionProposal`） |
| `src/domain/operations/operations.ts:2248` | `detectResearchSourceChanges` | **0 prod 调用**（仅 `workspace.test.ts` 与 `operations.test.ts`） |
| `src/features/workspace/agentToolExecutors.ts:229-234` | `const coverage = validateRequiredAgentReadCall(...); void coverage;` | 无副作用调用后直接 `void` 丢弃结果 |

## 2. 模块依赖病灶：5 组循环依赖 SCC 与跨层反向依赖

### 2.1 Tarjan SCC 检出的 5 组生产循环依赖

1. **客户端 A+ 核心 6 模块巨环**：
   `agentTurnRecoveryStore.ts` ↔ `agentTurnProductPreparationAPlus.ts` ↔ `agentToolBatchAPlus.ts` ↔ `agentExternalActionClientAPlus.ts` ↔ `agentToolExecutors.ts` ↔ `agentTurnHost.ts`
2. **协议与领域类型 3 模块环**：
   `shared/agentStreamProtocol.ts` ↔ `domain/operations/types.ts` ↔ `domain/morpho/types.ts`
3. **服务端 Responses 适配器 2 模块环**：
   `server/ai/openaiCompatibleResponsesStream.ts` ↔ `server/ai/openaiCompatibleProvider.ts`
4. **交付领域 2 模块环**：
   `domain/morpho/deliveryPreparation.ts` ↔ `domain/morpho/deliveryInspection.ts`
5. **视觉生成客户端 2 模块环**：
   `features/workspace/independentImageDelivery.ts` ↔ `features/workspace/workspaceVisualGenerationExecution.ts`

### 2.2 跨层反向依赖（破坏分层方向）

- **`domain/` 反向依赖 `infrastructure/`**：
  - `src/domain/morpho/caseStudy/caseStudyInstallation.ts` → `src/infrastructure/assets/localAssetWorkflow.ts`
  - `src/domain/morpho/importResourcePolicy.ts` → `src/infrastructure/assets/localAssetWorkflow.ts`
- **`shared/` 反向依赖 `server/` 与 `domain/`**：
  - `shared/agentToolContract.ts`、`shared/agentStrategyItem.ts`、`shared/designMethodPack.ts`、`shared/turnTaskContract.ts` 全部反向 import `src/server/ai/openaiCompatibleProvider.ts`（拉入服务端类型定义）
  - `shared/agentReadTools.ts` 运行时 import `src/domain/morpho/projectMemory.ts`
- **`features/` 客户端模块大量 import `server/ai/types.ts`**：
  - 7 个 `src/features/workspace/*` 模块直接 import `@/server/ai/types`（仅为了 `ProviderCitation` 类型）。

## 3. 重复实现与叠床架屋机制目录

### 3.1 九处分散的自然语言正则意图分类器
同一轮用户消息在发给 LLM 之前，会被以下 9 个文件用互有重叠、细微不一致的中英文正则反复切片和分类：
1. `src/shared/userInstructionAuthority.ts`（132 L：11 类动作正/反正则 + 引用语境剥离）
2. `src/shared/webSearchAuthority.ts`（22 L）
3. `src/features/workspace/aiTaskRouting.ts`（275 L：`recommendAiTaskMode`、`recommendAiWorkIntent`、`NEGATED_IMAGE_GENERATION_PATTERN` 等）
4. `src/features/workspace/agentTaskStrategy.ts`（392 L：`resolveAgentReadIntent`、`resolveAgentTaskStrategy`、`resolveRequiredMemoryKeys`、`resolveRequiredStages`）
5. `src/features/workspace/turnTaskResolver.ts`（228 L：按标点拆句、识别 critique / visual scope / auxiliary exclusions / `observeGeneratedImages`）
6. `src/features/workspace/agentToolAuthority.ts`（232 L：`explicitConfirmationActions`、二次授权拦截）
7. `src/features/workspace/morphoAgent.ts`（`isExplicitComparisonRequest` / `isExplicitComparisonRecordRequest` 及程度副词 scrub）
8. `src/shared/designMethodPack.ts`（`resolveDesignMethodPackIds` 关键词匹配选最多 3 包）
9. `src/domain/morpho/conversationSemanticPatch.ts`（`hasSemanticLifecycleRequest`）+ `src/features/workspace/agentVisualGenerationBatch.ts`（数量正则解析）

### 3.2 两套并行服务端执行账本 + 快乐路径绕行 Postgres 分片回拉
单次常规 LLM 文本请求（`POST /api/ai/agent/turns/[turnId]/requests`）的真实调用链核验（见 `requests/handler.ts`、`externalEffectJournal.ts`、`externalResultStore.ts`、`agentTurnCoordinatorHttpHost.ts`、`20261001154434_add_external_result_delivery.sql`）：
- **账本 1（A+ Turn/Action Journal，`private.agent_turn_*` 4 表）**：管 turn 创建、step 准入、工具 claim、结算。
- **账本 2（P3A/P3B Effect/Result Escrow，`public.external_*` 5 表）**：管冻结请求、attempt、observation、512 KB base64 分片托管、24h 逻辑过期、ACK。
- **叠加代价**：
  1. 单步文本请求触发 **~12–14 次顺序 Postgres RPC**（含每次 `operate_external_effect`/`operate_external_result` 内部反复执行 `cleanup_external_result_payloads` 4 条 DML）；
  2. `operate_external_result('publish')` 在 SQL 内先调用一次 `settle_agent_turn_request_with_verified_authority`，返回后 `requests/handler.ts:337` 又通过 RPC 再调用一次 `settleRequest`；
  3. **即便 SSE 流完好打开**，服务端也不直接下发最终 `providerOutput`，而是写满 Postgres `external_result_chunk` 后发 `resultAvailable` 清单，迫使浏览器暂停 SSE、再发起 `GET /api/ai/effects/[effectId]/result?chunk=i` 分片回拉、校验 SHA-256、写本地 ACK outbox，最后再 `POST /api/ai/effects/[effectId]/result` 确认。一次 3 步工具调用回合可达 **~35–40+ 次 Postgres RPC**。

### 3.3 双轨持久化项目记忆/连续性系统
- `projectMemory.ts`（1,335 L）：7 类 `ProjectMemoryKey`（`designBrief` / `userPreferences` / `outputPlan`）+ 6 类 `StageRecordKey`，维护完整版本链 `revisions` & `stageRevisions`，由 `usePersistentWorkspace.ts:159` 在每次 `setWorkspace` 时自动触发 `reconcileProjectMemoryAfterWorkspaceChange`（与 P1B-2 声称“移出持久化 Hook”不符）。
- `projectContinuity.ts`（1,665 L）：同源的 7 类 `ProjectMemoryViewKey`（命名变为 `designDefinition` / `preferencesAndAvoids` / `deliveryPlan`）+ `recordEntries` 事件流。
- 实测在内置案例中两者合计占工作区 JSON **397 KB**（占整个设计对象数据的 **4 倍**）。

### 3.4 自动模式 vs 确认模式双轨执行 + 图像生成双路径
- `agentToolExecutors.ts`（910 L）与 `useWorkspaceConfirmationExecutionController.ts`（873 L）重复实现研究、定义、方向、比较、视觉生成的前置校验与落盘。
- 图像生成分成 A+ Turn 内 `POST /api/ai/agent/turns/[turnId]/actions/image`（330 L）与确认后独立的 `POST /api/ai/image`（123 L），导致客户端 `workspaceVisualGenerationExecution.ts` 膨胀至 1,024 行并与 `independentImageDelivery.ts` 形成循环依赖。

### 3.5 手写校验器与 Zod 4 并存
- `package.json` 已引入 `"zod": "4.4.3"`，且 commit `04ef4b8` 用 83 行 `agentReadTools.ts` 证明了单源定义（Schema + JSON Schema + Runtime Parse）的简洁性；
- 但其余 10 个 Agent 工具、全套 `TurnTaskContract`、`AgentTurnLifecycleState`（1,593 L）、`agentTurnProviderRequest.ts`（651 L）、`currentWorkspaceValidation.ts` + `currentWorkspaceContractValidation.ts`（合计 2,243 L）仍全靠数千行手写 `isRecord` / `unknownKeys` / 字段遍历维护。

## 4. 前端工作台、Canvas 与 CSS 瀑布债

- **`WorkspaceClient.tsx`（2,779 L）**：67 个 import、16 个自定义 hook、21 `useState`、8 `useRef`、75 `useCallback`、20 `useMemo`、10 `useEffect`/`useLayoutEffect`。即便 2026-08 拆了 12+ Controller，它仍是把所有子系统拉通的巨型胶水层。
- **`AiConversationPanel.tsx`（1,540 L）**：接收 **47 个必需 Props**（见 `aiConversationPanelProps.ts`），强耦合单连续会话、底部右侧固定抽屉布局、旧 Proposal 编辑器与 Confirmation 槽位。
- **`MorphoCanvas.tsx`（1,801 L）**：26 个 `useRef` 维护 React 状态与 tldraw 双向同步。关键隐患：`MorphoCanvas.tsx:274-316` 的 `canvasComponents` 用内联箭头函数 `OnTheCanvas: () => <CanvasRelationshipOverlay .../>` 和 `InFrontOfTheCanvas: () => <CanvasSelectionToolbar .../>` 且将 `workspace` 放入 `useMemo` 依赖数组——每次 `workspace` 变化（包括流式输出）都会生成新的组件函数引用，导致 `<Tldraw components={canvasComponents} />` 反复 unmount/remount 覆盖层组件。
- **`src/app/globals.css`（10,165 L / 201 KB）**：
  - 按时间顺序追加了 10+ 轮 `UI refinement` / `Phase 1 polish` / `R3 pass 1/2/3` / `UI polish completion` 覆盖段；
  - 960 个独立单行选择器中，**179 个被重复定义 2–6 次**（`.ai-panel` 6×、`.document-reader-panel` 6×、`.rail-button.active` 5×、`.search-layer` 5×、`.ai-input` 5×、`.morpho-object-designDefinition` 5×、`.morpho-object-delivery` 5×）；
  - 含 12 处 `!important`、49 处硬编码 hex 色值，同时与 `src/design-system/tokens/`（146 个 CSS 变量）及 `docs/design/design-system/`（102 个未进构建的参考模板文件）并存。

## 5. 测试、脚本与构建工具链审计

- **高耦合/水泥化测试**：
  - `src/features/workspace/agentRuntimeArchitecture.test.ts`（84 L）：直接扫描文件系统和源码字符串，**强制断言死亡路由 `src/app/api/ai/chat/route.ts` 存在**，断言 `WorkspaceClient` 必须 import `useWorkspaceAgentRuntimeController`，断言 `workspace.ts` 必须含 `_legacyOutcomeItem` 等历史字段名。
  - `src/server/ai/agentRuntimeMigration.test.ts`（28 L）：对 2026-07 一次性执行的 10 行 DROP 迁移做 SQL 字符串 `.toContain()` 断言。
  - `src/features/workspace/storageFootprintScenarios.test.ts`：单测读取 `docs/operations/storage-footprint.generated.json` 生成文档，使文档清理会打断单测。
  - 类似的 SQL 字符串正则测试还有 `agentTurnJournal.test.ts`、`agentTurnExternalActionJournal.test.ts`、`agentTurnAdmissionMigration.test.ts`、`externalResultProtocol.test.ts`。
- **`scripts/`（58 文件 / 5,638 L）分类**：
  - `p7-eval`：**33 文件**（57%！）——P7 已于 2026-10-10 `deferred` 收口，但这批脚本连同 `e2e/eval/`（14 文件，2,900 L）和 `e2e/p7-integrated.spec.ts`（343 L）仍留在主仓库。
  - `agent-lab`：11 文件（刚合入，服务下一阶段调试）。
  - `build-start-cf`：5 文件（含 `build-cloudflare.mjs` 及 `build-provenance.mjs`）。
  - `perf-storage-measure`：3 文件（配合 `e2e/performance-phase5.spec.ts` 1,806 L、`performance-baseline.spec.ts` 277 L、`performance-zip-crossover.spec.ts` 284 L、`e2e/fixtures/perfProbe.ts` 765 L）。
  - `probe-verify-other`：4 文件（`probe-agent-responses-stream.mjs` 481 L、`test-prompt-cache-compatibility.mjs` 114 L、`verify-external-effect-journal.mjs`、`verify-external-result-delivery.mjs`）。
  - `case-study`：2 文件。
- **Cloudflare/OpenNext 备用链条维护税**：
  - 虽正式环境唯一部署在 Vercel，且 `next-generation-direction.md` 转向本地运行 / 开源分发 / 中国大陆演示环境，仓库仍保留 `@opennextjs/cloudflare` + `wrangler`、`wrangler.jsonc`、`open-next.config.ts`、`public/_headers`、`.dev.vars.example`、`scripts/build-cloudflare.mjs`、`src/server/buildCloudflareIsolation.test.ts`、`docs/operations/cloudflare-workers.md`，以及 `.github/workflows/quality.yml` 中每次 push/PR **必跑的第三个 CI job `cloudflare`**。
