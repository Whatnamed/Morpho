**整体判断：Morpho 已有较好的资料管理、研究产物和用户决策骨架，但目前还不能称为可靠的“证据驱动设计研究”系统。**

主要断点不在“能否搜索”，而在于：**实际读到的内容不足且覆盖范围不透明；引用与具体判断绑定不稳；候选分析进入结论、下游 Context 和记忆时，证据状态会丢失；来源变化后的复核没有贯穿整条链路。**

审计基于当前 HEAD `2e801ed`，以正式面板的 A+ Agent 路径为主，交叉检查领域模型、UI、Operation、Continuity、Memory 和测试。以下“已确认”包含代码路径确认和离线复现，不代表已测量真实模型出错频率。本轮未修改任何文件。

当前链路的实际能力如下：

|环节|已有能力|当前主要限制|
|---|---|---|
|资料进入|原文件、链接、解析资产、画布对象分离|链接主要是入口，不是已获取正文的来源|
|文档理解|TXT/MD、文本 PDF、PPTX 提取；Reader 搜索与定位|缺少结构化页段映射、图表理解和 Agent 补读|
|外部研究|搜索、多查询、网页短摘录、失败与超时统计|搜索发现与正文深读耦合；不能指定 URL 继续读取|
|Research Analysis|findings、opportunities、constraints、openQuestions、evidence|分类与证据之间没有稳定逐项关联|
|Key Conclusion|用户操作、分类、状态、DecisionRecord|“用户保留”与“来源证实”仍有混淆路径|
|下游设计|Definition/Direction revision、来源关系、视觉 Prompt 编译|传入模型的研究材料会丢失类别、置信状态和证据绑定|
|长期连续性|确定性 Memory、Stage Records、原始聊天搜索|来源有效性和复核状态没有完整传递到最终 Context|

下面是已经确认的 correctness 问题。P1 表示会直接影响研究依据或项目判断；P2 表示定位、覆盖或产品表达错误。

1. **P1：正式 Agent 对文档存在未准确披露的二次截断，没有补读能力。**
    
    文档收集器允许每份最多 8,000 字符、总计 24,000 字符；但正式 A+ 请求再次执行 `extract.text.slice(0, 2_200)`，只发送标题、对象 ID 和文本，没有把对应的覆盖范围、总长度、截断状态一起交给模型。
    
    离线复现：
    
    - 4,000 字符文档：收集器返回 `truncated=false`、无 warning；正式拼接只保留 2,200 字符。
    - 四份各 8,000 字符文档：只收集前三份，第四份没有进入 `skipped`，也没有 warning。
    - `read_selected_context` 没有 offset、query、page 或 continuation 参数，不能恢复遗漏正文。
    
    这会让“选中了四份资料”“资料已纳入”和“模型实际读过哪些内容”不一致。限制长度本身合理，**静默丢弃覆盖信息才是错误**。
    
    证据：[A+ 文档输入 (line 289)](/D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:289)、[文档收集预算 (line 28)](/D:/Morpho/src/features/workspace/documentContext.ts:28)。
    
2. **P1：Document Fragment 的完整正文与来源状态在正式 Agent 读取接口丢失。**
    
    领域层允许保存最多 6,000 字符的片段；`TaskContext` 也构造了完整片段正文、字符范围和 `sourceAvailability`。但是正式 `read_selected_context` 返回的是对象摘要和 `detail`，其中片段正文只有前 800 字符，没有返回那份完整片段结构。
    
    离线放置在第 1,000 字符后的证据标记：
    
    - 在 `documentFragmentExtracts` 中存在；
    - 在 Agent 读取工具结果中不存在；
    - `sourceAvailability` 也不在该结果中。
    
    因此，**人工提取片段并不能可靠绕过全文截断**，而且 Agent 不能完整辨认片段原文是否已变化或缺失。
    
    证据：[片段 Context (line 580)](/D:/Morpho/src/features/workspace/taskContext.ts:580)、[摘要裁剪 (line 683)](/D:/Morpho/src/features/workspace/taskContext.ts:683)、[实际工具返回 (line 4)](/D:/Morpho/src/features/workspace/agentReadContextResult.ts:4)。
    
