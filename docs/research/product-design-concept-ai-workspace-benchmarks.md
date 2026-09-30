# 产品设计概念阶段 AI 辅助设计工作台竞品调研报告

## 总览结论

这轮调研后的核心判断是：与你想做的“产品设计 / 工业设计概念阶段 AI 工作台”最相关的市场，已经不是单一的“AI 生图工具市场”，而是至少可以分成六类相互邻接但尚未打通的产品簇：一类是 **AI 设计 Agent / 生成式画布**，把 prompt、参考图、生成、编辑、导出放进一个工作台里，代表产品有 Lovart、Adobe Firefly Boards、Krea、Recraft，以及更 workflow-first 的 FLORA；一类是 **工业设计概念可视化工具**，更强调 sketch-to-render、3D form exploration、材质和视角迭代，代表是 Vizcom 与 Gravity Sketch；一类是 **设计工具内嵌 AI**，如 Figma AI / Figma Make、Canva AI、Miro AI，它们把 AI 放进原有设计或协作系统；一类是 **通用图像模型**，如 Midjourney、ChatGPT Image、Gemini Image，本质仍是模型入口而不是完整设计工作台；一类是 **节点式 / 可编排工作流**，以 ComfyUI 为代表；最后一类是 **moodboard / 灵感采集 / 资料管理**，如 Milanote、Cosmos、Pinterest。它们各自强，但覆盖的是不同阶段。citeturn16view0turn17view0turn33view0turn32view0turn29search0turn9view4turn22view0turn10view0turn20search3turn9view2turn35view3turn10view6turn9view6turn9view7turn39view0

如果只看“AI + Canvas”，现在已经有相当清晰的一波产品在做：Lovart 把 Agent、技能流、无限画布和导出打包；Firefly Boards 把 moodboard、参考图、Adobe Stock、Remix、评论协作放在一个 ideation 画布里；Krea 把实时生成做成左右分屏的 live canvas；Recraft 把无限画布、prompt、vector/mockup/natural language edit 放进“Figma-like” 设计台；Vizcom 则用 Workbench 把多图、多 prompt、多视角生成组织成工业设计探索空间；FLORA 则把文本、图像、视频变成可连接的创意 blocks。换句话说，“AI 不是一个弹窗，而是一个工作台”已经成为明显趋势。citeturn16view0turn17view0turn17view2turn34search0turn32view0turn24view0turn29search0turn29search3

但这些工具的偏向非常不同。Lovart、Krea、Recraft、Midjourney、ChatGPT Image、Gemini Image 更偏 **视觉生成与编辑**；Miro AI 更偏 **团队白板、研究整理、流程推进**；Figma AI / Make 更偏 **UI 设计、原型与设计系统上下文**；Vizcom 与 Gravity Sketch 更偏 **工业设计概念图、3D 形态与 form iteration**；Milanote、Cosmos、Pinterest 更偏 **灵感库 / moodboard**。这意味着它们虽然都在某种意义上服务“创意流程”，但真正占据的流程位置并不一样。citeturn9view2turn40view3turn40view0turn9view3turn9view4turn21view0turn22view0turn35view3turn35view0turn35view2turn9view6turn9view7turn39view0

最关键的结论是：**目前我没有看到一个真正强覆盖“产品设计 / 工业设计概念阶段全流程”的平台。** 最接近的是若干“半链路平台”：Lovart 接近“从 brief 到视觉资产与 deck 导出”的创意生产链，但更偏品牌、营销、内容资产，而不是产品设计前期研究与概念推导；Firefly Boards 很强于灵感整合、方向探索与协作，但缺少面向工业设计的专业语义与项目脉络；Vizcom 很强于 sketch/render/modify/3D，但前期调研、洞察、方案比较、展示材料组织仍需外部工具补足；Miro 在研究和协作上很强，却不擅长高质量概念视觉；Canva 擅长把内容整理成 presentation，但不是概念设计引擎。这个缺口本身，就是你产品成立空间的最强证据之一。这里的判断属于基于多产品能力边界的综合推断。citeturn16view0turn37search4turn17view0turn17view1turn24view0turn25search1turn25search11turn9view2turn20search3turn20search8

因此，你的最佳切入点不应是“再做一个会生图的画布”，也不应只是“再做一个 AI Agent”。更可行的切法是：把 **前期调研 → 洞察整理 → 概念方向 → Prompt 共创 → 图像 / 草图迭代 → 方案比较 → 展板 / PPT 素材收束** 变成同一项目空间中的连续链路，并给它一个 **产品设计 / 工业设计专属语境**。也就是说，真正的机会不是替代 Midjourney 或 Figma，而是做这些工具之间缺失的“概念阶段操作系统”。citeturn36search1turn36search2turn14search0turn23search10turn9view2turn9view4turn16view0turn17view0

## 代表产品总表

说明：下表以官方页面 / 文档为主，辅以社区与媒体评价；“相关性”与“参考价值”是基于本次调研的产品判断，不是厂商官方表述。

