**Morpho 已经具备连续视觉发展的领域骨架，但尚未形成可靠的“生成意图 → 实际图像 → 观察与判断 → 后续发展”闭环。** 当前最需要解决的是参考范围、真实输入证据、继承关系和结果回读，而不是增加更多 Prompt、独立 Critic 或自动生成循环。
审计基于当前 `HEAD 2e801ed`，覆盖产品规则、Agent Context、视觉计划与执行、Provider、对象关系、Compare、Memory 和 Delivery。运行了 16 个相关测试文件，**187 项测试通过**；另外完成了 10 类内存中的离线复现场景。未修改代码，最终 Git 工作区干净。没有调用真实模型或付费图像服务，以下将实现事实与模型效果判断分开说明。
**先看当前系统实际完成了什么。**

| 生命周期环节当前真实实现判断 |                                                      |                         |
| -------------- | ---------------------------------------------------- | ----------------------- |
| 看图             | Agent 接收当前选择及部分 Context 图片；少量单独发送，多图转总览图             | 有真实视觉输入，但细节质量和输入身份表达仍有限 |
| 规划             | Agent 输出 `VisualIntentItem`，区分改变、保留、允许变化、角色、视角、CMF 等 | 方向正确，应保留                |
| 参考解析           | 按显式参考、选择、父图/分支根、方向代表图、默认参考、项目参考排序                    | 确定性存在，但范围和继承语义有实质问题     |
| 生成             | Compiler 生成 Prompt，逐项调用 Provider，保存新资产、新对象和生成记录      | 执行链较完整，输入证据不够可信         |
| 回看与发展          | 下一轮结果图保持选中或重新选中时，可以发送像素分析                            | 支持用户驱动迭代；同轮生成后没有视觉回读    |
| Compare        | 局部比较；保存记录另需明确意图；校验视觉证据资格                             | 边界值得保留                  |
| Memory         | 来源驱动的记忆投影、决定和阶段记录                                    | 写入权限较克制，但作用域在投影链路泄漏     |
| Delivery       | 稳定引用快照、显式刷新、资产完整性检查                                  | 引用稳定性较好；交付文案尚不能视为看图核验结果 |

**以下是最重要的问题，按实际影响排序。**

1. **[Correctness，高优先级] 明确排除默认参考仍可能无效，参考范围也会被隐式扩大。**

   我复现了完整组合：
   ```
   用户：继续发展这张图，不要使用默认参考
   Context：把默认参考判为 included
   Agent 意图：excludeDefaultReference = true
   Resolver：仍以 selectedSource 身份保留默认图
   最终 Prompt：同时声称“本轮明确排除项目默认参考”
   ```
   原因有两层：Context 用包含“默认参考”的正则判断请求，没有识别否定；编译调用又把整个 `context.objectIds` 当成 `selectedSourceObjectIds`，使自动加入的对象获得“用户选择”的优先级。[Context 判断 (line 464)]\(/D:/Morpho/src/features/workspace/taskContext.ts:464)、[编译入口 (line 130)]\(/D:/Morpho/src/features/workspace/agentToolBatchAPlus.ts:130)、[排除例外 (line 57)]\(/D:/Morpho/src/domain/operations/visualReferenceResolver.ts:57)。

   同一链路还有三个已确认的行为：
   - 未选中的项目 `reference` 图片会作为候选自动加入，复现中成功进入生成计划。
   - A 方向默认图被加入 B 方向图片的继续发展，随后被 validator 拒绝，导致本来有效的 B 方向操作无法执行。
   - 显式指定 5 张参考时，当前限制保留前 4 张，第 5 张仅记录 `providerLimit`；计划仍通过，工具结果没有把这次遗漏返回给 Agent。
     执行端的 `allowedObjectIds` 又包含计划自己提交的全部参考 ID，因此这项检查不能独立证明参考范围获得授权。[执行校验 (line 272)]\(/D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.ts:272)。
   **应修正的是范围契约：用户选择、任务背景、显式参考、默认补充必须分开。** 允许跨方向借鉴和允许继承其身份，也应是两种不同判断。
