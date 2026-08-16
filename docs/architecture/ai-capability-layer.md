# Morpho AI Capability Layer — Audit, Design & Implementation

> Status: implemented on branch `feat/ai-capability-layer` (2026-08-16),
> closure pass 2026-08-17 (Web Search authority preservation, Compare
> authority split, clause-first memory semantics, deterministic memory final
> check, compaction/image prompt contract identity).
> Scope: the AI behavior and professional-capability layer of Morpho — persona,
> per-turn method guidance, strategy delivery, memory guard, compaction prompt,
> image compiler. Runtime, authority, memory kernel, and context-frame
> architecture were audited but intentionally not rewritten.

## 1. Pre-change AI Capability Architecture (as built)

Morpho's formal Agent is a single continuous Responses-based agent
(`/api/ai/agent/turns/**`). The provider request is assembled as:

1. **Stable System Prompt** — `buildMorphoAgentStableSystemPrompt()`:
   canonical product/authority/continuity/memory/tool/cache/image rules plus the
   prompt contract version. Byte-identical across turns and strategies.
2. **Canonical Runtime Item** — server-owned system item (mode, tool profile,
   prompt contract).
3. **Client-owned dynamic input** — up to 24 provider context frames
   (Project State, Turn Context, Runtime Configuration, Conversation Summary),
   uncompressed history, and the current user message; server-validated,
   low-privilege `user`-role data envelopes marked "untrusted project data".
4. **Tool registry** — one deterministic ordered profile (`standard` /
   `standardWithWebSearch`), server-owned descriptions with an appended
   `Tool effect:` boundary line.

Task Strategy (`discussion / research / designDefinition / conceptDirection /
directionPreview / visualDevelopment / comparison / deliveryPreparation /
historyAndMemory`) is resolved deterministically client-side
(`resolveAgentTaskStrategy`), drives task context selection and required-read
rules, and reaches the model only as a strategy **label** inside the Turn
Context frame.

Images follow: Agent → Structured Visual Intent → deterministic reference
resolution → deterministic `ImagePromptCompiler` → provider. Memory is a
source-driven projection kernel with a locally validated
`submit_memory_update` tool. Compaction uses a fixed JSON-only summary
contract with a separate server prompt.

## 2. AI Capability Map — audit findings (A = mature / F = broken)

| # | Layer | Grade | Finding |
|---|---|---|---|
| 1 | Core Persona / Stable System Prompt | **B−** | Solid rules contract, but no design-partner persona: nothing about respecting existing user work, maturity-adapted depth, evidence vs inference, real design variables, or user authority over design decisions. |
| 2 | Stable policy / authority / security | **A** | Confirmation matrix, untrusted-data policy, tool effect matrix are complete and tested. |
| 3 | Task Strategy blocks | **F (delivery)** | Policy text is good but **never reaches the model**. `canonicalAgentStrategyMessage` is only used for token estimation; the A+ migration (`agentTurnProviderRequest.ts`) dropped the server materialization that existed in the pre-A+ contract (`agentProviderContract.ts` handled `morpho_strategy` markers). The doc contract ("Strategy policy is materialized by the server as a canonical System item") is not implemented. |
| 4 | Task Strategy Resolver | **A−** | Deterministic, predictable, well tested. One minor gap: research-synthesis chat requests ("帮我看看资料里值得做的点") fall to `discussion`. |
| 5 | Tool descriptions / schema | **B** | Clear; one stale reference to a non-existent memory reminder hint in `submit_memory_update`. |
| 6 | Required read rules | **A** | Resolver + key/stage validation + one reminder + one repair. |
| 7 | Project State Context Frame | **A** | Stable memory projections, hash-deduped baselines. |
| 8 | Turn Context Frame | **A−** | Strategy label, scope, memory deltas; correct untrusted envelope. |
| 9 | Memory injection & write rules | **B− / F (leak)** | Guard blocks "这次先…" markers, but **turn-specific phrasings without those markers leak into long-term memory** (e.g. "这张图不要高反光" → avoidance candidate in project scope). The memory-candidate reminder prompt is dead code (never wired). |
| 10 | Stage Record | **A** | Revision-chained current projections. |
| 11 | Compaction prompt | **C** | Schema strict and well bounded; prompt names fields but gives **no per-field semantics** and no design-evolution guidance (explored-but-unconfirmed directions, rejected alternatives, confirmed constraints, why-decisions). |
| 12–18 | Research / Definition / Direction / Visual / Preview / Compare / Delivery behavior | **C/D** | Professional method exists only as 1–2 line strategy policies that never arrive, plus image role policies. No per-turn professional method layer. |
| 19–23 | Visual intent / compiler / roles / adapters / reference resolution | **A−** | Complete structured pipeline with role policies and task templates. Minor: no explicit "design intent > rendering decoration" principle; scenario role lacks human scale/action grounding. |
| 24 | Suggestion behavior | — | UI-owned; not part of the prompt layer. |
| 25 | Prompt Contract / cache stability | **A** | Stable prefix genuinely stable; shared exact-budget helper models the full server prefix (incl. strategy/method items) at helper level — production compaction wiring stays the separately tracked G1 debt; contract versioned. |
| 26 | Prompt injection / untrusted evidence | **A** | Frames are untrusted envelopes; stable policy hard-codes injection resistance; compaction treats user content as untrusted. |
| 27 | Tests / fixtures | **A−** | Extensive; gaps: strategy-delivery composition, method layer, one-off memory clauses. |