| 产品名称 | 产品类型 | 产品定位 | 核心用户 | 主要使用场景 | 核心流程概括 | 是否有画布 | 是否有 AI 对话 / Agent | 是否支持图像生成 | 是否适合产品设计 / 工业设计 | 与你的平台相关性 | 主要参考价值 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lovart citeturn16view0turn31view1turn31view0 | AI 设计 Agent / 生成式画布 | 端到端创意设计代理 | 设计师、营销团队、内容团队 | 品牌视觉、广告、slides、视频 | Prompt/Brand Kit/参考 → Agent 路由模型 → 画布编辑 → 导出 | 有 | 强 | 有 | 中 | 高 | “聊天 + 技能流 + 画布 + 导出”一体化框架 |
| Adobe Firefly Boards citeturn9view0turn17view0turn17view1turn17view2 | AI ideation canvas | 早期方向探索、moodboard、storyboard | 创意团队、广告、品牌、内容 | 灵感整合、方向比稿、评论协作 | 上传/Stock/Prompt → 上板 → Remix → 评论协作 → 进入后续制作 | 有 | 弱 | 有 | 中 | 高 | 早期视觉方向与协作框架最成熟之一 |
| Visual Electric citeturn13search7turn13search1turn28search7turn13search10 | 设计师导向 AI 画布 | 为 creatives 做的图像生成器 | 视觉设计师、品牌设计师 | 风格探索、found imagery、storyboard | 进入 workspace → Prompt/参考 → 出图 → 在画布组织 → 继续细化 | 有 | 弱 | 有 | 中低 | 中高 | “为设计师而非为模型” 的界面取向 |
| Krea citeturn33view0turn34search0turn27search3 | AI 创意套件 / Realtime canvas | 实时生成与快速视觉迭代 | 创作者、设计师、品牌内容团队 | 视觉探索、实时草图映射、增强 | 进入 Realtime / Image / Edit → 实时修改 → 增强/训练 → 输出 | 有 | 弱 | 有 | 中 | 高 | 实时生成交互与多模型集成 |
| Recraft citeturn32view0turn11view2turn26search2 | all-in-one AI design platform | 图像、矢量、mockup 一体设计台 | 平面设计、品牌、电商设计 | logo/icon/mockup/poster/批量视觉 | 项目 → 无限画布 → 生成/Vectorize/Mockup/Edit → 导出 | 有 | 中 | 有 | 中 | 高 | “Figma 感” 画布 + AI 图像/矢量工具整合 |
| Vizcom citeturn24view0turn24view1turn25search1turn25search11turn23search10 | 工业设计概念可视化 | sketch-to-render-to-3D | 工业设计师、鞋类、汽车、产品团队 | 草图渲染、视角变体、CMF、3D 预览 | Sketch/导入 → Render/Refine → Modify → 2D to 3D/Animate | 有 | 弱 | 有 | 很高 | 很高 | 工业设计概念视觉工作流的标杆 |
| Gravity Sketch citeturn22view0turn21view0turn9view5 | 沉浸式 3D 概念设计 | VR / Screen 3D ideation studio | 工业设计师、交通工具、硬件团队 | 3D form exploration、人体工学、评审 | 参考图/情境 → 3D 草绘 → CAD 互转 → 截图/评审 | 有 | 无 | 原生弱 | 很高 | 高 | 3D 形态与人体工学前置能力 |
| Midjourney / ChatGPT Image / Gemini Image citeturn35view3turn35view4turn35view5turn35view0turn35view2turn36search2turn14search0 | 通用图像生成工具 | 模型入口而非工作台 | 广泛创作者与设计师 | 发散、效果图、情境图、风格探索 | Prompt/参考 → 生成多变体 → 编辑器/多轮对话 → 导出到别处 | 部分 | ChatGPT/Gemini 强 | 有 | 中 | 高 | 模型能力强，但项目链路弱 |
| ComfyUI citeturn10view6turn10view7turn4search1turn4search6 | 节点式工作流引擎 | 高控制度生成式工作流 | Power user、技术型设计师、工作室 | 可复现图像管线、局部重绘、批量出图 | 模板/节点图 → 接模型与控制节点 → 运行 → 调参复用 | 有 | 无 | 有 | 中高 | 高 | 可追踪、可复用、可控，但学习成本高 |
| Figma AI / Figma Make citeturn10view0turn40view0turn40view3turn9view3 | 设计工具 + AI | UI/原型/设计系统内 AI | 产品设计师、UI 设计师、前端协作团队 | wireframe、设计迭代、功能原型 | 选层/文件 → Agent 改图或 First Draft → Make 生成原型 → 回到设计文件 | 有 | 强 | 弱 | 低 | 中 | “选中对象 + AI + design system context” 很值得学 |
| Canva AI / Magic Studio citeturn20search3turn10view3turn20search8turn20search18 | 设计套件 + AI 助手 | 面向广泛用户的可编辑设计生产 | 非设计专业用户、营销、教育、SMB | presentation、社媒、品牌素材、营销内容 | 对话生成 → 编辑器内改图/改版 → 模板/品牌 → 导出 | 有 | 强 | 有 | 中低 | 中 | 最强项在“把东西做出来并整理成成品” |
| Miro AI / Intelligent Canvas citeturn9view2turn18view0 | 协作白板 + AI | 研究、brainstorm、流程推进 | 产品、策略、设计、跨职能团队 | workshop、journey、roadmap、信息汇总 | 模板/空白板 → 贴资料 → AI 总结/格式化/Flows → 协作推进 | 有 | 中 | 弱 | 中 | 高 | 前期研究与团队协作组织逻辑很强 |
| tldraw / make-real citeturn19view0turn19view1 | AI canvas 原型项目 | 让草图直接变成交互原型 | 开发者、实验型设计师 | 低保真 UI 草图转 HTML | 白板草图 → 选区 → Make Real → 生成 HTML shape → 标注再迭代 | 有 | 中 | 弱 | 低 | 中 | “画布就是对话空间”的范式启发很强 |
| Milanote citeturn9view6turn5search14 | moodboard / 创意项目整理 | 创意项目组织 | 设计师、创意团队、学生 | 灵感板、research board、项目资料整理 | 建板 → 拖入图文链接 → 分组整理 → 分享 | 有 | 无 | 无 | 中 | 高 | 资料整理体验与创意项目结构 |
| Cosmos citeturn9view7turn5search12turn5search15 | 灵感发现 / 收藏 | 设计导向 inspiration graph | 设计团队、视觉创作者 | 参考图检索、风格研究、收藏 | 搜 / 存 / 集合 → 查看来源与作者 → 再收藏分组 | 弱画布 | 无 | 无 | 中 | 中 | 更“设计化”的 inspiration sourcing |
| Pinterest Board citeturn39view0turn5news48 | 大众灵感收藏板 | 大规模视觉采集 | 广泛用户与设计师 | 灵感搜集、collage、趋势观察 | 搜索 / Pin → 建 Board → 协作 / 秘密板 → remix collage | Board | 无 | 无 | 中 | 中 | 最大众的灵感入口，但不是项目工作台 |
| FLORA citeturn29search0turn29search1turn29search3 | workflow-first 创意画布 | 连接文本/图像/视频模型的创意环境 | 专业创意团队、机构 | 多模型串联、分支探索、创意流程编排 | 建 block → 连模型/素材 → 分支迭代 → 在画布比对流程 | 有 | 中 | 有 | 中 | 很高 | 你最该关注的“下一代 AI 创意工作流”参考之一 |

