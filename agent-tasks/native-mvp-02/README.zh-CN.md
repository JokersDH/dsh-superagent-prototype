# Native MVP 第二轮：真实依赖项目与故障验收

**主线接线更新：** A `c005820` 已按包准入，B `2d71382` 的两项工具阻断已复验通过；新的环境准备/状态/验证/工作台入口已实现，见 [0012 集成记录](../../docs/rfcs/WP-16/0012-environment-product-integration.md)。A 继续消费复验，B 可按 B-R4 使用最新 main；不要继续沿用“环境接线未发布”作为全部验收的阻断。原轮次结果按日期追溯。

**当前执行入口（2026-11-10）：[带依赖项目收尾批次](release-closure.zh-CN.md)。** A/B 提交仍为 `b6dd261` / `e392fc5`，尚未修复 0011 的准入失败。本批按 A-R1–A-R4 / B-R1–B-R4 / 主线接线连续推进，先通过单包产品出口，再恢复 P2 扩展。下文是第二轮历史与原范围。

日期：2026-11-09。产品基线：`origin/main` 的 `1f3229f`；A 候选 `f1d4b1f`（实现 `5a8f677`），B 候选 `0e62a3d`。本轮任务取代 native-mvp 第一轮任务，保留原 worktree/分支及提交历史。

**扩展执行入口：[持续开发队列](extended-run.zh-CN.md)。** 用户离开期间按 A1–A6、B1–B6、M1–M6 连续推进；原整包交付是稳定检查点，随后继续 P1/P2。目录归属、模型额度和准入边界保持明确，不逐项等确认。

**最新复核：[扩展检查点准入](../../docs/rfcs/WP-16/0011-extended-checkpoint-review.md)。** A `b6dd261` 原五项已通过，但三项清理/进程/输出失败仍阻断；B `e392fc5` 自测 14 项通过，但新增工具复现暴露误报，B2–B6 未按完整范围验收。按该复核先修准入，不把 final 文件视为整包完成。

## 当前核对

| 范围 | 实际结果 | 结论 |
| --- | --- | --- |
| 主线已有 MVP | 真实 Codex 后端 5 场景、浏览器 6 场景通过；单执行器、无依赖 Node 项目 | 继续保留；不是完整 G2 |
| A 环境模块 | 包内 12/12、typecheck/build 通过 | 有可复用实现，尚未接入产品 |
| A 独立准入 | 五项新增环境检查均失败，见 `reports/releases/native-followup/environment-admission.json` | 未通过前不启用真实项目安装 |
| B 验收框架 | selftest 8/8；本轮对现有主线只读 5 PASS、原生 7 NOT_TESTED | 原生实现和真实故障验证尚缺 |
| B 契约复核 | 构造命令不符合共享 schema、选项目不检查 profile、丢必需人工标准、native 分支固定跳过 | 下一轮需先闭合这些缺口 |

A/B 第一轮都基于 `cef31c4`，早于真实 MVP 发布。先合并最新 main，不能继续沿用“主线未发布 native 接口”的旧假设，也不能把旧 runner/workspaces 实现覆盖回主线。

具体复现命令、结果和限制见 [主线复核交接](../../docs/rfcs/WP-16/0009-native-followup-review.md)。本轮不要求重做既有 MVP，也不因包内自测通过就提前启用依赖安装。

## 三个大包

- [A：可准入的环境准备](agent-a-environment-admission.zh-CN.md)。仅改 `packages/environment-preparation/`。关闭独立复现，提供可序列化归属凭证、环境复验和安全进程注入 port，完成单包 pnpm 离线环境验收。
- [B：可执行的原生验收](agent-b-native-acceptance.zh-CN.md)。仅改 `tests/native-acceptance/`。把 native TODO 变成实际流程，验证完整交付、失败拒交付、真实停止、重启不重派及当前候选；结果分明、请求有预算。
- [主线：环境与产品集成](main-integration.zh-CN.md)。负责 workspaces/verification/application/coordinator/console、共享 DTO/root lock 和跨模块修复，把 A 的环境真正串到编码和交付里，消费 B 的独立复现。

## 协作方式

每人先提交一个稳定接口/执行检查点，然后连续完成整个包，不逐个修复等批准。A/B 只 push 自己分支，不 push main。主线只消费明确提交和独立通过的范围，不整枝合并旧产品源码。

开工时使用各自原 checkout 执行 `git fetch origin`、`git merge origin/main`，有本地改动先正常提交或保存，不 reset/clean。自有路径逐处合并；已验收产品路径如发生旧版本冲突，应保留 main 的实现，不把旧候选重新覆盖回来。根 lock 的解决由主线统一处理；确有跨模块语义冲突，用包内 RFC 给出具体缺口后继续可独立工作。

依赖：A 的早期接口可供主线编写接线/fixture；真正启用环境准备需 A 准入通过。B 的已有 native 基础验收可立即在最新 main 的私有实例运行；带依赖产品验收等待主线接线。B 的故障复现交主线修产品，B 不在测试目录复制运行时实现。

完整 G2、第二执行器生产实现、自动学习和跨 harness 团队不并入本轮关键路径。先交付能对真实单包依赖项目完成开发、并具备独立故障证据的版本；受限 workspace 和新执行器验收工具按扩展队列 P2 独立交付，不阻塞 P0。
