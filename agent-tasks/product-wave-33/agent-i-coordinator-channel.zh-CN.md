# I：唯一通信实现、原端口采用与完整故障支持

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、原分支 `codex/g5-coordinator-channel`。
保留历史/dirty/state/ledger，fetch 合并最新 origin/main，固定真正运行的 source。
读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读[0083：main 已交原端口](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[0084](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。
依据[独立验收](../../reports/releases/wave33-admission/runtime-channel.json)，建立或继续覆盖下列三项完整成果的工程 goal。
不设工时、同日或 token 承诺；早中晚交 runnable source 后继续整包和独立队列，不逐小项等派工。

## 已交事实与所有权

- 唯一拥有 apps/runner/src/attach-channel、apps/runner/test/attach-channel 和自己的 runtime-channel docs/reports。
- B 管实际 transport/service/RunnerLink/命令接线/physical lifecycle；main 管原应用 authority 和组合。
- main `fc38` 已交原 register+ready+current 后的 RunningAttempt.attachPort clone、新 caller 和4项 real Store 消费者。
- 原 payload reference/body、numeric PID/handle copy/H command、main terminal 旧问题已闭，不重复派修复。
- 实际 module/core/pull adapter 已合 main；I 新测试和手册必须消费这个实现，不增加并行 pending/queue。
- seeded Store ingress、等价 guard、四 channel 都有价值，但不代表原 QuestionBroker/Work 恢复或四调度槽。
- B 仍有伪 spawn metadata 对象 provenance 工具问题，I 的模块 PASS 不授 live kill 权限。
- 不改 runner-service/RunnerLink、root/contracts/config/lock/HTTP/App/transport 或 E required assertions。
- 不新 server、数据库、ledger、policy owner、恢复 coordinator、调度器或执行生命周期。

## 成果一：实际主线三回调与 typed 兼容完整采用

完整出口：B/main 实际原端口消费者只使用一套通信实现，三类 callback 的内容、相关性、权限与容量均准确。

- 固定 main/B/I 实际 runtime blob 和 consumer source，必要闭包明确，docs-only HEAD 不造假字节变化。
- main 原 attachPort 是原登记的内部数据，不是命令许可；原 current/command digest/live answer guard 仍由 main/Broker 判。
- payload-read 用原 reference，value 为原 JSON body；journal descriptor/chunk replay 是独立既有协议，不混用。
- fact 原 ID/producer/attempt/receipt/UoW 保真，不造 persisted:true/seq 或另一个 receipt 表。
- native intent 保留原 business command.id 与 fresh frame nonce，逐次问原 guard，旧 allowed 不复用。
- 缺 guard、deny、throw、错 target/version/body、foreign producer 和旧 lease 在效果前拒绝。
- kind namespace、settlement/prune、bounded pending/bytes/deadline 继续唯一 module 管，不写第二 queue。
- direct strict/exactOptional 消费原 main ports 与 B adapter，不只编自己的 fixture 或用 any 隐藏不兼容。
- B 如需 additive Node-local feed/control 路线给原 RunnerCommand 的最小调用契约，main 审 RFC；I不创造命令 authority。
- 不引 DriverKit review/budget/diagnostics 模块作为三回调前提，不为采用改 frozen wire。

实际消费者与验收：

- actual main service/B caller 与原 Store ingress/payload/fresh callback 共同消费；合法 allow/deny/missingguard 可重跑。
- 原 Application/QuestionBroker consumer 由 B/main 实现后共同验证原问题；seeded/equivalent component 范围单列。
- 正向三 kind 原内容/ID/receipt、fresh allowance、无旧 stdio 双发；独立 negative 零错 settle/错写。
- 原 journal 2KB有效页预算、真实 seq、descriptor、合法中间 chunk、原 payload digest 可有限复验保持。
- 交 source/typed example/错误语义和必要文件清单，不能只交 adoption manifest 后停止整项。

## 成果二：临时 detach、terminal 与原业务继任共同验证

完整出口：正在运行的原 attempt 可以合法换连接，明确终端则不能复活 lease 或批准 pending。

- temporary transport detach 不等于 terminal；fact/payload 可保原 ID/ref 与剩余窗口续接，native pending 为 indeterminate。
- main finish 调既有 close 的终端语义已闭；terminal 后 late receipt/payload/write-admission 与 rebind 都拒绝。
- 不把缺 id 的非法帧、协议拒绝或客户端本地 stop 伪装成实际服务 shutdown。
- explicit CAS 由合法当前 generation 驱动；旧 A 用原 generation，foreign poll 不改变 owner。
- 旧 client poll/reply/close 不能影响继任，settled/timeout request 不在新队列幽灵重放。
- remaining deadline 从原请求算，不因接管刷新许可/超时，不把 channel generation 当业务 fence。
- 原 B/main consumer 将 callback 接原 Store/QuestionBroker/command reconciliation，I只传 typed 结果。
- before-write、receiver/ACK/receipt 的实际窗口分清 not_seen/observed/unknown，不推断 timeout=未写。
- 已原生写但 ACK 未知不返回 safe-to-retry，不新 command ID、begin 或新 attempt。
- typed timeout/closed/stale/deny/indeterminate 保留；数据可读、channel关闭与物理 quiescence 分开。
- 原 sameWork 恢复到 check/currentCandidate/manualaccept 需要 B/main 原 authority，I不加候选/接受 gate。

实际消费者与验收：

- actual service/endpoint/原 port 与两个真实 consumer 连接验证，模块 fake-clock 结果单独列。
- 正向临时 detach/原数据续接、正常 fresh intent；负向 terminal late/rebind、旧 reply、跨 kind/producer 错结算拒绝。
- 与 B/H 对同 run 原 IDs/Store/receiver/guard 结果核对，不用各自一段不同 demo 拼恢复。
- 不跑 live SIGKILL/procguard；需要 OS 故障的证据只由独立安全 owner 在必要完整 own scope 做。
- 发布可运行 consumer 与故障语义手册后继续有限压力/资源收尾，不等另一轮再做。

## 成果三：有限压力、错误诊断与真实多槽交接

完整出口：原产品多任务运行中，通信容量有限、错误可诊断、资源结论准确，可长期由其他 owner 维护。

- actual B/main 三回调在慢 Store/缺 payload/拒 guard/重绑中施加有限不同边界压力，不靠长 soak 凑耗时。
- saturation 在 send 前拒绝；settle/timeout/drop/rebind/terminal 后 waiter/queue/timer/bytes准确回收。
- 控制请求与慢 callback 的时序可观察，异常不吞成假 ACK/allow，不用延长 timeout 掩盖挂起。
- 每 slot producer/attempt/credential/generation/payload/receipt隔离，不让一槽错误授权、drain 或 close 伤另一槽。
- 四 channel 只证明通信隔离；原 scheduler2/4槽、第五项等待/释放、full resource barrier 仍由 B/main 消费原应用证明。
- 将自己 timer/waiter/queue/handler 的实际结束事实交原 resource owner，不把 module close 授予 aggregate release。
- current/ended/unknown 行为与最终协议/错误分类明确，观察只读不触发工作或给权限。
- 保持原 v1 envelope/typed error/structural API 兼容；新类型不足交 main RFC，不私自复制公共 wire。
- source、controlled、native、recovered、installed与收益分别说明，D/E exact package结果不从源码测试推断。
- 采用手册给 main/B/H 实际入口/原状态来源/调用图/错误处理和必要 source closure，不用无关研究模块扩依赖。

实际消费者与验收：

- 正向 actual source 三类回调在容量边界后仍可继续，原合法接管与终端保持，调用方可准确判失败。
- 负向超容量/超 bytes、错 source/slot/frame、重复/晚 ACK、部分 unknown 与 closed 都有合法对照。
- 测量有总 deadline/输出上限，无残留通信 resources；未结束材料如实保留，不做全局清理。
- 主线新 source 冻结后，D/E consumer 必须用同包字节，source checkout 不替包内缺失入口。

## 独立备选队列

- 原端口已交立即给 B/main 可用调用支持；其原业务链未到只阻对应 proof，继续自己的兼容/故障/压力/文档。
- H独立consumer未到给 exact source/run/接口，不替H或E写独立绿灯，也不建第二 gate。
- B安全工具未准入不影响纯通信工程，不通过 I handle/mock PASS 授权 signal。

## 整包完成条件

- 状态写 reports/runtime-channel/wave33-status.json，记 actual source/inner/outer/commands/exit、已合 main 与仅候选。
- 三完整成果各有实现/实际 consumer/正负/source；早中晚检查点后继续一个完整 goal，不在一次小修/测试数处结束。
- 自动 vendor/model/native0，B旧cap4UNKNOWN和E原pilotBLOCKED不变，不reset/topup/refund/补样/价格研究。
- 原12用户实例5180/8796至5191/8807及全部state/profile/tar/ledger/history/dirty保留。
- 无 global discovery、substring kill、借凭据/真实CLI回退、新Driver/CAC/桌面/自动接受/writer racing/动态DAG。
- 仅 I owned src/test/docs/reports 显式提交原 origin 分支，不upstream/reset/跨owner修改。
- 不以源码或四连接测试宣传完整多 agent 恢复交付；目标是完整方案B工程中的可靠唯一通信块。