## 重点产品分析

**Lovart**  
产品简介：官方来源把它定义为“AI design agent”，强调不是给一堆工具，而是给“finished outcomes”；输入可以是 prompt、参考文件或 Brand Kit，系统会自动在 30+ 模型中路由，并把结果放到无限画布上继续编辑与导出。典型流程是 **创建项目 / 画布 → 输入 prompt / 上传参考或 Brand Kit → Agent 选模型 → 在画布生成结果 → Touch Edit / Text Edit / Quick Edit → 导出 PNG / SVG / PSD / PPTX / MP4**。信息架构上，它明显是 **项目中心 + 画布中心 + Agent 输入框 + Skills 预设流** 的混合体，并带 Brand Kit、导出、快捷键和多种 AI 编辑。AI 交互方式以聊天式与技能流为主，但又支持选中对象后的局部编辑。优点是流程整合度极高、起点灵活、导出能力强，且已经在尝试把“图片生成工具”和“展示材料输出”接起来。局限也很明显：官方最强案例仍偏品牌、广告、社媒与电商交付；社区评价出现明显两极，一边认为它 designer-friendly、迭代顺，一边则质疑其专业一致性、可控性与计费透明度。对你的启发是：**可以学它的统一工作台、Brand Kit、对象级 AI 编辑和 deck 导出，但不要把生产营销素材误当成产品设计概念流程本身。** 你的产品更该补上前期调研、方案推导、关系追踪和工业设计语义。citeturn16view0turn37search2turn37search4turn37search9turn37search11turn31view1turn31view0turn31view2

**Adobe Firefly Boards**  
产品简介：官方将 Boards 定位为用于早期 idea exploration、moodboards、storyboards 和 pitch materials 的 generative-first 协作画布。典型流程是 **进入 Firefly → 新建 Board / 上传媒体 / 接入 Adobe Stock → 在画布上添加文字与图片 → 用 Firefly 或 partner models 生成 → 选多图 Remix → 评论、Pinned feedback、权限协作 → 必要时送入视频编辑器**。信息架构是典型的 **Adobe 平台首页 + Boards 模块 + 画布 + 素材接入 + 评论协作**，更偏“上板组织”而不是项目管理。AI 交互是 prompt、参考图、Describe image、Remix，多人评论能力比多数 AI 生图工具成熟。优点是早期视觉方向探索顺滑、灵感与生成在同一空间、协作反馈机制完整。局限在于它非常强于“视觉方向对齐”，但不负责问题定义、研究洞察、工业设计 form language，也没有把 prompt、变体、结论组织成“概念链路”的明确结构。对你的启发是：**把 moodboard 做成活的、可生成的、可评论的，不是静态拼贴板；但你需要再往前加 research/insight，再往后加方案比较与展示收束。**citeturn9view0turn17view0turn17view1turn17view2turn17view3turn12search1

**Visual Electric**  
产品简介：官方公开介绍与官方频道都把它描述为“the first image generator designed for creatives”，强调无限画布与直觉界面；媒体也将其解读为一款带设计师工作流取向的 AI image generator。典型流程大致是 **进入 workspace → 在画布中写 prompt / 加 style 或 found imagery → 生成多图 → 按方向在画布里排布 → 继续用自定义风格与图像微调**。信息架构由于公开文档较少，这里更接近 **基于官网描述、教程标题与社区信息的推测**：它不是聊天中心，也不是模板中心，而是 **画布中心 + 图像生成器 + 风格控制 / 共享工作区**。AI 交互更像 art director / image editor，而不是完整代理系统。优点是视觉取向明确、生成界面更贴近创意工作、对 reference 与画布编排比较友好。局限在于它主要解决“更好地生成和组织视觉”，而不是“更好地推进设计项目”，前后链路、方案关系、项目上下文和输出整理都偏弱；社区评价同时提到价格与复杂图像控制问题。对你的启发是：**“为设计师设计”的界面语气与画布气质很值得借鉴，但如果没有项目上下文、概念树和比较机制，它仍会停留在高级生图板。**citeturn28search3turn13search1turn13search10turn28search7turn13search17turn13search22

**Krea**  
产品简介：官方把 Krea 定义为 AI creative suite，核心卖点是实时生成、图像 / 视频 / Edit / Enhancer / Training 多工具一体，以及一站式接入多家模型。典型流程是 **选择 Realtime / Image / Edit → 输入 prompt 或在左侧 canvas 上画 / 调整 → 右侧实时得到输出 → 用 Edit / Enhancer 细修 → 需要风格一致时做 custom training**。信息架构上，它是工具中心型：首页进入不同 mode，Realtime 本身又是 **左 canvas、右 live output** 的双栏结构。AI 交互不是“长对话”，而是“即时操控 + prompt + 参考图 + 自定义训练”。优点是速度极快、探索感强、把 style transfer、训练、一键增强都纳入同一套流程。局限是它的强项仍是“视觉实验台”，不是“设计项目台”；社区评价也提到控制度不总是稳定、图像质量会波动。对你的启发是：**实时反馈会显著降低设计师尝试成本，但实时生成必须服务于概念推演，不然只会让人更快地产生更多碎片。**citeturn33view0turn34search0turn34search7turn34search9turn27search3turn27search1

