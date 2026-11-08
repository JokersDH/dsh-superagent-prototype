# 第二轮整包开发：从基础能力到可操作闭环

日期：2026-11-08。核对基线：主线 `57fd8ed`，A `fcf3273`，B `74a3068`。本轮改变派工粒度，不改变已记录的验收结果。运行测试证据沿用对应提交的独立报告；本次规划不把未测功能记为完成。

## 1. 整体进度

当前是 **G1 后端基础能力验收中，G2 可使用闭环尚未形成**。不按测试数量或设计文档页数估算产品完成百分比。

| 能力 | 当前事实 | 剩余工作 |
| --- | --- | --- |
| G0 复用、选型、公共契约 | 已按 darwin/arm64 限定范围接受；contracts v1 与 hash 已冻结 | 后续契约变化仍由主 Agent 统一处理 |
| 正式 core | 已集成；历史证据为 legacy 144 + 新守卫 34 | 应用入口及最终跨模块完成验收 |
| SQLite、事务、回执、Effects、观察 | 已集成；存储 66 项历史证据 | 面向 Work/合同/消息/问题的产品仓储尚缺 |
| 主线登记、恢复、队列接线 | 已集成；56 项、6 个真实 SIGKILL 窗口，干净 checkout 复验通过 | 当前独立服务是受控 ProcessHost fixture；实际 AttemptRunner 进程接入待完成 |
| A 工作区和验证候选 | 8 + 19 项及旧六项探针通过；尚未合入 | 当前运行指针/epoch、真实 host 完成证明来源两项边界失败 |
| B Journal/运行时候选 | 148 项及旧七项探针通过；仅 ProcessHost 观察文件已集成 | 终止符、严格 envelope、损坏文件前缀重放三项边界失败 |
| QuestionBroker、ApplicationService、HTTP/SSE | 尚未实现产品模块 | 主对话归属、集中问题、确定性操作、产品入口 |
| Catalog、策略准备、原生 Driver | 尚未实现产品模块；三个目标均无产品兼容证明 | 首个 Driver、原生权限/提问/取消/恢复证据 |
| 工作台、CLI、运维、学习创新实验 | 尚未交付 | 本轮启动工作台；CLI、第二协议、学习实验等另列后续出口 |

现有测试主要证明受控场景的稳定性。还没有可以日常使用的完整助理，也没有原生 vendor、断电或负载稳定性认证。最新故障证据在 [G1 状态](../../reports/releases/g1-status.json) 和 [主线交接](../../docs/adr/core/g1-registered-recovery-handoff.md)。

## 2. 三个完整交付包

| 负责人 | 大块任务 | 本轮交付终点 |
| --- | --- | --- |
| [Agent A](agent-a.zh-CN.md) | 可信交付 + 产品持久化 + 可操作工作台，覆盖 WP-02 增量、WP-04、WP-11 首版 | 后端证明与数据接口可集成；浏览器里能操作委托、问题、停止、验证交付及恢复场景 |
| [Agent B](agent-b.zh-CN.md) | 可恢复运行时 + 接入平台 + 首个 Driver，覆盖 WP-03、WP-06、WP-07 首版 | 实际独立 Runner 支持恢复；Catalog/策略 gate 和 Codex Driver fixture 闭环可集成 |
| [主 Agent](main.zh-CN.md) | 问题中心 + 应用/HTTP + 跨模块集成，覆盖 WP-05、WP-10 确定性首版、WP-16 | 把 A/B 的能力串成一条真实产品路径，并独立验收 |

整包里的步骤是执行顺序；不需要每完成一个步骤就请求下一条指令。原来的两份小修复任务仍是首阶段回归清单，完成修复后继续本包。

## 3. 只保留两个交接点

1. **可消费接口检查点**：A 提交后端修复和产品仓储；B 提交完整性修复、Runner 服务/桥接接口与受控进程样例；主 Agent 提交应用 transport/fixture 及数据接口适配。每人各发一次 commit、导出 API、运行命令和依赖清单，随后继续自己包内的独立步骤。
2. **整包交付**：交完整实现、测试、证据、未测项和集成步骤。主 Agent 按检查点 commit 拉取、复验、集成；模块 owner 继续修自己的问题。

