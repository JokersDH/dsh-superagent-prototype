# 真实 MVP：外部 A/B 大任务

**历史首轮任务。当前执行 [Native MVP 第二轮整包](../native-mvp-02/README.zh-CN.md)，下文保留原派工和测量范围。**

本轮主线已在 primary checkout 启动两个内部并行子任务，分别收尾 `apps/console/` 和 Codex/Runner。原来两个独立窗口不要重复改这些文件；各自执行下面的新包。

- 外部 Agent A：[真实项目环境准备](agent-a-environment.zh-CN.md)。落点 `packages/environment-preparation/`，让已有依赖的真实 Node/pnpm 项目能在隔离 worktree 检查。
- 外部 Agent B：[真实 MVP 独立验收](agent-b-acceptance.zh-CN.md)。落点 `tests/native-acceptance/`，独立验证实际网页/API/编码/交付和停止、重开、候选失效。
- 主线：执行与验证组合、项目配置/HTTP、UI/Runner 的内部子任务集成、首次真实 Native E2E 和发行入口。

现有真实证据：`reports/releases/native-mvp/native-product.json`，Codex 0.164.0 在独立 worktree 实现 slugify、原验收测试 PASS、人工接受后 delivered、重开保留，原项目保持不变。这不是完整 G2 的声明。

保持旧 worktree 和分支，先保留本地改动再 fetch/合并 main。不要修改别人的工作目录；每包交一个稳定接口检查点后继续整包，最后一次性交付。共享 contracts、root lock、应用/HTTP 与 main 仍由主线负责。

这些任务不阻塞当前 dependency-free Node MVP 的首次交付；A 扩大到已有依赖的项目，B 提供独立产品验收。不能把 fixture PASS 当 native PASS。