**Recraft**  
产品简介：官方把 Recraft Studio 定位成 all-in-one AI design platform，覆盖 image、vector、mockup、upscale、自然语言编辑等；官方文档则显示其 project、canvas、history、libraries、templates 都已成型。典型流程是 **新建项目 → 在无限画布中生成图像 / 矢量 / mockup → 右侧 context panel 调整 → 局部 Edit area / 自然语言编辑 → History / Library 管理 → 导出**。信息架构是非常典型的 **项目首页 + 无限画布 + 右侧属性/上下文面板 + 历史 / 模板 / 库**，整体更像 AI 化的 Figma / 多媒体设计台。AI 交互同时支持 prompt、自然语言编辑与手动画区修改。优点是空间组织清晰、矢量能力稀缺、mockup 链路自然、对象编辑比一般生图工具更“设计工具化”。局限在于它主要服务 graphic / brand / mockup production，不是围绕产品设计概念阶段组织的；研究、推导、方案比较和项目故事线仍需外部补齐。对你的启发是：**可以借鉴其“设计工具式 AI 工作区”和 AI + vector/mockup 的统一面板，但要避免把产品做成泛创意工作台而失去工业设计聚焦。**citeturn32view0turn32view1turn11view2turn11view3turn26search1turn26search2

**Vizcom**  
产品简介：官方把 Vizcom 明确定位为面向 creative professionals、尤其工业设计语境的 AI design tool，工作流从 sketch、prompt、render、modify、reference、2D-to-3D 一路延伸。典型流程是 **进入 workspace → 在 Studio 中画草图或导入草图 → Render / Refine → 把结果放到 Workbench 做多方向组织与比较 → 用 Modify 生成新视角、材料、颜色变化 → 必要时转 3D、动画或送到 Fusion**。信息架构非常清晰：**Workspace Home → Studio → Workbench → Asset Library / Reference Images / 2D to 3D / Plugin**。AI 交互主要是 prompt、参考图、Modify block、Refine mode，不太像连续聊天，而更像围绕视觉工件的专业生成器。优点是它几乎是目前最贴近工业设计概念视觉流程的产品：输入 sketch、保持 form、做视角与 CMF 变化、再到 3D，非常顺。局限是上游 research / insight / strategy 几乎不覆盖，下游展板与项目叙事整理也不算它的核心；社区反馈也指出它更适合快速概念表达，而非终局 CAD 或精确最终渲染。对你的启发是：**你不必在 V1 直接和 Vizcom 拼“渲染质量”，但必须吸收它对 form-preserving、view variation、CMF iteration 的专业意识。**citeturn24view1turn24view0turn25search1turn25search2turn25search11turn25search9turn23search10turn23search6

**Gravity Sketch**  
产品简介：Gravity Sketch 不是传统意义上的 AI 生图平台，而是工业设计的沉浸式 3D ideation studio；它的价值在于把参考图、3D 草绘、人体工学、CAD 互转、VR 评审和空间协作串起来。典型流程是 **导入参考图 / moodboard → 在 VR 或屏幕端 3D 草绘与建形 → 用 mannequins/场景测试人体工学与使用情境 → 导出到 CAD → 截图回到 Photoshop / 渲染 → 设计评审**；2026 年官方也开始公开讲“AI-enhanced design workflows”，但逻辑仍是把 AI 图像带入 3D 流程，而不是在产品内完成所有 AI 图像生成。信息架构本质上是 **3D studio / rooms / collaboration / export**，不是传统 2D 画布。优点是对工业设计真实问题更贴：比例、尺度、情境、人体工学、跨地协作。局限是研究整理、prompt 管理、图像生成链路、作品集装配都不在它的核心。对你的启发是：**如果你的产品停留在“2D 概念图工作台”，就会和真实工业设计流程错位；至少要为未来接入 3D / CAD / ergonomics 预留接口。**citeturn22view0turn9view5turn21view0

**Midjourney / ChatGPT Image / Gemini Image**  
产品简介：这三者都很强，但它们本质上更像“高能力模型入口”而不是“项目型设计工作台”。Midjourney 当前已有 Web Create、Editor、Moodboards；ChatGPT Image 的优势是多轮对话、图文混合上下文与较强版式 / 文本呈现；Gemini 图像模型则明确支持复杂 multi-turn creation/editing、高分辨率与基于 Search 的实时信息 grounding。典型流程通常是 **Prompt 或参考图 → 生成若干方向 → 通过 editor / 多轮聊天微调 → 导出到 PS/Figma/Vizcom/3D 软件继续处理**。信息架构上它们分别对应 **创作 feed / 编辑器 / 个性化板**、**聊天线程**、**聊天或 API 能力面**。优点是模型质量与理解力往往领先，发散和“第一眼惊艳图”效率高。局限也同样清楚：它们缺少项目空间、缺少上下文资产管理、难追踪 prompt 与方案的关系，且社区在工业设计语境中反复提到对形体一致性、精确性和可控性仍不够稳定。对你的启发是：**别把“模型能力强”误判为“产品工作流完整”，你的价值应该是把这些模型纳入更靠谱的概念设计链条。**citeturn35view3turn35view4turn35view5turn35view0turn35view2turn14search0turn36search2turn36search4

**ComfyUI**  
产品简介：官方把 ComfyUI 定义为 node-based interface and inference engine，强调 complete control、community workflows、app mode 与 node graph 并存。典型流程是 **加载模板或自建工作流 → 连接模型、提示、参考、控制节点、编辑节点 → 运行 → 调参 → 保存与复用 workflow**。信息架构是纯粹的 **节点工作流型**，而不是项目或聊天中心型。AI 交互并非对话，而是参数化、节点化、可组合、可复现。优点是控制度、可追踪性、可批处理性、可复用性远胜大多数封闭式生图产品；这对想追踪“哪张图是怎么来的”的专业流程很重要。局限也很明确：学习曲线高、对工业设计学生不够友好、缺少项目叙事和前后链路整合。对你的启发是：**你未必要做 node graph，但一定要吸收 ComfyUI 的“流程可见、参数可追、结果可复现”思想。**citeturn10view6turn10view7turn4search1turn4search6