### Real gaps worth fixing (in scope)

1. **Strategy policy never delivered** (F) — restores the documented trusted
   canonical strategy item.
2. **No professional method layer** (D) — lightweight runtime-owned Method
   Packs, injected per turn only when relevant.
3. **Persona is a rules contract, not a design partner** (B−) — compact
   persona block in the stable prompt.
4. **One-off memory leak** (F) — clause-level turn-reference guard.
5. **Compaction prompt under-specifies design evolution** (C) — per-field
   semantics in the compaction directive.
6. **Image compiler**: explicit "design intent > decoration" + scenario
   human-context grounding (B).

### Recorded but intentionally NOT fixed (out of scope)

- Item-count pressure path (`estimateProviderInputTimelineBudget`) has no
  production caller; `maybeCompact` gate vs execution limits mismatch;
  `force: "emergency"` unreachable (`conversationCompaction.ts`,
  `agentTurnRunner.ts`).
- `buildProviderContextFrameTimeline` (active-summary / covered-frame
  filtering) has no production caller; production ships raw last-24 frames.
- `runtimeConfiguration` frames are never created in the A+ flow (the runtime
  item is server-owned and re-derived per request, so this is a
  persistence-consistency gap, not a wire bug).
- Prompt-cache-hint key omits mode/runtime-item text (hint only, not
  correctness).
- The memory final check is delivered as ONE transient runtime-control
  Provider-input message armed at preparation when candidates exist (see the
  closure section): it never enters `workspace.ai.messages`, rides the exact
  request body through retry/refresh/recovery, and is never regenerated. A
  post-hoc continuation after a no-Tool final answer is impossible under the
  A+ Journal contract (no-Tool answers settle `externallyCompleted`
  terminal; continuations require `awaitingNextRequest` plus non-empty Tool
  items), so the reminder is proactive, not reactive.

## 3. Architecture Proposal (as implemented)

- **Persona** → stays in the Stable System Prompt as a compact behavior
  block (design partner, maturity-adapted depth, evidence layering, real
  design variables, visual-as-design-tool, no jargon/lecturing, user
  authority). Bumped contract to `morpho-agent-v3.6-2026-08-17`. Note: the
  rebase integration temporarily kept the mainline `v3.4-2026-08-13` label
  while the stable prompt already differed; the v3.5 bump restored the rule
  that the version identifies the actual prompt contract content, and the
  v3.6 bump covers the canonical comparison strategy text change (chat-only
  Compare by default, persisted Compare only on explicit save intent).
- **Strategy** → keeps its role ("what kind of work is this turn?"). Delivery
  restored: client sends `strategy` + `strategyAnchorMessageId`; server
  validates the kind and materializes the existing
  `canonicalAgentStrategyMessage` as a trusted System item right after the
  Runtime item.
- **Method Packs** → new lightweight layer (registry + deterministic
  resolver in `src/shared/designMethodPack.ts`), answering "what professional
  judgment does this work need now?". The client selects ids; the server
  validates ids against the fixed registry and materializes the pack *text*
  as one trusted System item. 11 packs for v1; 0–3 packs per turn (real code
  contract `MAX_METHOD_PACKS_PER_TURN = 3`); ordinary discussion gets none.
- **Cache** → stable prefix (system prompt + runtime item) untouched; the
  strategy and method items sit between the runtime item and dynamic input,
  are stable within a turn and per strategy, and never contain project data.
- **Image prompts** → the structured intent → deterministic compiler pipeline
  is preserved; two short principles added.
