# B：原任务执行、恢复交付与真实多槽的整块工程

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`。
保留 dirty/history/state/ledger，fetch 并合并最新 `origin/main`，固定实际 source 后开始。
先读 AGENTS、START-HERE、product-spec/README 和[本轮 README](README.zh-CN.md)。
再读[0083：主线已交原登记端口](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[0084](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。
以[本轮独立验收](../../reports/releases/wave33-admission/runtime-channel.json)为准，不沿用旧缺口列表。
建立或继续一个覆盖下列三项完整成果的工程 goal；不设置工时、同日完成或 token 承诺。
早、中、晚尽早提交可运行 source，交一个检查点后继续整块实现和独立队列，不等待逐项派工。

## 已交事实与归属

- main `fc38` 已提供真实 `RunningAttempt.attachPort`：原 register、ready、current 通过后返回原 endpoint/producer 的独立 clone。
- main 已有新 attached caller，四项 main-only real Store/ingress 消费者通过；不是原 Application/QuestionBroker 恢复证明。
- 实际类没有 `this.handle`。不得再以 RFC 旧示意中的该字段或“main 没提供登记”为由等待。
- numeric PID、literal handle copy、payload reference/body、H launch command、main terminal lease 的旧反例已关闭，不重派这些修复。
- 剩余工具问题：无真实 spawn 的普通 `{pid, spawnfile, spawnargs}` 对象仍能登记并获得 signal authority。
- B 管 execution/catalog/policy-preparation/driver-kit/testing/drivers、Runner 和 native-acceptance 原路径。
- 明确排除 I 的 `apps/runner/src/attach-channel/` 与 `apps/runner/test/attach-channel/`。
- main 管原应用授权/组合、共享契约/root/config/lock/HTTP/App/transport；A 唯一生产迁移，E 唯一产品断言。
- 不复制另一 coordinator、ledger、queue、候选表或执行生命周期，不 wholesale 合历史分支。

## 成果一：不可伪造出生证明与原应用三回调接线

完整出口：实际原 Application 创建的 Work，经原登记 Runner 和原 Store/QuestionBroker 完成三回调、提问与控制。

- 工具 authority 从原 spawner/factory 私有 provenance 发出，保留原 ChildProcess 和不可伪造 opaque handle。
- 普通对象、JSON、复制 metadata、任意 PID、同 argv 的第二进程均不能收编为原 spawn。
- 首次与每次 signal 核完整 PID/start/UID/full ordered argv/root/config/operation 和整个所需资源集合。
- UNKNOWN、birth 不完整、资源遗漏保留材料；纯 mock 先过，不为“证明安全”运行 live SIGKILL。
- 同时消费 main 已交 attachPort，原注册 dev/ino、producer、Work/attempt/contract/fence 保持不变。
- 实际 fact 回原 A business ingress/UoW，receipt 从原 Store 取得；payload 回原 immutable reference/body。
- native intent 调原 main/Broker fresh guard，保持原 command digest、目标、版本和 live answer admission。
- caller 的 void/throw→allowed wrapper 必须 try/await 原 guard，成功才 allowed，拒绝或异常为 false。
- 不复用旧 allowed nonce，不把 sink、登记、ready、旧设置或端口存在当执行许可。
- 实际原 Question/version/native target 回答到原 delivery；fact fixture 或等价 guard 不替代原业务。
- 补原 `feed`/控制 transport 的实际调用。若须 additive Node-local 路线，先 RFC 给 main 审核，复用既有 RunnerCommand。
- 不改 frozen wire，不加私有业务命令、HTTP 执行授权或第三命令台账。

实际消费者与验收：

- 一条同 run 的原 Work/Store/Broker/Runner/client 纵链，实际 begin/question/payload/fact/answer/control 可追溯。
- 正向三回调原 ID/body/receipt 连续，原问题答案准确 native_applied 或保留确实未知。
- 负向 forged spawn object、旧 lease/nonce、foreign producer、错 target/version/body、缺/deny/throw guard 在副作用前拒绝。
- 每个工具负例记真实 spy0；每个业务负例记原 receiver/guard/effect/Store 计数，不只匹配错误文案。
- 发布实际接口、消费者和 source/命令/exit，让 main/H/I 可复验；不得只交工具小修后停止成果一。

## 成果二：同一原 Work 中断后续接到明确交付

完整出口：原任务中断后继任仍使用同一原 Work/Runner/问题与原账本，最终完成机器检查、候选和人工接受。

- 优先实现有限 controlled 中断、传输脱离和新 consumer 续接；不以 live SIGKILL 作为开工或交付前提。
- 原 Work/Ticket/Assignment/attempt/session/request/contract、Runner/child 和 immutable 注册不换身份。
- 继任读原 Store 的 current binding/commands/dispatch/observations/question/answer/payload，不加载手工拼接恢复 JSON。
- 实际 native 写前仍走原 fresh guard；挂起 intent 跨接管为 indeterminate，不迁移旧批准。
- 真实 before-write、receiver 后 ACK 前、receipt 前后窗口分别识别 not_seen/intent/observed/unknown。
- 已接收/已应用不重发；UNKNOWN 不更换 ID、不新 Work、不退款/清 ledger，不把 sent 当 quiescent。
- 同一恢复 Work 继续原冻结 artifact/manifest、registered check、完整资源 barrier 和 currentCandidate。
- 只经原 Application 的显式 accept_candidate 完成交付，不新 candidates 表或 accepted 标志。
- 等待 `actions.available` 包含 `accept_candidate`；currentCandidate 提前出现不代表机器/人工门已满足。
- 明确 actor 与受控 fake，不能把测试人工动作冒充实际用户审阅或质量收益。

实际消费者与验收：

- 同一 run 的原 Work→question→answer→ACK→artifact→check→candidate→acceptance 可贯穿前后进程/连接。
- 正向恢复到同一原候选并显式 delivered，工件/location 可读，重开后结果相同。
- 负向旧合同/epoch/问题版本/候选/许可、冲突 body、晚 ACK 和未知资源拒绝，不产生替代执行。
- 外在资源只观察完整独立 proven own 集合；未安全准入只做纯注入/无 signal controlled 场景并准确记未达。
- 普通新 Work 的 5PASS、读回原行或四个 channel 都不能替代本成果的原业务恢复。
- 交可运行 source 后继续资源、多槽与持久收尾，不以一次重连或一个 JSON receipt 收工。

## 成果三：原两/四槽调度、取消、归还与重开

完整出口：原 scheduler 的实际 2/4 槽混合执行、等待、取消、未知与恢复能够稳定前进，并以完整资源证据归还容量。

- 使用原 Application/Execution/queue/binding，不把 Work 列表数量或四个独立 channel 称四个调度槽。
- per-slot 原 producer/credential/generation/cursor/payload/receipt 隔离，保留原背压和控制优先级。
- 必须观察第五项真实等待/拒绝与已证结束后原 queue 前进，不能直接写 DB 释放 slot。
- 原 process/child/socket/fd/timer/waiter/queue/journal/Runner 集合完整，UNKNOWN 或缺证不归还。
- cancel/stop 复用原 authenticated control→physical lifecycle→fresh full-resource barrier，不新增 stop owner。
- 控制中中断、重复控制、部分退出、晚 ACK 和旧 client 不影响其他槽或复活旧许可。
- 原 Store 重开后 ended 不复活、UNKNOWN 不重发、候选与交付来源连续，原 queue 准确继续或 held。
- 给 main/D/H/E 完整必要 source/consumer/操作材料；安装结论由精确冻结包的 D/E 独立验收决定。

实际消费者与验收：

- 实际原 2/4 attempt、峰值/开始/结束资源与 queue/binding 状态相互对应。
- 合法正向、超容量、跨槽身份、未知 writer、控制重入和迟到事件都有独立对照。
- only module-close、parent-gone、JSON plan 或单个 PID 不构成 aggregate quiescence。
- 受控与 native、source 与 installed、普通与 recovered 分列，未达就保留原材料和准确入口缺口。

## 独立备选队列

- 原端口已交，立即消费；其他共享接口不足给最小可编译 consumer/RFC，同时继续 owned 实现，不另造 authority。
- I/H 输入只阻对应验证项；继续实际正常三回调、控制、原数据、错误/兼容/操作文档。
- 安全未过不跑 signal，但不冻结无 signal 接线、机器检查、人工接受和多槽工程。

## 整包完成条件

- 状态写 `tests/native-acceptance/reports/wave33-status.json`，含精确 source/inner/outer 身份、命令 exit、正负和未达。
- 三成果均须有实现、实际产品 consumer、必要正负与主线可整合源码；检查点发布后继续整个 goal。
- 只提交显式 owned paths 到原 origin 分支，不 upstream/reset/清状态；保留两旧 report diff、b16 和全部原数据。
- vendor/model/native 自动调用0；B cap4 UNKNOWN 不可花，E 原 pilot BLOCKED，不 reset/topup/refund/补样/价格研究。
- 保留十二用户实例 5180/8796 至5191/8807 及所有 state/profile/tar/ledger/history/dirty。
- 无 global discovery、substring kill、外来凭据/真实 CLI fallback；只有独立 proven own 全集合才可必要有限操作。
- 无新 Driver/CAC/桌面/自动接受/writer racing/动态 DAG/第二生命周期；完整工程不缩成临时 ZIP 交付。