**Figma AI / Figma Make**  
产品简介：官方把 Figma AI 描述为“from first spark to shipped product”，但它的语境非常明确：是 UI、交互与 design system 世界；2026 年的 Figma agent 已经可以直接在 canvas 上工作，并读取 library、components、variables 等上下文，Figma Make 则是从设计或 prompt 快速生成功能原型。典型流程是 **在设计文件中选层 / 开 agent → 让 AI 生成或修改设计层 → 必要时接入 library context → 再把 frame 送到 Make 生成可运行原型**。信息架构是 **项目 / 文件中心 + canvas + persistent AI sidebar**。AI 交互既支持聊天，也支持从选中对象出发的局部 edit。优点是设计系统上下文极强、批量修改能力强、对“在已有设计文件里协作”非常顺。局限是它服务的是 UI 产品设计，不是工业设计概念图，也不解决参考资料、moodboard、图像对比、CMF、展板叙事。对你的启发是：**“AI 理解当前选区和项目库”的模式极值得借鉴，但底层对象不能只是 button / frame，而要变成参考图、概念卡、prompt、变体图、材料板。**citeturn10view0turn40view0turn40view3turn9view3turn10view1

**Canva AI / Magic Studio**  
产品简介：官方把 Canva AI 2.0 定位为 built across Canva Visual Suite 的 conversational creative partner，强调对话式创建、可编辑层级、品牌与模板整合；Magic Studio 的核心叙事也是“无需在多个 AI 工具间切换”。典型流程是 **用对话生成首版设计 → 在 editor 中继续改文案、版式、图片、尺寸 → 调用 photo/video/template/brand 工具 → 输出 presentation / 社媒 / 营销素材**。信息架构明显是 **模板 / 项目首页 + 编辑器 + 对话助手**。AI 交互更偏广义创意助手，而非专业设计代理。优点是成品导向强、presentation 与传播物整理很顺、面向非专业用户门槛低。局限是概念设计深度不足，物理产品语义和 form 控制也较弱，更适合“把内容排成可交付成品”，不适合“推导概念”。对你的启发是：**你可以学习 Canva 最后一步“把杂乱内容收成可展示成果”的能力，但前面那条链必须更专业，而不是模板化。**citeturn20search3turn10view3turn20search8turn20search18

**Miro AI / Intelligent Canvas**  
产品简介：Miro 的强项不是生成图片，而是把团队工作的 discovery、definition、delivery 放进一个智能画布里；官方反复强调 canvas、docs、diagrams、tables、spaces、flows、AI sidekicks 与 catch-up summaries。典型流程是 **从模板或白板开始 → 聚集调研内容与 sticky notes → AI 总结 / 结构化 → 进入 docs/diagram/table/flow → 继续协作推进**。信息架构是典型的 **团队空间 / board / 多格式对象 / AI 摘要与流程块**。AI 交互更像团队协作助手，而不是视觉生成器。优点是前期调研与共识形成能力很强，信息结构和跨人协作远超大多数生图工具。局限是视觉概念生成、工业设计图像迭代都不是它的核心。对你的启发是：**如果你的产品只学 Lovart 和 Vizcom，而不学 Miro，那么前期研究和团队对齐会缺位；你至少该具备研究墙、洞察聚类、结论回溯这类 Miro 式能力。**citeturn9view2turn18view0

**tldraw / make-real**  
产品简介：make-real 是一个极具启发性的 AI canvas 原型，而不是成熟的大而全产品。官方 starter 明确写出它的逻辑：在 tldraw 上先画 mockup，选中后按 Make Real，系统把选区截图与指令送给模型，返回 HTML，再作为可交互 shape 放回画布；之后可以继续在画布上批注并再次生成。典型流程是 **画草图 → 选区 → Make Real → HTML shape 上板 → 注释再迭代**。信息架构几乎是纯 **canvas-first**，没有复杂项目壳。优点是它证明了一件事：**无限画布可以不是“摆图的地方”，而可以是“人与 AI 协同推敲方案”的地方。** 局限是项目管理、资产管理、非 Web 设计域都非常弱。对你的启发是：**你的产品的画布不应只是贴图容器，而应成为概念生成、对比、批注、回溯的操作舞台。**citeturn19view0turn19view1

**Milanote**  
产品简介：官方把 Milanote 定义为 organizing creative projects 的工具，强调 notes、images、videos、sketches、research 都可混排进 board。典型流程是 **建 board → 收集灵感、研究、链接、图片 → 自由排布 → 分享讨论**。信息架构是经典的 **项目 / board / 卡片** 模式，整体更像创意项目的视觉化知识库。优点是轻、直观、很适合前期资料整理与 moodboard。局限是原生 AI 能力弱，不能把研究资料自动推成概念方向，更不负责图像迭代与成品导出链路。对你的启发是：**前期资料组织要足够轻和自由，否则设计师不会长期用；但你必须在 Milanote 之上加“概念推进引擎”。**citeturn9view6turn5search14

**Cosmos**  
产品简介：Cosmos 更像为设计团队做的 inspiration discovery 系统，官方强调“surfacing the artist, source, and story”，也就是不仅给图，还给出处与上下文。典型流程是 **搜索 / 收藏图片 → 查看作者与来源 → 建集合 → 持续扩展风格库**。信息架构是 **feed / collection / source metadata**，更偏灵感发现而非项目执行。优点是参考图质量和出处意识更强，对设计研究初期很有价值。局限是它不是设计工作台，缺少生成、推导、方案比较与导出流程；社区也提到免费版容量与审美覆盖的限制。对你的启发是：**“灵感收集”不该只是无来源的图片堆，最好要有出处、标签和与概念的连接关系。**citeturn9view7turn5search12turn5search15