3. **P1：来源被全部过滤后，证据仍可保持 `supported`。**
    
    `constrainResearchEvidence` 和 Proposal 入库逻辑只过滤不合法的对象 ID、citation URL，原样保留模型提供的 `confidence`。
    
    离线构造一个只有非法来源、但声明 `supported` 的 claim，最终保存为：
    
    ```
    {
      "claim": "claim A",
      "sourceObjectIds": [],
      "citationIds": [],
      "confidence": "supported"
    }
    ```
    
    这是确定性错误，无须真实模型才能判断。即使来源 ID 合法，目前也只证明“来源在允许集合里”，没有证明模型读过支持该 claim 的段落。
    
    证据：[来源过滤 (line 30)](/D:/Morpho/src/features/workspace/researchExtraction.ts:30)、[Evidence 入库 (line 908)](/D:/Morpho/src/domain/operations/operations.ts:908)。
    
4. **P1：从研究条目保留 Key Conclusion，会丢失逐项证据状态并继承无关引用。**
    
    从 `finding/opportunity/constraint` 提取结论时，当前逻辑：
    
    - 来源指向整张研究卡；
    - 复制整张研究卡的全部 citation；
    - 将 confidence 固定设为 `partial`，state 设为 `active`；
    - 不关联该条目实际对应的 evidence。
    
    离线案例中，`claim A` 对应的 evidence 明确为 `needsVerification`，研究卡还有另一条 claim 的 citation。保留 finding 后，结论变成 `active/partial`，同时带上两条 citation。
    
    用户点击“保留”授权了项目决策，**并没有证实 claim，也没有授权系统改变其证据状态**。这条路径会同时产生引用范围扩大和不确定性弱化。
    
    证据：[研究条目提升逻辑 (line 1406)](/D:/Morpho/src/domain/morpho/workspace.ts:1406)。
    
5. **P1：下游读取把研究类别、结论状态和证据绑定压平成文字。**
    
    `ResearchObject` 的四类条目被直接拼接，最多取前八条；Key Conclusion 的 detail 只带 category 和 body，不带 state、confidence、citation 或来源复核状态。
    
    离线读取得到：
    
    ```
    claim A / hypothesis B / UNVERIFIED_QUESTION
    ```
    
    原来的“发现／机会／待验证问题”边界已经消失。四个数组按固定顺序拼接，也意味着前面的 findings 足够多时，后面的约束和问题可能完全不出现。
    
    这不是断言模型一定会误读，而是确认：**系统要求模型区分的语义，没有完整交给模型**。仅加强 Prompt 无法修复这个数据损失。
    
    证据：[实际语义摘要 (line 669)](/D:/Morpho/src/features/workspace/taskContext.ts:669)。
    
6. **P1：来源变化检查不覆盖重要来源类型，也没有传递到下游结论。**
    
    存在两层问题：
    
    - Proposal 的 fingerprint 对 `file`、`link`、`documentFragment` 落入默认分支，只包含对象类型。离线更换文件 extract ID、把解析状态改为失败，`detectResearchSourceChanges` 仍返回没有变化。
    - 删除原始资料后，依赖该资料的 Research 记录能成为 `sourceUnavailable`，但经研究卡保留的 Key Conclusion 仍为 `active`，其 Continuity 和 DecisionRecord 仍为 `current`，继续进入“当前项目决定”。
    
    后者已按 `file → research → keyConclusion` 完整复现。当前检查主要处理直接引用，缺少跨层的依据复核。
    
    不应因此自动删除结论或推翻设计定义；应保留历史决定，同时明确标记“依据发生变化，需要复核”。
    
    证据：[来源 fingerprint (line 2593)](/D:/Morpho/src/domain/operations/operations.ts:2593)、[Continuity 失效判断 (line 1165)](/D:/Morpho/src/domain/morpho/projectContinuity.ts:1165)、[结论决定分类 (line 107)](/D:/Morpho/src/domain/morpho/decisionRecords.ts:107)。
    
