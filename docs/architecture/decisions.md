# 当前技术决策

| 范围 | 已确认的选择与原因 |
| --- | --- |
| 下一代产品 | 以桌面端 Design Agent 为主。Web 是否延续、桌面技术栈、Agent Loop、Session 和 Memory 由后续方案决定。[过渡说明](../product/next-generation-direction.md) |
| 过渡期项目数据 | 现行 Web 继续读取既有项目和可编辑备份。迁移集中在输入边界；新安装使用当前 schema 的案例。停止按历史指纹替换已有样例，已编辑和未编辑的旧项目都保留。 |
| 状态所有权 | Canvas 管布局与交互，Workspace 管对象与修订。领域决定由用户或已授权的命令作出。交付引用和已生成图像保留独立身份。 |
| 当前 Agent | Web 工作台和 Agent Lab 共用 A+。退役无仓内调用方的独立文本路由和自由文本 Proposal 解析器。保留有工作台调用方的独立生图。 |
| 托管执行 | 现行共享 Provider 保留服务端认证、额度、执行身份和结果恢复。已关闭的 turn 仍可收到迟到结果，继续执行工具需由服务端单独确认。 |
| 开发与部署 | 常规 Web 构建和启动使用 Next 原生命令。保留 Vercel 配置路径；退役 Workers 备用构建链、P7 冻结实验和 Phase 5 性能证据构建。业务回归与 Agent Lab 继续运行。 |

历史 ADR、实验结果与适用版本见[历史基线](../archive/README.md)。