- **Compaction / Memory** → compaction prompt gets field semantics (schema
  unchanged); memory guard gets the one-off clause boundary.

### Prompt / context cost

| Item | Before | After |
|---|---|---|
| Stable System Prompt | ~1.5 KB | ~2.1 KB (persona + memory line) |
| Strategy block | 0 (not delivered) | ~0.2–0.5 KB for strategy turns |
| Method block | 0 | 0.1–0.7 KB only when packs are relevant |
| Discussion, tiny request | baseline | +0 KB (no packs, persona already in stable prefix) |

No per-turn design handbook: a typical discussion turn adds nothing beyond
the stable prefix; a visual-development turn adds ~0.3–0.9 KB of method
guidance.

## 4. Deliverables

- `src/shared/designMethodPack.ts` — registry (11 packs), deterministic
  resolver, canonical trusted message.
- A+ protocol: `src/shared/agentTurnJournalProtocol.ts`,
  `src/server/ai/agentTurnProviderRequest.ts`,
  `src/features/workspace/agentTurnProductPreparationAPlus.ts`,
  `src/features/workspace/agentTurnCoordinator.ts` — strategy + method pack
  delivery.
- Persona: `src/features/workspace/agentPromptRegistry.ts`.
- Memory: `src/features/workspace/agentMemoryUpdateGuard.ts` (one-off clause
  guard), memory policy + `submit_memory_update` tool description.
- Compaction: `src/app/api/ai/agent/turns/[turnId]/actions/compaction/route.ts`
  (field semantics, contract `morpho-agent-compaction-v3-2026-08-17`).
- Image: `src/domain/operations/imagePromptCompiler.ts` (contract
  `morpho-image-prompt-v3`).
- Closure pass: `agentTurnCoordinator.ts` (webSearch copy + fail-closed shape),
  `morphoAgent.ts` + `agentToolAuthority.ts` + `agentToolExecutors.ts`
  (Compare record authority), `agentMemoryUpdateGuard.ts` (clause-first
  semantics), `agentTurnProductPreparationAPlus.ts` (memory final-check
  reminder), `agentStrategyItem.ts` (comparison policy), prompt contract v3.6.
- Tests: `src/shared/designMethodPack.test.ts`, additions to
  `agentTurnProviderRequest.test.ts`, `agentMemoryUpdateGuard.test.ts`,
  `morphoAgent.test.ts`, `imagePromptCompiler.test.ts`,
  `agentToolBatchAPlus.test.ts`.
- Eval corpus: `docs/architecture/ai-capability-eval-corpus.md`.
- This document + `docs/architecture/architecture.md` +
  `docs/architecture/decisions.md` updates.

## 5. Before / After examples

**Strategy policy delivery (was: never delivered)**

- Before: the model only saw `本轮任务策略：conceptDirection` inside an untrusted
  frame; the policy "概念方向必须在产品架构、机制、比例、部件关系或形态语言上有
  真实差异" never reached the provider request.
- After: the server materializes a trusted System item
  `[Morpho Canonical Strategy | trusted server item] / Task strategy: conceptDirection`
  with the full policy block, right after the Runtime item, for every request of the
  turn.

**Professional method (was: none)**

- Before: `visualDevelopment` turns carried only the visual-intent schema; nothing
  told the model how to interpret a reference or explore CMF vs form.
- After: a CMF request ("只研究 CMF，结构别动") adds a trusted
  `[Morpho Canonical Design Method | trusted server item]` item with the
  `CMF 探索` pack: "不只换颜色：比较材料、表面工艺、纹理、光泽/哑光、透明度与
  分件配色关系。保持产品几何与关键部件位置稳定…"。A plain "好的，谢谢" adds
  nothing.

**Persona (was: rules contract)**

- Before: the stable prompt opened with "你是 Morpho 项目工作台中的唯一连续
  Agent。用户与 Agent 在一个项目会话中持续工作。"
- After: it opens with the continuous design-partner framing and adds compact
  judgment defaults (evidence layering, real design variables, user decision
  authority, no jargon/lecturing), still versioned and byte-identical per turn.

**Memory one-off leak (was: leaking)**

- Before: "这张图不要高反光" produced an `avoidance` memory candidate eligible for
  project-scope long-term memory.