**Pinterest Board**  
产品简介：Pinterest board 是最成熟的大众灵感容器之一，官方流程就是把 Pin 收进 board，并支持 secret board 与协作；近年的 remix collage 功能也在强化 moodboard 属性。典型流程是 **搜索 / 首页发现 → Pin 到 board → 分类协作 → remix collage**。信息架构是 **feed / search / board / pin**，重点在发现与收藏，而不是项目上下文。优点是内容量巨大、寻找方向非常快。局限是图片来源、筛选质量、项目结构、设计过程追踪都弱，和“概念设计工作台”之间还有很大距离。对你的启发是：**你的产品可以把 Pinterest 当作输入源思路，但不能把“收藏板”误当“设计流程”。**citeturn39view0turn5news48

## 横向对比分析

综合各家官方工作流与帮助中心来看，当前市场的横向差异不在“有没有 AI”，而在 **AI 被放进了哪种工作流容器**：有的是视觉生成器，有的是协作白板，有的是设计系统内 Agent，有的是节点流程引擎，有的是灵感资料库。你的产品若想成立，必须先决定自己不是哪一种，然后再决定要把这些容器怎么拼起来。以下对比是基于官方文档与公开教程的综合判断。citeturn16view0turn17view0turn24view0turn40view0turn9view2turn10view7turn9view6

| 产品 | 更偏 AI 视觉生成 | 更偏 AI 设计 Agent | 更偏工业设计概念图 | 更偏 UI / 原型 | 更偏 moodboard / 灵感管理 | 更偏团队白板 / 协作 | 更偏流程管理 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lovart | 高 | 很高 | 中 | 低 | 低 | 低 | 中 |
| Firefly Boards | 高 | 中 | 中低 | 低 | 很高 | 中高 | 低 |
| Visual Electric | 高 | 低 | 中低 | 低 | 中 | 低 | 低 |
| Krea | 很高 | 低 | 中 | 低 | 低 | 低 | 低 |
| Recraft | 很高 | 中 | 中低 | 低 | 低 | 低 | 低 |
| Vizcom | 很高 | 低 | 很高 | 低 | 低 | 中 | 低 |
| Gravity Sketch | 中 | 低 | 很高 | 低 | 低 | 中 | 低 |
| 通用图像生成工具 | 很高 | ChatGPT/Gemini 中 | 中 | 低 | 低 | 低 | 低 |
| ComfyUI | 高 | 低 | 中高 | 低 | 低 | 低 | 中 |
| Figma AI / Make | 低 | 高 | 很低 | 很高 | 低 | 中 | 中 |
| Canva AI | 中 | 中高 | 低 | 中低 | 低 | 低 | 中 |
| Miro AI | 很低 | 中 | 低 | 低 | 中 | 很高 | 很高 |
| tldraw / make-real | 低 | 中 | 很低 | 中 | 低 | 中 | 低 |
| Milanote | 很低 | 很低 | 低 | 很低 | 很高 | 中 | 中低 |
| Cosmos / Pinterest | 很低 | 很低 | 低 | 很低 | 很高 | 低 | 很低 |
| FLORA | 高 | 中 | 中 | 低 | 低 | 中 | 高 |

从用户流程看，当前产品大概有六种主流起点。**Prompt-first** 代表是 Midjourney、Krea Image、Recraft 的一部分，优点是上手快、发散快，缺点是上下文与关系容易丢；**Canvas-first** 代表是 Firefly Boards、Recraft、Visual Electric、Miro、tldraw，优点是更适合比较、组织和协作，缺点是如果没有结构很容易变成“大白板”；**Asset-first** 代表是 Milanote、Cosmos、Pinterest、Vizcom 的 reference image 入口，适合从已有资料或视觉方向开始，但不天然支持概念推导；**Agent-first** 代表是 Lovart、Figma agent、Canva AI，优点是降低操作负担，缺点是容易把设计过程包得过黑；**Workflow-first** 代表是 ComfyUI 和 FLORA，优点是高控制、可复现，缺点是心智负担高；**3D-first** 则是 Gravity Sketch，更适合 form、比例、人体工学，而不适合前期研究组织。对于产品设计 / 工业设计概念阶段，最合适的不是单一模式，而是 **项目中心下的“Research-first + Concept-canvas + Agent-assist” 混合流程**。citeturn35view3turn34search0turn32view0turn17view0turn24view0turn9view2turn16view0turn40view0turn20search3turn10view7turn29search0turn22view0

信息架构方面，几种常见模式也已很清晰。**聊天栏 + 画布** 适合 Agent 驱动与对象级修改，Lovart、Figma 最典型；**左侧资产库 + 中间画布 + 右侧属性面板** 适合 Recraft、Vizcom 这类专业创意编辑器；**项目首页 + 文件列表 + 编辑器** 适合 Figma、Vizcom、Canva 这种持续性项目；**模板库 + 生成器** 更适合 Canva；**节点工作流** 适合 ComfyUI / FLORA；**moodboard / collection 资料库** 则适合 Milanote / Cosmos / Pinterest。对你想做的产品，最适合的不是纯白板，而是 **项目中心 + 概念画布 + 资产关系层 + 展示输出层** 的四层结构。citeturn40view0turn32view0turn24view2turn9view3turn20search3turn10view7turn29search0turn9view6turn9view7turn39view0

下面给出一个粗粒度覆盖评分。它不是功能清单统计，而是“从产品设计 / 工业设计概念阶段视角看，用户是否能在该产品里比较顺地完成这件事”的判断。