7. **P1：Stage Records／Memory 到最终 Prompt 的投影，会丢失隐藏和待复核边界。**
    
    离线隐藏已保留结论后：
    
    - research Stage Record 仍包含“已保留关键结论「claim」”；
    - `reviewRequired=false`；
    - 默认 Context 保留该句，却过滤掉被隐藏对象的 source ref。
    
    此外，`renderMemoryContext` 只输出 section 文本，本来存在于默认 Memory 数据中的 `reviewRequired` 等状态也没有随正文渲染。
    
    保留历史事件是合理的，但把它无状态地送回当前工作语境，会使“以前保留过”与“现在仍可作为依据”难以区分。
    
    证据：[阶段记录生成 (line 778)](/D:/Morpho/src/domain/morpho/projectMemory.ts:778)、[只过滤来源、不处理对应文字 (line 476)](/D:/Morpho/src/domain/morpho/projectMemory.ts:476)、[最终 Memory 渲染 (line 517)](/D:/Morpho/src/features/workspace/providerContextFrames.ts:517)。
    

另外确认了以下 P2 问题：

|问题|实际行为与影响|
|---|---|
|多查询结果偏向第一个查询|两个查询各返回五个结果的离线案例，最终五个来源全部来自第一个查询；第二个查询虽然执行，结果没有参与输出。影响多角度和冲突资料覆盖。[实现 (line 49)](/D:/Morpho/src/server/ai/webSearch.ts:49)|
|PPTX 页序可能错误|按 `slideN.xml` 文件编号排序，没有读取 presentation 中的实际顺序。合成重排案例把实际第二张标成“第 1 页”，损害引用定位。[实现 (line 200)](/D:/Morpho/src/domain/morpho/documentParsing.ts:200)|
|TXT/MD 的解析截断标志缺失|130,000 字符文本被截到 120,000，正文有“已截断”，但 `truncated` 字段未设置；PPTX 同样没有返回该字段。[实现 (line 97)](/D:/Morpho/src/domain/morpho/documentParsing.ts:97)|
|通用追溯链到 Fragment 后断开|Fragment 的来源关系方向是 fragment → file，而通用追溯读取入边且没有对应特判。离线 `keyConclusion → fragment` 能到达，不能继续到 file；专用“回到原文”仍可工作。[关系 (line 273)](/D:/Morpho/src/features/workspace/documentFragments.ts:273)、[追溯 (line 113)](/D:/Morpho/src/domain/morpho/designTrace.ts:113)|
|“AI 代选”名实不符且直接形成决定|实际按四类顺序轮流取前六条，不使用模型、不评估证据；随后直接创建 Key Conclusion。研究详情又将这一操作称为“更新画布摘录”，弱化了长期决定的含义。[选择算法 (line 89)](/D:/Morpho/src/features/workspace/researchExtraction.ts:89)、[写入路径 (line 1704)](/D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1704)|

从架构和产品能力看，以下缺口比增加一个搜索供应商更值得优先处理。

**首先，需要把“找到来源”“读到内容”“内容支持判断”分成三个可追溯的事实。**

当前 `ResearchEvidence` 只有 claim、对象 ID、citation ID 和 confidence；缺少明确的支持文本、位置、来源版本、适用条件，以及该来源是支持、反驳还是仅提供背景。findings 等研究条目本身又没有稳定 ID，无法可靠关联 Evidence。

`citationSnapshot` 主要保存标题、URL、snippet 和时间；搜索结果转 citation 时还优先保存搜索 snippet，而非抓取 excerpt。Provider 的引用归一化也没有保留 claim span。这些结构能证明来源身份和检索痕迹，不能单独证明某条判断得到了支持。[Evidence 类型 (line 61)](/D:/Morpho/src/domain/operations/types.ts:61)、[搜索引用转换 (line 142)](/D:/Morpho/src/features/workspace/agentTurnLimits.ts:142)、[Provider 引用归一化 (line 641)](/D:/Morpho/src/server/ai/openaiCompatibleProvider.ts:641)。

建议最小增强为：

- 给研究判断稳定 ID，保留 `observation / reportedFact / inference / hypothesis / designImplication` 等语义；
- 每条判断绑定具体 evidence passage，而不是只绑整份文件或网页；
- passage 保存来源版本、原文摘录、位置和实际读取覆盖；
- 将“项目已采用”“证据支持程度”“当前是否需复核”分开表达。

