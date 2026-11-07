# Agent A 下一步：WP-04 工作区与可信验证

你上一批 247339b 的存储 66 项测试及类型检查已在独立 checkout / Node 24.22.2 复跑通过，运行状态和观察仓储可供 main 组合。存储迁移职责仍归你；本任务可以与 B 的 Journal 入场修复并行，最终接受仍需运行时集成。

先保留本地修改并合并最新 origin/main；在同一工作目录从集成基线新建 `codex/g2-workspaces-verification`。阅读 `product-spec/tasks/WP-04.md`、core README 和当前完成 gate。允许新增 `packages/workspaces/`、`packages/verification/`、`docs/rfcs/WP-04/`；如需存储 schema，仍在你拥有的单一迁移入口追加版本，不改已发布 checksum。contracts/core/coordinator/根 lock 只读。

## 可独立交付的第一批

- 临时 git 项目的 worktree reserve/freeze/release；记录 base commit、dirty diff、artifact digest、环境与所属 Assignment，不改写用户原工作区。
- 注册的检查定义：命令/argv、目录、允许环境、deadline、输出上限和定义 revision。外部文本/worker 自述不能变成任意 shell 检查。
- Verifier 对冻结候选执行实际检查，输出契约 Verification，并使用 core `completionCriteriaDigest`。包含真实失败、超时、缺依赖、SKIPPED 和不适用的明确结果；不替 core 宣布完成。

## 第二批：可信完成证据接口

按 core `CompletionVerifier.resolve` 提供只读、同步、同连接的可信记录 adapter（生产记录需要你自己的迁移）。机器结果必须对应当前 CandidateRef、artifact 和 criteria；人工接受是另一份真实来源记录；writer quiescence 必须来自运行时的实际核对，不从 agent 文本或 parent exit 推断。

与 main 协作：你提供记录/验证/工作区 interface，main 连接实际 runtime 观察和 confirmCompletion。若接口缺口，提交最小 fixture/RFC，不增加新的 Work 状态机。没有真实静止证据时可以保留 pending/NOT_TESTED，不伪造一个 true 让完成 gate 通过。

## 验收

运行 WP-04 的相关用例；重点覆盖冻结后被改、旧 generation/旧 artifact 的结果不能采用、必需检查失败时人工接受也不能越过、dirty 用户内容不被 reset、输出/超时有界、验证期间新增输入导致旧候选失效。先完成 fixture/临时项目测试，不运行用户生产仓的任意命令或自动 merge/deploy。

分批提交/push 自己的分支，提供可运行例子、依赖请求、测试结果和主 Agent 接线步骤；根锁文件临时变更不提交。