- After: clause-first admission — every clause is judged independently. A
  clause carrying a concrete one-off scope (这张图/这版/这个角度/这次/本轮/临时/
  先试…) is rejected unless an EXPLICIT project-level scope (课设/课题/项目/整机/
  全案/产品线/整个产品/总体/全局/本项目/本课题) or a constraint SUBJECT (预算/
  成本) paired with an explicit quantitative constraint form ("预算不得超过 500",
  "成本上限 300") overrides it. Bare "统一"/"稳定" are deliberately NOT scope
  markers: "这张图统一一下配色" stays one-off. Stable preference intent is
  recalled WITHOUT any scope word ("我喜欢低饱和配色", "默认用暖灰色",
  "我偏好哑光材质", "以后所有方向都不要高反光"), while one-off preference
  wording ("这版保持哑光") stays rejected. Kind classification additionally
  requires high-confidence stance: constraint needs normative syntax
  (必须/不得/不能/不超过/至少/上限/控制在/限制在…) and preference needs an
  explicit stance (我喜欢/我偏好/默认/以后/统一采用/希望保持…), so ordinary
  design discussion ("这个材质怎么样？", "这个尺寸合适吗？", "颜色换哪个更
  好？") never produces a candidate or memory authority. Mixed messages keep
  their legal clauses: "这次先把背景换白色；预算不能超过 500 元" retains only
  the project-constraint clause. Quantitative constraint forms ("不要超过",
  "不得低于"…) classify as `constraint`, not `avoidance`.

**Compare authority (was: one authority for analysis and record)**

- Before: explicit comparison + ≥2 selected objects allowed
  `create_comparison_analysis` (a Workspace Compare write) even for "把这两个
  比较一下".
- After: ordinary comparison is chat-only. A persisted Compare record needs an
  EXPLICIT save intent BOUND to the Compare record ("保存这次比较",
  "保留比较记录", "创建比较记录", "记录一下比较结果", "把比较结果留在项目里",
  "把比较结论存档") on top of the explicit comparison request, enforced
  locally and fail-closed: the tool is absent from `allowedTools` for plain
  comparisons and the executor blocks the write even if the model calls it.
  Proximity alone never grants — "比较结果怎么样？", "创建两个方案然后比较一
  下", "记录一下预算，再比较两个方案" stay closed. The canonical comparison
  strategy text and the tool description state the chat-only default, and the
  strategy resolver shares the same compare-action recognition (the adverb
  "比较省钱" is not a compare action).

**Web Search authority (was: lost in Coordinator copy)**

- Before: `capabilityIntent.webSearch` was dropped by
  `AgentTurnCoordinator.copyProviderRequest()`; after any Coordinator copy the
  server normalized it to false, so an authorized turn never exposed
  `search_web_evidence`.
- After: the bit survives copy, active-request restore, recovery
  export/restore, exact retry, and continuation; recovery shape validation is
  fail-closed (only `undefined | boolean` legal). The server contract
  (global web-search enabled AND current-turn user authority) is unchanged.

**Deterministic memory final check (was: dead code)**

- Before: `buildRequiredAgentMemoryUpdateReminder` /
  `shouldPromptForMemoryUpdate` / `memoryUpdateReminderInserted` /
  `handledMemoryCandidateIndexes` existed but no production path delivered the
  reminder.
- After: when the current user message produces legal long-term candidates,
  the initial Provider input carries ONE transient runtime-control message
  (never persisted to `workspace.ai.messages`) requiring the model to either
  call `submit_memory_update` with verbatim evidence or skip with
  `items: []` + non-empty `skippedReason` before ending the turn;
  `memoryUpdateReminderInserted` enters Recovery facts, so refresh/retry never
  re-arms or regenerates it, and an unanswered reminder never loops (the flag
  is set once at preparation).

**Compaction (was: field names only)**

- Before: the directive listed JSON field names without semantics; summaries
  depended on unguided model inference.
- After: the directive defines each field (threadGoal, establishedContext,
  decisionsAndReasons *with why, including confirmed rejections and
  eliminations*, activeWork *explored-but-unconfirmed candidates and current
  explorations only — confirmed rejected/eliminated directions must never be
  listed in activeWork*, unresolvedQuestions, referencedObjects,
  nextTurnAnchor) under contract `morpho-agent-compaction-v3-2026-08-17`;
  schema and non-authoritative status unchanged.

**Image compiler (was: role policies only)**

- Before: every compiled prompt started directly with task and role sections.
- After: compilation asserts "设计意图优先于渲染装饰" and scenario visuals are
  grounded in scale, action, and human-product relationships ("不是把产品放进漂亮
  背景"), under contract `morpho-image-prompt-v3`.

## 6. Verification

See the final report in the task closeout: targeted tests, full Vitest suite,
`npm run lint`, `npm run typecheck`.