2. **[Correctness，高优先级] 参考像素缺失时，仍会生成并保存不准确的 provenance。**

   执行器收集了 `missingPixelObjectIds`，但提交前没有消费这个结果。离线模拟唯一参考图的 Blob 不存在，实际观察到：
   ```
   Provider 请求：images = []
   referenceObjectIds：仍保留来源图 ID
   本地结果：正常创建
   generation.editMode：仍为 imageToImage
   ```
   这会让“沿原图保留比例和结构”的操作退化为文生图，同时留下图生图式的来源记录。[参考读取 (line 832)]\(/D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.ts:832)、[请求构造 (line 433)]\(/D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.ts:433)。

   这不只是测试遗漏：现有测试明确接受“空图片数组＋保留参考 ID”的行为。[相关测试 (line 562)]\(/D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.test.ts:562)。

   **必须把计划参考与实际发送参考分开记录。** 对用户指定的身份来源，读取失败应阻止该项执行；可选参考若降级，也必须让 Agent 和记录知道。不能用完整的意图记录代替真实输入证据。
3. **[Correctness，高优先级] 方向级偏好会通过 Memory 投影泄漏到其他方向。**

   我为方向 A 写入有真实用户消息来源的偏好“以后这个方向都保持暖灰色”，再编译方向 B 的预览，得到：
   | 检查位置是否出现 A 的偏好                                                                                                                                                                                                                                   |   |
   | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | - |
   | 经过作用域过滤的阶段条目                                                                                                                                                                                                                                     | 否 |
   | Context 的 Memory Views                                                                                                                                                                                                                           | 是 |
   | Agent 默认记忆                                                                                                                                                                                                                                       | 是 |
   | B 的最终 Provider Prompt                                                                                                                                                                                                                            | 是 |
   | 一个明确原因是 Memory View 使用新生成的 revision/section/item ID，过滤时却拿它查原始 continuity entry ID，查不到就放行。[投影 ID (line 495)]\(/D:/Morpho/src/domain/morpho/projectContinuity.ts:495)、[过滤逻辑 (line 1387)]\(/D:/Morpho/src/domain/morpho/projectContinuity.ts:1387)。 |   |
   此外，Compiler 会展开整个 `userPreferences` 文档，而不会按目标方向或图片过滤。[Compiler (line 75)]\(/D:/Morpho/src/domain/operations/imagePromptCompiler.ts:75)。

   **这是隐藏全局偏置的实际来源。** 需要让每条投影保留可过滤的来源与作用域，并让 Agent Context 和 ImagePromptCompiler 使用同一套过滤结果。
4. **[Correctness＋架构] 参考、直接父版本和身份继承被混用了。**

   当前结果对象用 `sourceObjectIds[0]` 推断来源方向和分支；仅在来源图片恰好一张时建立 `version` 关系。[生成对象逻辑 (line 36)]\(/D:/Morpho/src/domain/morpho/generation.ts:36)。

   已复现两种后果：
   - 从子图继续发展，Resolver 自动补入父图，来源变成两张；新图只有两条 `source`，没有直接 `version`。
   - 选中主图，再显式指定同方向另一分支的细节图作参考；细节图排第一，新图继承细节分支。
     Resolver 的 `directParent` 还会读取上一轮的全部 `generation.referenceObjectIds`，其中可能包含材质、环境或风格参考，不能都解释成身份父图。[父图解析 (line 100)]\(/D:/Morpho/src/domain/operations/visualReferenceResolver.ts:100)。
   这个混用也影响 visual review：方向预览被强制标为 `conceptImage`，而默认参考复核逻辑把该角色视为直接延展素材。复现中，借入 A 默认图的 B 方向预览会被列入 A 默认参考替换后的待复核范围。[复核目标 (line 1037)]\(/D:/Morpho/src/domain/morpho/workspace.ts:1037)。

   **需要独立表达“从哪张方案继续”“借用了哪些参考”“归属哪个方向/分支”。** 图片数组顺序和参考数量不应决定这些业务关系。
