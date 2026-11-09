# 外部 Agent A：真实项目依赖环境准备

工作目录 `/Users/hh/Desktop/joker/superagent-agent-a`；继续 `codex/g2-workspaces-verification`。先读取该 checkout 的 AGENTS.md、本文件、product-spec/README.md 和 05-reliability-and-operations。保留已有 root lock 临时差异，不手动覆盖它；fetch origin，合并最新 main 后开工。主线当前未发布的任务文件可只读 `/Users/hh/Desktop/joker/superagent/agent-tasks/native-mvp/`，不要改 primary checkout。

## 目标

当前真实 MVP 已能在隔离 worktree 写代码、运行注册检查并交付 patch；真实 Node/pnpm 项目在新 worktree 里可能没有依赖。交付独立环境准备模块，让这个过程有边界、能取消、可诊断，并保持原项目不变。

## 归属

只实现 `packages/environment-preparation/` 及其 README、package-local fixtures/tests/reports。不要修改 apps/console、apps/coordinator、apps/runner、codex-native、workspaces、verification、storage、contracts 或 root manifests/lock；这些路径本轮由主线及内部子任务集成。需新增依赖写入 package-local manifest，兄弟包用 workspace:*，把 root lock 请求交主线。

## 接口检查点

先提交本包导出的 TypeScript port，再连续实现。建议导出 `prepareEnvironment`/`PreparedEnvironment`/`EnvironmentPreparationError`；这是包内 port，不另造公共 wire schema。输入必须含已由主线授权的 projectPath、workspacePath、稳定 requestId、AbortSignal，以及显式策略 `existing_only` 或 `offline_install`。输出为 ready/blocked、可复现的环境指纹、诊断/证据引用、环境变量白名单与清理句柄。不要在模块内创建 Work/Ticket 或写产品数据库。

## 实施要求

1. 结构化读取 package.json 和对应 lock，识别 node/pnpm/npm 项目、lock 与 packageManager 版本。未支持的 workspace/链接形态明确 blocked。
2. 默认禁止网络、自动升级包管理器和生命周期安装脚本。需要安装时仅离线、frozen lock、ignore-scripts；缺少缓存时给出可操作 blocked 原因，不偷换为联网安装。
3. 原项目及其 index、lock、node_modules 必须保持不变。准备发生在本次私有 worktree/环境目录。不能用一个会把写入导向原项目的 node_modules 链接假装隔离；处理 pnpm 链接时验证 realpath 边界。
4. 环境文件不能混进业务 patch，也不能用改用户 .gitignore、共享 .git/info/exclude 或 Git 配置来隐藏。若需要 workspace 的公开 environment-exclusion port，提交一个 RFC/接口建议，先用同一 port fixture 完成模块测试，主线负责接线。
5. 所有子进程 argv-only、独立进程组、有超时/输出/磁盘上限；取消与失败确认 owned cleanup，unknown 不标 ready。不要读取/复制账号、.env 或 native profiles。
6. 使用包管理器已有实现；不要手写 lock resolver。选型、版本和依赖请求记录在 README。

## 验收

- 无依赖 Node 项目 ready，执行实际 node --test。
- 有依赖 pnpm 项目在已具缓存的受控 fixture 准备后能执行实际测试；原项目/index/lock/依赖树摘要不变。
- 无缓存、错 lock、缺少包管理器、危险外链和不支持的 monorepo 明确 blocked。
- 中途取消、超时、安装脚本尝试、坏符号链接不会污染原项目；没有遗留写进程。
- 环境指纹绑定 lock/版本/策略；同 request 重放幂等，变更输入不复用旧环境。
- 准备后的完整业务 patch 不含依赖/本机路径。接口待主线时用相同 port 的真实 Git fixture，不宣称产品已集成。

允许创建私有临时项目与包管理器离线 fixture；不运行真实模型，不重置全局环境，不执行联网安装。交付 branch/commit/base、owned files、实际命令/结果、证据、依赖请求和主线消费步骤，只 push 自己分支。整包完成后交一次结果，不逐小修复停工。