检查点是供别人消费的稳定提交，不是等待批准的停工点。允许分阶段 commit/push，禁止把正在修改的文件当共享依赖。A/B 不合并或推送 main。

进度随代码写入固定路径：A 使用 `packages/verification/reports/wave-02-progress.json`，B 使用 `apps/runner/reports/wave-02-progress.json`。记录每阶段状态、已测试源码 commit、接口检查点、命令/证据路径、依赖与剩余问题；未跑/未接线单独标注。主 Agent 可直接 fetch 读取，避免让用户反复转述状态，不要求每次更新都发消息。

常规接口/实现/测试选择由 owner 自行决定。只有需要改变共享 wire 契约、突破所有权、执行未授权破坏性操作或缺少真实账号/预算时才升级。缺口一次汇总到本包 RFC，同时继续 fixture、测试和其它独立步骤。外部条件不足只阻断相应 native/生产验收，不阻断整个包的开发。

## 4. 共同接口与依赖

- wire 唯一来源是 `packages/contracts/` v1；以实际 runtime schema 为准，旧草案中的 `retryClass` 等名称不能代替实际 `AppError.retry`。
- 数据、UI、Runner 的边界见 [本轮集成约定](../../docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md)。它描述待交付的内部 API，不代表接口代码已经实现。
- A 是全部产品迁移/仓储 owner；主 Agent 写应用和 Broker 语义，不在它们里面建表；B 不持有产品 SQLite writer。
- 根依赖/锁和公共 schema 仍由主 Agent 统一集成。A/B 可改自己新 package 的 manifest；安装产生的临时根锁差异不提交、不用于覆盖别人的改动。
- 主 Agent 优先消费 A 的产品仓储检查点。A 做 UI 时用同一 HTTP 形状的 fixture adapter；B 做 Driver 时用共享 FactSink/AttemptIO 的受控 bridge，均不等待完整产品上线。

## 5. 共同验收出口

**G2-Demo-Fake**：从实际网页发起一个 scratch 项目的工作，经过产品 HTTP、ApplicationService、core、真实 SQLite、独立 Runner、fake native 子进程；问题回到主入口，答案逐 target 可追踪；产物冻结、检查和当前候选 gate 决定交付。刷新网页和重启 coordinator 不重新 begin，停止如实显示物理状态。

**G2-Native-Preview**：在同一产品路径上替换成第一个真实 Driver。只读版本/schema 探针可先执行；模型任务需要已授权 scratch 与预算。未运行的 native 用例保持 NOT_TESTED，不能用 fake 的 PASS 声称原生兼容。

本轮范围不包含三个真实协议一起稳定支持、完整 CLI/发行、CAC、向量库或自动学习推广。第二协议、两项目日常使用、运维/备份和创新实验按原产品计划继续。

## 6. 一次性转发

给 Agent A：

```text
继续 /Users/hh/Desktop/joker/superagent-agent-a 的 codex/g2-workspaces-verification。保留现有改动，fetch 并合并最新 origin/main，读取 AGENTS.md 和 agent-tasks/wave-02/agent-a.zh-CN.md。按整个大任务包连续完成，不在旧的两项修复后停下；提交一次后端接口检查点后继续 UI，最后统一交付。只提交自己的路径，不改根 lock 或 push main。
```

给 Agent B：

```text
继续 /Users/hh/Desktop/joker/superagent-agent-b 的 codex/g1-runtime。保留现有改动，fetch 并合并最新 origin/main，读取 AGENTS.md 和 agent-tasks/wave-02/agent-b.zh-CN.md。按整个大任务包连续完成，不在旧的三项修复后停下；提交一次运行时接口检查点后继续 Catalog/策略准备和首个 Driver，最后统一交付。只提交自己的路径，不改根 lock 或 push main。
```

本页与任务文件已准备好供转发；没有自动向外部 Agent 会话发送消息。原 G0/小修复文档保留用于追溯，当前执行顺序以本目录为准。
