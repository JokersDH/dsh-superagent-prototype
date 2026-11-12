# A：实际source预检到非空恢复

继续原A目录/分支，storage/workflows及唯一append-only迁移。读README/0042/0043并合并最新main。旧4、87/105与64位rowid/预算修复已承认；main697efdc已实际使用reader，模型/native0。

## A1 验收已发布的实际HTTP消费者

直接运行main `tests/integration/recovery-logical-source.case.mjs`及原preflight，真实Store/runtime/HTTP验证logicalSource与inspectionFingerprint。正常、未记event业务变化、缺表/未来schema/扫描超限分别读验；这是生产消费者，不再写“source入口整体缺失”。只把confirm/许可另列未到。

## A2 连接一致性和实际预算

对同一只读UoW内状态/reader与另一真实连接、独立进程写入作对照；heartbeat不失效、writer/队列/资源变化必失效。核对实际扫描行、bytes、耗时和64位rowid边界。阶段1–2交实际消费者测试与必要修复源码，不增加第二SQL连接权威。

## A3 精确确认数据参与

继续现有RecoveryActivationFacts/RecoveryIntentCommitter同事务数据；检查精确本笔receipt/body/index/inline event和后来相同body事件。main发布confirm后立即接真实消费者；未到仅该组合NT，纯port测试不称公开确认。逻辑complete不授许可或证明writer停止。

## A4 非空产品恢复正对照

源含合同/work/ticket、原消息/决定、context bundle/绑定/历史、实际reply body/result、receipt/queue/resource。用公共snapshot恢复到新根，main实际读回原正文与request身份；每个打开的Store/连接可靠关闭。不给恢复状态继承可执行授权。

## A5 损坏和遗漏矩阵

缺table/artifact、改变body/hash/index/引用、未知schema/多余表、分页边界与部分manifest均准确拒绝。每个负例配相同流程的非空正例，不由一个共同坏前置使所有用例“通过”。只测实际可能的输入与承诺，不增加无意义限制。

## A6 故障窗口与第二检查点

独立产品进程覆盖source确认、result/message、快照复制/登记前后SIGKILL。重开补原artifact一次，未知不重发；部分备份不能完整。阶段4–6交中期source、准确数据recipe和可独立复验的故障证据。

## A7 动态schema与双版本数据

v15/v16/current迁移和同schema双binary分开；非空FTS/用户写入/回执/上下文/回复均保留。公共required families/schema来自实际版本，历史migration不改写；给D/E准确数据输入，不以恢复activation为普通安装前提。

## A8 真实控制数据协作

B使用现有binding/current/fenceEpoch、question/answer/dispatch/fact stores，跨进程读回原身份。若缺必要读port给main最小RFC，A唯一追加迁移；不为B收据演示补测试表或第二ledger。

## A9 有界规模与消费者图

10000绑定、多项目/会话/work、页间新写和最大非空bundle，记录真实读量与上限。第一页按需正文，超限不complete。consumer map列真实main/B/D/E调用，准确区分inspect/prepare、confirm、target启动。

## A10 数据出口最终交付

全包/实际697efdc及后续消费者、快照/进程/规模有限回归，维护`packages/workflows/reports/wave15-status.json`。早/中/最终push原origin分支后继续；模型/native0，旧迁移/账本/实例保留。

## 独立备选队列

- 实际inspect/prepare已经可测，不依赖新授权或B额度。
- 非空恢复/坏引用/并发快照与规模不等main confirm。
- 控制新port未到先复用既有身份字段，不发明恢复权威。