5. **[架构，高优先级] 生成后的实际图像没有返回本轮 Agent 判断。**

   `generate_visuals` 返回对象 ID、失败项和批次状态，没有返回结果像素或视觉观察。[工具结果 (line 579)]\(/D:/Morpho/src/features/workspace/agentToolExecutors.ts:579)。`read_selected_context` 读取本轮预先准备的 Context，也不是一个可以检查新结果的看图工具。

   下一轮历史主要重建为文本；历史中提到某张图，不等于重新发送了它的像素。[历史构造 (line 380)]\(/D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:380)。

   因而当前可以可靠声称“生成并保存了结果”，不能据此声称：
   - 产品身份和比例已经保住；
   - 指定部件确实改对；
   - 四个方案形成了有效差异；
   - CMF 变化没有带来几何漂移。
     另一个重要细节：新图的 `summary` 直接来自生成计划的 `purpose`，它是**预期目的**，并非对实际结果的描述。[结果提交 (line 652)]\(/D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.ts:652)。这个 summary 后续会进入 Context 和 Delivery 快照，需要避免被解释为观察事实。
   **缺少的是结果观察通路和证据状态，而不是必然缺少一个独立 Critic。** 可以允许同一 Agent 在用户要求检查、比较或继续修改时，读取结果图，再给出带来源的判断。
6. **[架构] 多参考图有来源优先级，却没有足够明确的设计角色契约。**

   `VisualReferenceReason` 描述“为何被加入”，`ImageRole` 描述“图片是什么用途”；二者都不能表达：
   > 图 A 保留产品身份与比例；图 B 只借用 CMF；图 C 只提供使用场景；不要继承 B 的几何。
   > 当前 `preserve/changeGoals/allowToChange` 是整项字符串数组，没有逐参考绑定。Compiler 最终主要输出参考标题列表，Provider 收到的是 `images[]`，没有相应的逐图属性继承说明。[意图类型 (line 196)]\(/D:/Morpho/src/domain/operations/types.ts:196)、[编译结果 (line 76)]\(/D:/Morpho/src/domain/operations/imagePromptCompiler.ts:76)。
   已有 `referenceInterpretation` Method Pack 明确要求区分结构、比例、CMF、氛围，专业判断方向是对的；但结果只能松散地写入自然语言，尚未形成后续各层一致执行的契约。[Method Packs (line 97)]\(/D:/Morpho/src/shared/designMethodPack.ts:97)。

   建议增加**任务内的参考角色**，由 Agent 从自然语言中解释，并绑定到明确图片；无需要求用户永久分类每张素材，也无需引入完整工业设计本体。

**这些问题对不同视觉任务的影响并不相同。**

| 任务已有值得保留的能力当前主要限制 |                             |                                    |
| ----------------- | --------------------------- | ---------------------------------- |
| 概念发散／方向预览         | 强调架构、机制、比例差异；结构化批次          | 默认图和项目参考可能把发散拉回同一产品；没有结果差异验证       |
| 继续发展／定向修改         | 保留与变化分开，新图不覆盖旧图             | 身份来源不独立；没有 mask，也没有实际保留情况验证        |
| CMF               | 明确保持几何、部件位置，研究材料与表面         | 不能结构化指定“几何取 A、CMF 取 B”；几何保持率需 Eval |
| 场景                | 强调尺度、动作和人与产品的关系             | 产品身份与环境参考未解耦；人体关系是否成立需看结果          |
| 角度／细节             | 有 viewpoint、构图和 detailStudy | 缺少跨视角身份验证；近景变化和产品结构变化未明确分离         |
| 结构／交互示意           | 有对应 ImageRole 和表达规则         | 结构与交互共用较泛化的设计示意策略；不能据生成图证明工程可行性    |

`preserve/change/allow-to-change` 目前是有用的意图表达，但不是约束满足证明。规则之间是否矛盾、模型能否正确执行、不同模型适配语句是否有效，需要分别判断；不能把“字段齐全”和“Prompt 包含关键词”的测试当成视觉能力通过。
**看图、Compare、长期事实和 Delivery，还需要保留几条区别。**

