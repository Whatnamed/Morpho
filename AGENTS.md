# Morpho 项目约定

默认用简体中文沟通。按当前任务选择入口。

| 工作 | 依据 |
| --- | --- |
| 下一代桌面 Design Agent | [过渡说明](docs/product/next-generation-direction.md)。专业设计策略、UI、Session、Memory 和技术选型由负责人定案。 |
| 维护现行 Web 工作台 | [v3.2 产品规则](docs/product/README_本次更新说明.md)和[设计规范](docs/design/README.md)。 |
| 理解当前实现 | 从[架构地图](docs/architecture/architecture.md)定位到源码、调用方与行为测试。 |
| 本地运行、验证与部署 | [运行手册](docs/operations/runbook.md)。 |

## 修改与验证

- 画布位置表达布局。对象身份、修订、引用、交付内容及用户授权由领域状态决定。
- 区分 AI 草案、用户确认的写入和外部付费执行。当前 Web 共享服务在服务端校验身份、额度与执行权限。密钥只放在服务端环境中。
- 修改领域规则、身份关系、持久化、授权或 API 输入时，覆盖受影响的行为及失败路径。日常检查使用 `npm run lint`、`npm run typecheck`、`npm test`。浏览器行为使用 `npm run test:e2e:build`。
- 正式文档按职责维护。产品行为写在产品规范，已落地边界写在架构，操作步骤写在运行手册。一次性执行计划放在 Git 忽略的 `temp/prompts/`。
- 使用独立任务分支，保护已有修改。普通串行工作使用主工作树 `D:\Morpho`，需要并行或保留独立现场时，在 `D:\Morpho-Worktrees\<task-or-branch>` 建额外工作树。按本次授权提交、推送和合并。
