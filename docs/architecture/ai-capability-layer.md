# Morpho AI Capability Layer — Audit, Design & Implementation

> Status: implemented on branch `feat/ai-capability-layer` (2026-08-16).
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
- Memory-candidate reminder prompt is dead code; wiring it means mid-turn
  runtime surgery — recorded, not done. The stable policy + tool description
  were updated instead so capture relies on the model contract, not a runtime
  injection.

## 3. Architecture Proposal (as implemented)

- **Persona** → stays in the Stable System Prompt as a compact behavior
  block (design partner, maturity-adapted depth, evidence layering, real
  design variables, visual-as-design-tool, no jargon/lecturing, user
  authority). Bumped contract to `morpho-agent-v3.5-2026-08-17`. Note: the
  rebase integration temporarily kept the mainline `v3.4-2026-08-13` label
  while the stable prompt already differed; the v3.5 bump restores the rule
  that the version identifies the actual prompt contract content.
- **Strategy** → keeps its role ("what kind of work is this turn?"). Delivery
  restored: client sends `strategy` + `strategyAnchorMessageId`; server
  validates the kind and materializes the existing
  `canonicalAgentStrategyMessage` as a trusted System item right after the
  Runtime item.
- **Method Packs** → new lightweight layer (registry + deterministic
  resolver in `src/shared/designMethodPack.ts`), answering "what professional
  judgment does this work need now?". The client selects ids; the server
  validates ids against the fixed registry and materializes the pack *text*
  as one trusted System item. 11 packs for v1; 0–2 packs per turn; ordinary
  discussion gets none.
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
  (field semantics, contract `morpho-agent-compaction-v2-2026-08-16`).
- Image: `src/domain/operations/imagePromptCompiler.ts`.
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
- After: the clause is rejected as a one-off turn reference unless an explicit
  long-term scope marker ("以后/整个项目/始终…") is present. Bare "这次/本轮"
  alone is not a one-off signal, but neither is a bare product/dimension noun:
  a clause passes the one-off guard only with an EXPLICIT project-level scope
  ("这次课设预算不能超过 500 元", "本轮项目产品尺寸必须控制在桌面范围内" — 课设/项目/
  预算/成本/整机/全案/产品线/整个产品/总体/全局). "这次产品不要用蓝色", "这次尺寸
  不要改" remain one-off and are rejected.

**Compaction (was: field names only)**

- Before: the directive listed JSON field names without semantics; summaries
  depended on unguided model inference.
- After: the directive defines each field (threadGoal, establishedContext,
  decisionsAndReasons *with why*, activeWork *including explored-but-unconfirmed
  directions and rejected alternatives*, unresolvedQuestions, referencedObjects,
  nextTurnAnchor); schema and non-authoritative status unchanged.

**Image compiler (was: role policies only)**

- Before: every compiled prompt started directly with task and role sections.
- After: compilation asserts "设计意图优先于渲染装饰" and scenario visuals are
  grounded in scale, action, and human-product relationships ("不是把产品放进漂亮
  背景").

## 6. Verification

See the final report in the task closeout: targeted tests, full Vitest suite,
`npm run lint`, `npm run typecheck`.