- **多图覆盖不等于多图细节可见。** 当前超过 3 张就转总览图，每张单元最大 320 像素；四张图的细节比较也会进入这种表示。适合看总体方向，是否足以判断接缝、纹理、细部比例，需要实际 Eval。应支持按需再看单图，而非默认提高所有输入成本。[图片打包 (line 45)]\(/D:/Morpho/src/features/workspace/aiAttachments.ts:45)。
- **Compare 的确定性边界较好。** 保存的比较必须覆盖明确选择对象，没有实际附件时不能声明像素证据；比较推荐不自动改主方向或默认参考。纯图片证据也不能直接通过该工具生成文本证据型关键结论。这些约束应保留，但“附件已发送”仍不能证明模型评价正确。[Compare 校验 (line 192)]\(/D:/Morpho/src/domain/morpho/comparisonAnalysis.ts:192)。
- **当前 visual review 是关系事件标记。** 它表示默认参考替换后需要用户复核，不能解释为已进行视觉质量审查。它与未来可能增加的结果观察应分别建模。
- **Memory 没有必要收录每张图的完整视觉描述。** 当前把生成完成数量、关系和用户决定写入连续性记录是合理的。值得补充的是被用户认可、确实会影响下一轮的观察和反馈，并区分观察、推断与决定；同时先修复上述作用域泄漏。
- **Delivery 的快照稳定性应保留。** 上游新图不会静默替换已有引用，显式刷新和导出资产诊断都合理。但章节草稿路径明确不收集图片附件，目前主要依据稳定快照文字与已有图注；因此它能整理叙事，不能被当成对最终图像的视觉核验。[草稿输入 (line 256)]\(/D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:256)、[交付 Context (line 108)]\(/D:/Morpho/src/features/workspace/deliveryPreparationUi.ts:108)。

**职责上，我建议保留现有分层，修正几个关键契约，而不是重建整个视觉系统。**

| 应由 Agent 判断应由确定性领域逻辑保证 |                         |
| ---------------------- | ----------------------- |
| 用户要继承哪些设计维度            | 哪些图片实际获得授权、哪些被排除        |
| 每张参考承担什么设计角色           | 图片 ID、资产、发送顺序和真实像素的一一对应 |
| 结果有哪些可见偏差、设计弱点         | 观察必须绑定实际看过的结果及表示方式      |
| 下一轮改变什么、为何改变           | 身份父图、方向、分支、版本和参考关系分别维护  |
| 推荐方案及其取舍               | 推荐不能自动升级为主方向、默认参考或稳定事实  |
| 哪些信息值得长期保留             | 来源、作用域、有效性和交付快照稳定性      |

最小而有价值的优化顺序是：**先修参考范围与实际输入记录，再拆开身份继承和辅助参考，最后补按需结果回读。** 生成记录应能区分“想生成什么、实际发送什么、得到什么、看过什么、用户决定什么”。已有 Prompt、意图和 Operation 可以继续使用，不必新增庞大的流程系统。
**自动化与成本方面，应该克制，但有一处具体风险要处理。**
现有用户授权、逐项执行、并发控制、失败隔离、取消和 A+ 恢复机制都有价值。还应注意：底层 Provider 在网络异常时会重试生成 POST，而请求体未传递本地 `clientRequestId`。离线模拟响应丢失后，观察到两次相同 POST。[Provider 重试 (line 150)]\(/D:/Morpho/src/server/image/grsProvider.ts:150)。
这证明存在重复提交路径；**是否实际重复生成或计费，仍取决于 Provider，未实测。** 本地恢复去重不能替代 Provider 层幂等保证。
对 Morpho 有价值的自动化是：输入完整性检查、明确遗漏报告、按需看图、针对用户目标比较偏差，以及把用户认可的反馈带入下一轮。默认自动选优、自动换默认参考、无限反思重生成，都会扩大成本和决定范围，目前没有证据支持引入。
真正值得做的模型 Eval，应集中在五项：多轮身份保持、几何与 CMF 参考分离、场景中的尺度和人体关系、总览图与单图的判断差异、以及 Agent 对“未看见／不能确定”的表述准确性。**先修确定性错误，再比较这些能力，才能判断增加一次视觉回读究竟带来了多少收益。**
本轮验证完成的是代码链路、领域行为及离线复现；没有进行真实出图、视觉质量评分或浏览器端交互验收。