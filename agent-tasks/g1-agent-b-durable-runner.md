# Agent B 下一批：持久 Journal、严格载荷与重放

阶段：G1 完整闭环的运行时部分。`40ae102` 的 98 项测试及原先所有补充复现已由主 Agent 复跑通过。接下来把已通过的单进程能力变成可恢复交付；仍不接真实厂商 Driver，不宣称整个 WP-03/G1 已完成。

工作目录仍为 `/Users/hh/Desktop/joker/superagent-agent-b`，继续 `codex/g1-runtime`。先保留改动、fetch/merge 最新 origin/main。拥有 execution/driver-kit/testing/runner 与本包 ADR/RFC；不能改 storage 迁移、contracts、core、coordinator 或根 lock。

## 第一批提交：严格 FakeDriver 与每 Attempt 隔离

1. FakeDriver 产生的每个 critical payload 必须通过现有 `parseRuntimeFactPayload`。目前 question/answer 样例只是简化对象，不能通过权威入口；请补齐标准 UserQuestion/AnswerDelivery、原生 wire ID 类型与 binding，不能在 ingress 加宽松旁路。
2. ControlledRunnerHost 支持按 AttemptSpec 创建独立 RunnerOptions/ProcessHost/journal/可信 sink；不能因复用一份 options 把两个 attempt 的资源或 ACK 上下文共享。保留单 options 的兼容 fixture（若需要），真实组合使用 factory。
3. feed/record 边界校验完整冻结 RunnerCommand/CriticalFact tuple；跨 Ticket/contract 的输入在产生原生动作前拒绝。Supervisor 的本地诊断预检不能挡住权威入口对已知重复回执/旧物理观察的处理。

## 第二批提交：FileCriticalJournal 与稳定重放

- critical fact 先写本 Runner 的有界磁盘 journal，确保 crash 后还能按原 factId/payloadRef/身份重放；payload 也必须具备同等可恢复引用，不只存在内存 Map。
- 平台已持久化 ACK 与 Runner 本地 spool 接收分开。DB/入口不可用时不能返回假的 DurableReceipt.persisted=true；保留 pending，阻止会丢关键事实的新业务，并允许安全 cancel。
- 已获 ACK 的事实不重复产生业务；重启/重连不能重置 seq 后复用旧 factId。给出断点/校验和/partial-tail/capacity 的格式与恢复规则。
- Replay 只重送事实，不重发 begin/prompt/tool；原生执行状态未知时调用只读 reconcile，不能把启动新 attempt 当恢复。
- 本轮可先完成 Runner journal 级别恢复。跨 coordinator 崩溃后重新绑定独立 Runner 的 IPC 认证/进程拓扑属于后续联合验收，明确未测范围。

## 必须验收

保留原 98 项。新增两 attempt 隔离、所有 FakeDriver 场景的严格 payload parse、写 journal 后/ACK 前退出、ACK 后退出、重复 replay 同回执、截断尾记录、容量不足、旧 epoch replay只留物理证据、coordinator sink不可用时无假 ACK，以及 restart 不产生第二次原生 begin。

第一批可独立先交付；第二批与主 Agent 的 `createRuntimeIngress(...).bind(producer)` 配合。生产 DB/绑定/资源观察由 A 提供，不能在 runtime 自开第二写库。每个可复验批次提交/push，报告真实命令和未测项；不要越过本任务开始厂家协议适配。