不必让用户填写复杂证据表，也不必把所有创意机会都强制绑定外部 citation。设计推断可以存在，但应能看出它基于什么、跨出了哪一步。

**其次，读取能力应从“固定前缀”变成“有边界的按需定位和补读”。**

目前实际读取量是：

|来源|当前读取边界|
|---|---|
|PDF|最多前 200 页、120,000 字符；仅文本提取，不含 OCR|
|TXT/MD/PPTX|保存有界文本 extract；不是完整结构化文档理解|
|Document Reader|用户可查看保存下来的 extract、搜索并定位文本块|
|正式 Agent 的文件输入|每份最终最多 2,200 字符，且先受总计 24,000 的收集预算限制|
|正式 Agent 的 Fragment 读取|detail 中前 800 字符|
|网页|Jina 返回内容的前 18 个非空行，再截到 1,200 字符；没有显式截断标志|
|项目搜索|对象内容、元数据、片段正文等；不搜索独立存储的完整文档 extract|
|Agent 历史检索|可搜索原始聊天、读取 Memory/Stage；没有项目资料全文发现与补读工具|

网页获取还把原始 HTTPS URL 改写为 HTTP 形式交给 Jina；成功响应也不意味着这 1,200 字符已经包含目标正文。[网页提取 (line 164)](/D:/Morpho/src/server/ai/webSearch.ts:164)。

优先值得补的是：

- 当前项目资料目录与关键词定位；
- `read_source` 式有界区间读取，返回 offsets、覆盖范围和 continuation；
- 对已知 URL 的直接读取，允许继续读取同一来源；
- 文档页／slide／section 到 extract 的映射；
- 按实际用户资料需求增加 DOCX、表格或按页视觉读取，而非立即建设完整文档平台。

Document Fragment 应继续作为用户固定证据的方式；Agent 临时读一个段落不需要自动创建画布 Fragment。

**第三，Research Analysis 的分类需要贯穿数据和交互，不能主要依靠 Prompt。**

现有 `researchSynthesis` Method Pack 已明确要求区分事实、推断、假设、机会，暴露冲突，这是正确的。但 schema 无法明确表达冲突关系、适用范围和推断依据，UI 也没有让每个研究点直接查看其支持与反例。[Method Pack (line 62)](/D:/Morpho/src/shared/designMethodPack.ts:62)。

应允许研究结果表达：

- 来源 A 与 B 的结论不同，差异可能来自人群、场景、日期或测量条件；
- 现有材料只支持局部判断；
- 某项是值得试验的设计机会，而非已经验证的需求；
- 信息不足，应停止确定性表述，并给出最有价值的补证问题。

是否真的做好这些，需要模型评估；但承载这些信息的数据契约可以先确定性补齐。

**第四，Key Conclusion 应表示“项目保留的判断”，不能隐含“已证实事实”。**

现在已经支持 finding、opportunity、constraint、openQuestion，这个方向应保留。机会和开放问题成为长期项目记录完全合理。

需要重新梳理的是确认动作：用户到底在确认“保留这个问题”“采用这个设计约束”，还是“事实已经验证”。尤其“画布摘录”和“AI 代选”当前承担了创建 DecisionRecord 的作用，产品文案与实际 authority 不一致。

同样，不必强制 Research 必须先变成 Key Conclusion 才能起草 Design Definition。直接从资料或候选研究生成待确认 Brief 是合理的；但提案应保留哪些是已确认约束、哪些是假设，以及对应来源。

**第五，来源生命周期应作用于依据状态，不应自动改写用户决定。**

建议明确区分：

|变化|合理处理|
|---|---|
|来源隐藏|保留历史和已固定摘录；退出默认读取，明确标记可见性|
|原文件删除／Blob 缺失|保留已保存证据，标记原文无法重新打开|
|来源内容更新|新旧版本分离，原证据仍绑定旧版本；相关判断提示复核|
|网页不可访问|表示当前无法重取，不等于历史判断必然错误|
|出现反例或原文撤回|标记判断存在冲突，交由用户决定是否调整已采用内容|

