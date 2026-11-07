# Core 复用静态评审

日期：2026-11-07。只读源码和测试分析，未执行提取或改动生产代码。

## 结论

应以原 `src/core/**` 作为唯一 Ticket/Assignment 内核。Work 只保存用户根索引、不可变目标版本和 Ticket 关联，所有执行阶段均投影，不另建 WorkKernel 生命周期。

原 core + stage 测试已由主任务在原仓执行，2 文件、144 测试通过；独立 harness 的 R0 没有执行，不能把 reference 结果当作已经可移植。

## 必须修正的复用差异

### P1：ready 会提前结束本地 Ticket

证据：`src/core/assignments.ts` 的 `report` 在没有 follows 时以 completed 调 `Tickets.end`。本地任务不绑定 PR，直接搬用会在最终验证前终结。

决定：显式 opt-in completion gate，个人 Ticket 的 raw ready 保持 open，可信 verifier/用户接受带当前 Assignment 与 candidate generation 完成 core Ticket。legacy 默认只为上游兼容保留，产品 factory 必须强制启用 gate。

不采用把验收伪装为 GH merge/close 的 Thread；现有 threadClosed 只表达 merged/closed，语义不匹配。

### P1：逻辑 stop/retry 先于实际 writer 停止

证据：`src/core/tickets.ts` 的 `end` 先结束 Ticket/Assignments，再调用 Executor.stop；retry 也先创建新 pending Assignment，再排 stop/start。

决定：保留授权立即撤销；SupervisedExecutor 必须维护原生静止证据和新 launch 屏障。UI ended 不等于 OS 已停止。旧 writer 未确认时不复用目录，也不重复有外部写的业务。

### P1：report 缺少 Assignment 身份

证据：`Engine.report(ticketId, report)` 与 `Assignments.report` 自动取当前 running/latest Assignment。旧 runner 的迟到报告可能被记到重试后的新 Assignment。

决定：新增 fenced report 入口或严格单一 trusted gateway，生产 worker 必须提供当前 assignmentId 与绑定；推荐 additive core 方法，防止将来新 adapter 绕过应用约定。

### P1：退休的已结束旧 Ticket 仍可能恢复

证据：stop 对已经 ended 的 Ticket 不会改写其 ended.by；原 intake 支持人在已结束且非人工停止的 Thread 上发消息后恢复。

决定：新目标使用新授权 Ticket；LocalSource/PersonalPolicy/attach guard 检查 active revision，阻止旧合同恢复。停止屏障完成前只保存用户修订事实，不开始新域工作 Eval。

### P1：原 Effects 的重试假设不能直接用于未知 RPC

证据：原 `Effects` 对 handler 异常重试；原生已接收但回执丢失可能再次执行。

决定：复用 queue 算法，handler 将未知发送保存为 DispatchReceipt 并转只读 reconcile；原业务 effect 不盲重发。

### P2：Store/Outbox 不能整包声明独立

证据：Store 的 migration/notices 引入应用和 DSH executor；Outbox 引入 SourceRegistry/Commands 与 Feishu 长度规则。effects/store/outbox tests 也使用不同程度的应用 fixture。

决定：复用领域 SQL、savepoint、receipt、generation 和队列行为，替换有限的装配依赖；本地产物、原生 Question 答案和 Channel 文本分别记录，不能复用三态消息回执冒充 native_applied。

## R0 通过条件

1. 精确 core slice、最小入口、来源与许可证记录。
2. runtime/type import graph 不含 `@deepseek-ai/*`。
3. 独立包运行原 core-engine/stage 测试，保持全部断言。
4. 后续扩展以新语义测试驱动，不通过删除上游断言掩盖差异。
5. 再进行真实存储/queue parity、物理停止与原生兼容；不把 R0 当作完整产品验收。

## 最终检查

本设计没有引入第二个可写的执行状态来源；物理事实表不自行完成工作；验收仍通过 core 结束 Ticket。V1 使用原生 team 能力；V2 内部派生 Ticket 必须保留父授权并验证子范围，禁止伪造 human Trigger。
