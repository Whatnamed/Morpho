# Agent request/context/cache latency — working-tree phase

本阶段只处理用户按下发送到创建 Server Turn Journal (`POST /api/ai/agent/turns`) 之前的本地路径，以及同一 Tool 回合的续接安全回归。Provider 网络/TTFT、乐观消息提前提交、Prompt Cache 策略和 Server Journal 协议不在改动范围。

## 可信 before 基线

- 源码：clean `main` / `70bd14ccbfaeab7e545bc0ee4fa77f1afeead74a`。
- 生产构建：Next build ID `Hzfx1qkxGAkNN_t9VDLG8`；`.next` SHA-256 `87fcdbb613de4eda5e31dd78e7812a87af93207e9876eb70a88b744ff418a17e`；`isDirty=false`。
- `npm.cmd run measure:perf5:browser`：11/11 通过，单 worker、零 retry、mock SSE，只隔离 client/runtime 成本。
- Enter/input 到 journal POST 的页内单轮观测：caseStudy (184 messages / 42 objects) `51.6ms`；chatLong (560 / 40) `49.3ms`；objects500 (46 / 500) `77.5ms`。这些是三档真实浏览器基线样本，不把单次样本包装成稳定百分位。
- Tool 回合每档都精确产生两次 Provider request，mock script `total=2 / consumed=2 / remaining=0 / overrun=0`；同页 request gap 分别为 `143.6 / 293.4 / 159.6ms`。
- 原始报告副本：`output/playwright/agent-latency-baseline-70bd14c.json`。

## 实施边界

1. Fresh Turn 先对 Recovery localStorage metadata 做同步 presence preflight。确认不存在 v2/v1 记录时不进入异步完整 load；存在、损坏、旧版或非法身份仍走原校验、clear、query-only recovery 与失败 UI。
2. 非 Delivery prepare 中彼此独立的图片附件读取和文档摘录并行开始；两者只读同一 Workspace/BlobStore 快照；`prepareDeliverySection` 保持原同步空输入分支。
3. 用户/assistant 占位消息提交后只读取一次 Workspace，并只构建一次 continuous conversation Context。Provider Context Frame append 的回归守卫明确保证它不修改 messages 或 compaction boundary。
4. task 与 `historyAndMemory` 两份 Memory Context 由一次 reconcile 同时生成；frame builder 复用后者，不再为 project/turn frame 重复 reconcile Project Memory。
5. 消息提交与 Frame 提交仍是两个独立 `flushSync` 边界。没有提前 optimistic commit、没有合并失败边界，也没有改变 exact Provider body、恢复记录、Tool result/continuation items 或用户消息内容。

## after 证据协议

未提交实现使用 `npm.cmd run build` 生成带 `sourceTreeSha256` 的 production marker，再执行 `npm.cmd run measure:perf5:browser:worktree`。该模式只有在 HEAD、dirty state、实际 tracked + non-ignored untracked source tree 摘要/文件数和 `.next` artifact 摘要全部匹配时才启动；它不会替代 clean commit-grade gate。完整 after 报告副本保存到 `output/playwright/agent-latency-after-working-tree.json`，并与上述 clean before 报告分开保留。