对 Definition、Direction、Visual 的传播应是“这项设计判断依赖的依据需要复核”，不是自动改写 Brief、重生成图像或撤销历史决定。

**第六，Memory 应保留判断资格，Visual 应消费设计决定。**

当前来源驱动、确定性生成 Memory 的方向是对的；主要问题是投影过程丢失了状态以及逐项来源关系。研究摘要不能因为进入阶段记录，就获得更高事实权威。

视觉编译链读取 Design Brief、方向修订、偏好和结构化视觉意图，这个职责划分也应保留。[视觉编译器 (line 21)](/D:/Morpho/src/domain/operations/imagePromptCompiler.ts:21)。Research 应帮助形成设计判断；生成图应帮助表达、探索和比较这些判断。图像看起来可行，不应反过来证明人体工学、材料性能或真实使用需求已经成立。

以下现有设计值得保留，不需要推倒：

- 原始资产、extract、Fragment、Research、Key Conclusion、revision、DecisionRecord 分离。
- Research 自动落为候选分析；关键项目状态有独立的用户操作边界。
- Fragment 固定正文并记录 extract ID、offset、block ID；来源变更后不静默替换片段。
- Reader 本地读取与 AI 读取授权分离。
- 来源内容是 untrusted evidence，不能自行扩大联网、写入和记忆权限。
- 搜索的超时、响应大小限制、部分失败保留，以及外部操作重放机制。
- 原始聊天、压缩摘要、Memory、Stage Records 分层；历史问题要求真实读取。
- 设计定义和方向的 revision，以及稳定的交付引用快照。
- 单一连续 Agent，而不是按阶段拆多个彼此重复记忆的 Agent。

**目前没有证据表明必须引入向量数据库、通用 RAG、自动爬虫或独立 Research Agent。** 它们都不能直接修复上述来源绑定、截断披露、状态丢失和确认问题。先接通项目关键词检索、定点读取、证据片段和复核状态，才能判断后续是否确实存在语义召回或复杂网页访问瓶颈。

确定性工程与真实 Research Eval 的边界如下：

|可以通过确定性工程证明|必须通过真实模型／Research Eval 判断|
|---|---|
|实际发送内容与覆盖清单一致，无静默遗漏|模型是否主动发现缺证并正确补读|
|无来源的 claim 不能保持 `supported`|有来源时，原文是否真的支持该 claim|
|结论只继承对应证据和原有不确定性|推断跨度是否合理、是否夸大来源|
|来源变更、隐藏、缺失正确传播为状态|面对相互冲突的材料是否保留冲突|
|分类、confidence、review 状态到最终 Prompt 不丢失|是否把观察转成具体且有价值的设计机会|
|PPTX 顺序、Fragment 定位、引用链正确|工业设计变量、使用情境和约束是否理解准确|
|用户确认与 Memory 写入边界不越权|长对话后是否仍区分用户决定与 AI 建议|

仓库已有 [AI Capability Eval Corpus (line 1)](/D:/Morpho/docs/architecture/ai-capability-eval-corpus.md:1)，但它主要是定性验收案例和确定性层覆盖，不能当成研究质量已通过的证据。

建议 Research Eval 使用固定材料先隔离模型行为，再单独评估实时网络：把关键证据放在长文后部；提供只相关但不支持 claim 的来源；加入不同日期、样本和条件的冲突资料；让来源随后变更或缺失；最后检查这些判断如何进入 Brief、Direction 和后续视觉任务。重点衡量 claim 级引用正确性、关键证据遗漏、不当确定性和下游沿用是否正确，而不是报告长度与引用数量。

本轮验证执行了相关 `npm.cmd test -- …`：**20 个测试文件、230 项测试全部通过**；另通过两组 `node --input-type=module` 内存脚本复现上述读取、证据、来源变化、记忆投影、网页截取和定位问题。现有测试通过与这些问题存在并不矛盾，主要缺的是跨层契约覆盖。

未调用真实模型或实时搜索服务，未进行浏览器人工验收，因此没有把模型研究质量、在线搜索成功率或真实复杂文档解析质量宣称为已验证。结束时 `git status --short` 和 `git diff --stat` 均为空。