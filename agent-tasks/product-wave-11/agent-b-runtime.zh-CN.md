# B：真实持久控制与可消费运行时长整包

原目录`/Users/hh/Desktop/joker/superagent-agent-b`，原分支`codex/g1-runtime`，仅原runtime/driver区域。先读README/0035并合并最新main；旧七case修复保留，main实际策略还要求exactOptional。真实模型/native0，B旧UNKNOWN cap4不可花。

## B1 完成实际消费者类型与输入拒绝

复跑main probe-wave11-runtime，按main strict+exactOptionalPropertyTypes修134/161两条错误，使用准确optional构造，不关闭规则或扩成any。structuredClone失败必须在reserve/transport前确定拒绝，不能发送refused占位对象。补实际main/coordinator消费类型与public export测试，push早期可运行checkpoint。

## B2 结构化可执行解析与脱敏诊断

弃用shell字符串拼command-v，使用repo已有可信进程API/明确argv查找并验证绝对路径、PATH、空格/中文/symlink、缺文件/不可执行/版本不符。只调用无模型的version/本机只读inspect，不重置账号或升级全局工具。默认输出脱敏；私有路径明确opt-in，支持包不能顺带导出凭据。

## B3 真实认证proof与当前资源消费者

沿用VerifiedRunnerInspection单一WeakMap、current-binding与完整registered manifest；对complete/partial/stale/foreign attempt/machine/serving/closed正反例给真实socket消费者。summary只观察，普通JSON、空资源集合或旧state不能放行屏障。给main/D稳定接口，不另造proof或SQL权威。

## B4 有限接通B/E拒绝协议

和E选一个准确request envelope，实际flat/nested字段、reservationId与no_send reason必须一致。main新probe的entry mismatch要关闭，缺bound仍0真实send；clone、transport方法、并发token、unknown不退款继续覆盖。不调查新价格/协议/第二Driver，不运行B9或试点。这个阶段完成后继续生产控制，不持续打磨研究框架。

## B5 真实SQLite与子进程控制基座

将B12“重建内存对象”限定报告改正，使用已有A ports、真实独立Runner/协议fixture进程、临时SQLite/journal进行start/stop/answer/steer。case必须操作被测对象：stop-before-start真正暂停在start barrier前，不能await start后再改标题。旧函数不必强加recover名；使用现有生产恢复入口。

## B6 SIGKILL、重建与不重复发送

在begin写入前后/问题登记前后/answer传输前后/stop ACK与writer退出之间精确注入，杀掉本次coordinator或Runner，再由新进程读同一SQLite重建。证明command/attempt/epoch/原问题identity不丢、不重复begin/deliver；“没有第二次调用”必须伴随原进程/资源可恢复或准确blocked，而非attempt_not_running空通过。

## B7 跨重启epoch与unknown重验

验证连接epoch/high-water实际持久化；原proof不能释放新attempt，旧native RPC ID不会指向新会话。缺A/core接口交最小可运行RFC和已证实需求，不自建ledger/数据库。并行完成旧unknown send reconcile、已结束attempt、过期问题与断线backpressure矩阵；真实vendor始终单列NOT_TESTED。

## B8 接主线目标和版本能力诊断

消费main target prepare/read与随后activation消费者，用受控旧active/indeterminate writer证明新generation不抹掉屏障；无历史资源只在可信完整源集合下处理，不靠空普通JSON。验证当前profile指纹/注册检查/host policy变化后的拒绝及可操作诊断，副作用仍由原Runner承担。

## B9 多槽位、输出上限与可恢复退化

用有限真实临时进程做2/4槽位队列、输出截断、超时、取消、关闭/reopen、失联和资源清理；统计FD/子进程/queue是否回到基线。每场景固定任务数/超时/停止条件，遇新失败保留最小重现，不无限重跑。B只证明受控运行时，不写全产品PASS。

## B10 回归与可组合交接

交actual public types、真实SQLite/IPC矩阵和原b11/b12层级，维护`tests/native-acceptance/reports/wave11-status.json`。阶段4–6交组合source，最终含完整commands/exit/base/hash/限制/预算历史。只push原分支，不改coordinator/console/contracts/root lock/E断言，九组服务不动。

## 独立备选队列

- 类型、clone/codec、空格路径、脱敏及provider输入边界。
- 真实临时Runner IPC/输出/取消/fault-injection，不等主线UI或付费任务。
- 现有A连接/queue/journal上的跨进程矩阵，不等新数据库。
- public adapter文档、准确NOT_TESTED分类及性能/泄漏数据，不重复费用研究。