| 产品 | 前期调研 | 问题洞察 | 概念方案 | Prompt 生成 | 草图 / 效果图 | 图像迭代 | 方案比较 | 展示材料整理 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lovart | 2 | 2 | 4 | 5 | 4 | 4 | 3 | 4 |
| Firefly Boards | 2 | 2 | 4 | 4 | 4 | 4 | 3 | 3 |
| Visual Electric | 1 | 1 | 3 | 3 | 4 | 4 | 2 | 2 |
| Krea | 1 | 1 | 3 | 3 | 4 | 4 | 2 | 1 |
| Recraft | 1 | 1 | 3 | 3 | 4 | 4 | 2 | 3 |
| Vizcom | 1 | 2 | 5 | 3 | 5 | 5 | 4 | 3 |
| Gravity Sketch | 2 | 3 | 5 | 1 | 4 | 3 | 3 | 2 |
| 通用图像生成工具 | 1 | 1 | 3 | 3 | 4 | 3 | 2 | 1 |
| ComfyUI | 1 | 1 | 3 | 4 | 4 | 5 | 3 | 1 |
| Figma AI / Make | 1 | 1 | 2 | 2 | 1 | 2 | 2 | 3 |
| Canva AI | 1 | 1 | 2 | 2 | 3 | 3 | 2 | 5 |
| Miro AI | 5 | 5 | 2 | 1 | 1 | 1 | 4 | 3 |
| tldraw / make-real | 1 | 1 | 2 | 1 | 1 | 2 | 2 | 1 |
| Milanote | 4 | 3 | 2 | 1 | 1 | 1 | 3 | 3 |
| Cosmos / Pinterest | 2 | 1 | 1 | 1 | 1 | 1 | 2 | 1 |

这个评分表最重要的信息，不是某个产品高不高，而是**没有一个产品在八个阶段里都高**。这恰恰说明你要做的不是“多一个工具”，而是“补断链”。citeturn16view0turn17view0turn24view0turn22view0turn9view2turn9view6

## 市场空白与产品机会点

基于上面的横向对比，我的判断是：你的产品**有成立空间，而且空间并不小**，前提是你不要去和现有工具在它们已经最强的单点上正面硬碰。更有前景的做法，是抓住它们之间的断裂带。以下是这次调研里最清晰的机会点。citeturn16view0turn17view0turn24view0turn9view2turn9view6

- **现有工具普遍偏视觉结果，缺少前期思考容器。** Lovart、Krea、Recraft、Midjourney、ChatGPT Image、Gemini Image 都很擅长把“想法变成图”，但很少真的帮用户把“问题是什么、方向为什么成立、参考是怎么收敛出来的”这套前期逻辑串起来。citeturn16view0turn33view0turn32view0turn35view3turn35view0turn35view2
- **普遍缺少“从调研到方案再到图像”的连续流程。** Miro 能做研究与协作，Vizcom 能做工业设计视觉，Canva 能做 presentation，但这三段通常分散在不同工具里，信息与意图会在切换中丢失。citeturn9view2turn24view0turn20search3
- **缺少产品设计 / 工业设计专用流程。** Firefly Boards、Lovart、Recraft 偏创意生产；Figma 偏 UI；Canva 偏传播成品。真正懂 form language、CMF、视角变化、手绘草图输入、产品语义约束的，主要还是 Vizcom 和 Gravity Sketch，但它们又不强于 research / concept narrative。citeturn17view0turn16view0turn32view0turn40view0turn24view0turn22view0
- **缺少项目级上下文与关系层。** 通用图像工具和多数 AI 画布仍以单次生成或单块画布为中心，难以回答“这张图对应哪条洞察、哪版 prompt、哪个方向、为什么被保留”。ComfyUI 虽然可追踪参数，但不擅长项目叙事；Milanote 能整理资料，但不擅长把关系转成生成链。citeturn35view3turn35view0turn35view2turn10view7turn9view6
- **缺少 prompt、参考、草图、变体、结论之间的可回溯关系。** 这件事在 ComfyUI 里以 workflow graph 的方式得到部分解决，在 FLORA 里以 block flow 的方式得到强化，但它们都还不是面向产品设计学生的易用工作台。citeturn10view7turn29search0turn29search3
- **缺少从生成图到展板 / PPT / 作品集素材整理的自然过渡。** Lovart 已开始补这段，Canva 的成品整理也很强，但大多数工具仍在“出图”这里结束。对于学生和独立设计师，这恰恰是最痛的断点之一。citeturn37search4turn20search3turn20search8
- **对学生与独立设计师的友好度仍然不足。** ComfyUI 太技术，Vizcom 和 Gravity Sketch 更专业但流程有门槛，Lovart / Krea / Recraft 又容易滑向“快速视觉生产”，前期认知方法与结构化思考仍靠用户自己。citeturn10view7turn24view0turn22view0turn16view0turn33view0turn32view0
- **“比较与决策”环节仍被明显低估。** 现在很多工具会帮你产出 20 个结果，但很少帮你把这 20 个结果按设计方向、品牌约束、场景、制造假设、用户反馈做成可比较的方案树。Firefly Boards、Vizcom Workbench、Miro board 已经提供了“把多个方向摆在一起”的基础，但还没把它做成真正的决策层。citeturn17view0turn24view0turn9view2

综合起来，我建议你优先聚焦以下 **七个明确产品机会点**：

1. **做“概念阶段操作系统”，而不是又一个生图器。**  
2. **用项目上下文把 research、insight、prompt、reference、image、decision 连成一条链。**  
3. **围绕产品设计 / 工业设计建立专用对象模型：概念卡、CMF 板、形态方向、参考场景、评审结论。**  
4. **让无限画布承担组织、比较、批注和回溯，而不只是摆图。**  
5. **让 AI 不仅会生成图，还会基于研究资料帮你生成方向、对比差异、解释为什么。**  
6. **把图像迭代与最终展板 / PPT / 作品集素材整理打通。**  
7. **为学生与独立设计师提供“可引导的专业流程”，而不是只给一个空白画布。**  
这些机会点都不是空想，而是对现有产品边界的直接补位。citeturn16view0turn17view0turn24view0turn9view2turn37search4

## 对你的产品的初步建议

**建议的产品定位**：不要把自己定义成“AI 生图平台”，也不要定义成“工业设计版 Miro”。更好的定位是：**面向产品设计 / 工业设计概念阶段的 AI 研究—概念—视觉化工作台**。它的核心价值不是单点能力最强，而是把原本分散在 ChatGPT、Midjourney / Krea / Vizcom、Miro、Figma、文件夹与 PPT 里的事情，收进一个连续项目空间里。这个定位能与 Lovart、Vizcom、Miro、Canva、Figma 形成清晰差异。citeturn16view0turn24view0turn9view2turn20search3turn40view0

**建议的核心用户**：第一优先建议是 **产品设计学生 / 工业设计学生 / 早期职业设计师 / 独立设计师 / 小型设计工作室**；这批人有完整概念阶段需求，但又最痛于工具切换和流程碎片化。企业级大团队当然也有需求，但那会立刻把产品拉向 Miro / Figma / Adobe 式复杂协作平台，不利于 V1 聚焦。citeturn10view7turn24view0turn22view0turn9view2

**建议的主场景**：最适合从三个高频场景切入。第一，**课程 / 毕设 / studio project 的概念冲刺**；第二，**独立设计师接 brief 后的一轮方向探索与比稿**；第三，**把零散参考、AI 图、草图与结论整理成展板 / case study**。这三个场景能天然覆盖你想打通的“前—中—后”链路，又不要求你在 V1 就完成 CAD、供应链、制造或大型企业工作流。citeturn36search1turn36search2turn37search4

**建议的核心流程**：  
**创建项目 → 导入 brief / 参考资料 / 竞品图 / 品牌与产品约束 → AI 辅助 research 摘要与洞察聚类 → 生成 3–5 条概念方向卡 → 每条方向自动生成 prompt、参考建议与视觉板 → 在概念画布上做草图 / 图像迭代与方案比较 → 选中方向后自动整理为展板 / PPT / 作品集素材包。**  
这个流程与 Lovart 的“从 brief 到资产”、Firefly 的“从灵感到方向”、Vizcom 的“从 sketch 到 render”和 Canva 的“从内容到成品”分别取长补短，但把它们串成一个面向产品设计的链条。citeturn16view0turn17view0turn24view0turn20search3

**建议采用的信息架构**：我建议采用 **项目中心型 + 画布中心型的混合 IA**，而不是纯聊天页，也不是纯白板。一个更合理的第一版结构是：  
**首页 / 项目列表** → **项目总览**（brief、目标、约束、时间线） → **Research**（资料、竞品、洞察卡） → **Concepts**（概念方向树） → **Canvas**（视觉探索与图像迭代） → **Compare**（并排比较、评审意见、保留 / 淘汰） → **Boards / Deck**（最终展板、PPT 与素材导出） → **Assets / History**（prompt、参考图、生成记录、风格 / 材质库）。  
编辑器布局建议是 **左侧项目树 / 资产库，中间无限画布，右侧属性与 AI inspector，底部或侧边是当前对象 / 当前概念范围内的 AI 对话线程**。这比 Lovart 更项目化，比 Miro 更专业化，比 Vizcom 更前后贯通。citeturn16view0turn24view2turn32view0turn9view2turn40view0

**第一版应该重点做什么**：  
第一，做 **项目上下文 ingestion**，支持 PDF、图片、草图、竞品截图、品牌手册、课堂 brief。第二，做 **概念方向卡 + 研究洞察到视觉探索的桥**，让 AI 不只会生图，还会帮用户把研究转成几个方向。第三，做 **可回溯的图像迭代与关系追踪**，至少能让每张图知道自己来自哪条方向、哪组 prompt、哪批参考。第四，做 **方案比较与评审面板**，这会成为你区别于通用生图工具的关键。第五，做 **展板 / PPT / portfolio-friendly 输出**，因为这正是现有流程的痛点断层。citeturn37search11turn24view0turn10view7turn37search4turn20search3

**第一版不应该做什么**：  
不要在 V1 就做完整 CAD 或复杂 3D 建模，这会和 Gravity Sketch、专业 CAD 赛道正面冲突；不要追求支持所有模型和所有节点流，不然会滑向 ComfyUI / FLORA 的复杂度；不要把自己做成通用营销设计工具，那会落入 Lovart / Canva / Adobe 的竞争逻辑；也不要先做大型企业协作套件，因为那会把产品拖成另一个 Miro。V1 最忌讳的是范围过大、价值主张模糊。citeturn22view0turn10view7turn29search0turn16view0turn20search3turn9view2

**它应该如何区别于 Lovart、Vizcom、Figma AI、Firefly Boards、Miro AI**：  
相对 **Lovart**，你不是“创意资产代理”，而是“概念阶段工作台”；相对 **Vizcom**，你不只做 sketch/render，而要覆盖 research、方向推导与 final board；相对 **Figma AI**，你不做 UI 设计系统，而做产品概念与工业设计对象系统；相对 **Firefly Boards**，你不只做 ideation board，而做能持续推进方向的 project spine；相对 **Miro AI**，你不只做协作白板，而要能产出专业概念视觉并追踪其来源。换句话说，你真正的差异化不是“某一招更强”，而是 **把概念设计链条里的断层接起来，并且用产品设计 / 工业设计的语言重写这条链。**citeturn16view0turn24view0turn40view0turn17view0turn9view2

**开放问题 / 局限**：本轮调研刻意保持在“大框架”层面，没有展开到具体交互控件、定价、权限系统、模型质量细测，也没有把每家产品近一个月的版本变动逐条核对；另有少数产品如 Visual Electric、部分 Canva 帮助页，可获得的官方细节不如 Adobe / Figma / Vizcom 完整，因此对应的信息架构判断里含有明确标注的“推测”成分。尽管如此，关于市场分类、主流程、信息架构范式与机会点的结论，已经足以支持你进入下一轮产品定义与需求取舍。citeturn13search7turn20search3turn12search12turn40view3turn24view0