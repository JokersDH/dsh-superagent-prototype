# B：真实 Channel 接入与原业务恢复整包

2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`，保留全部改动后同步最新 `origin/main`，记录准确 source。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0068](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)、[0069](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)。
原 execution/catalog/policy-preparation/driver-kit/testing/drivers、Runner/native-acceptance 所有权保留，但明确排除 I 独占的 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`。
B 唯一修改 runner-service、HTTP recovery auth/dispatch、begin/prepared/lifecycle、RunnerLinkClient responder；I 只实现 CoordinatorChannel，H 只独立消费和故障观察。
十位外部 A–J 加 main 按正常节奏做完整产品，不设“今天必须完成”的目标，不压缩门槛；main 管 root/contracts/config/lock/HTTP/provider/授权，A 管迁移，E 管独立断言。

固定起点 `36c0e60dfb7deaae6ec8767b81ab5c97481104d4`。合法 135540 字节 payload 的五块还原已修；旧完整 tuple/producer/readonly/control 范围保留，不再重派已关判断。
当前 160 条小日志的累计 page budget guard 回归必须闭合；先证明 inline、descriptor、大 payload 和多页正对照同时成立，不能只以某一大记录通过交接。
main 正发布 `packages/contracts/src/coordinator-channel.ts` 的小 interface/local schema，不改变 frozen Runner wire；以 0068 和实际最新源为准，不复制另一份协议。
建立/沿用 whole-package goal，无 token 预算；20 阶段在 B4/B8/B12/B16/B20 发布五个完整 runnable 结果，发布后继续，不在 helper/PARTIAL/检查点停工。
保留两个旧 runtime report 差异、b16 未跟踪文件、全部旧 source/tar/profile/ledger/用户改动，所有新复验单独记录 scope。

## B1 闭合真实 inline 与 descriptor 回放

复验当前小页预算回归，使用实际 serveRunner pager 和合法 FileCriticalJournal，保留 160 条小记录、多页原 seq/factId 与大记录正对照。
总 serialized envelope 的 bytes 计算覆盖 inline、descriptor、producer 和游标，达到本页预算后只能结束该页，不能错误拒绝后续合法小 frame。
未知/超前游标、空/末页、预算非法、descriptor ref/length/digest 与实际 payload 不符都有有限独立负例。
合法 135540 字节至少三块的中间/最终短块持续可读并核对摘要；不再把非最终块 length 当全长或破坏已关回放。
验收：inline→descriptor→多页→payload→receipt 后 cursor 的同一链通过，无丢失/重编号/重复 effect，旧有效拒绝保持。
交最小实际 source 给 main/I/H，然后继续 B2–B4，不以单个预算修复结束本包。

## B2 实际 I interface 与 B adapter

读取 main 已发布 CoordinatorChannel interface 和 I 早期实现，明确 recordFact/readPayload/beforeNativeWrite 与 bind lease 的实际类型、错误和 generation。
B 在自身原文件实现 adapter，将 authenticated producer/connection 与当前 channel lease 关联，不让 I 创建 HTTP server 或更改 frozen wire。
stdio/bootstrap 与 recovery endpoint 的身份/连接来源都由 B 校验，I 的 full-producer 检查是模块不变量，不替代 main/A 当前授权。
给 I 实际 import/consumer/编译复现及最小字段需求，不在其 subtree 偷改实现，不长期保留一份 B 私有复制实现。
验收：B adapter 调用 I 真实方法和 local schema，direct strict/exactOptional 与实际最小 consumer 通过，不只交计划或空接口。
早发布 source 与准确 RPC/本地回调映射，后续 I 新结果到达时渐进合入，不等全部整包才接线。

## B3 去掉原三 waiter maps

用 I 的具体 module 接管原 factWaiters、payloadWaiters、writeWaiters，移除旧并行 map/旧管道的永久共存，而非再包一层转发。
原 fact/payload-read/native-write-intent 和 receipt/payload/write-admission/ack-failed 仍为 v1 frame，B 只把已校验的 frame 交当前 lease.receive。
原事实先落 durable Runner journal，再交现有 A sink 取得收据；I 不写 SQL/ledger，B 不从“已发送”推断原生结果或资源静止。
同一业务命令的 stdio/HTTP path 进入 B 一个 dispatch，保持 begin 一次、prepared policy、launch、容量和 receiver 观察。
验收：三实际回调的成功/拒绝/断连/超时只在 I 一处管理，旧 maps 删除后正常 producer/控制仍工作，无第二生命周期。
若兼容开关短期必需，列明确退役条件并在本包内移除；不能用双轨永久保留来宣称统一完成。

## B4 第一结果：完整回放与真实 Channel

在真实 Runner service 中同时验证 B1 回放和 I adapter 的三 callback：实际 A receipt、不可变 payload 和 main/Broker fresh 写前许可。
native-write permission 只供原本次意图，不缓存重用；原 request/target/版本仍经主线真实 guard，而非 channel 自行批准。
stdio 和 HTTP consumer 都实际连接同一个 module，source/connection/generation 的错误在副作用前拒绝。
记录准确 B/I/main/A source、原 attempt 与 frame/request/receipt 身份，区分纯模块、actual Runner 和厂商未测范围。
第一完整结果为 B1–B4 的预算/数据连续性、真正去旧 maps、实际 adapter 和三 callback 正负证据；不是又一个判断修补包。
发布 B4 runnable checkpoint 后继续 B5–B8，whole goal 未齐保持进行，外部依赖只阻对应阶段。

## B5 原 Runner 与连接所有权

使用真实 product Driver/协议接私有 fake 产生正常 begin/question；固定 `/usr/bin/false` 失败不算业务交接。
从 A 原登记获取完整 endpoint/current binding 和资源，B 保持 producer/attempt/contract/host/profile/policy 守卫，不扫描 socket 或猜 credential。
CAS bind 的 expectedGeneration 与 authenticated connection 绑定，连接替换只有一条 active lease；原连接晚到不能回应新 pending。
记录原 Runner/child PID/start/UID/fullargv/root/config/operation 和 session/request，不能另起 child 或换 attempt 补成功。
验收：正常原连接三回调工作，错 full tuple/source/generation/socket/guard 在真实读写前拒绝，资源仍能准确观察。
该阶段只准备合法交接，不将连接成功、inspect 或 sent 改称业务已恢复。

## B6 同 Runner 双客户端真交接

client A 完成原 Work 的 begin/question 后真实断开，client B 接原同 Runner/child 的同一 CoordinatorChannel 和原 durable A Store。
facts 同 ID 重发仅为等 A durable ACK，payload immutableRef 可重读；未决 native promise 拒绝/indeterminate，回原 command reconciliation 后才可 fresh 核对，不能自动迁移许可或重发 begin/answer。
新连接接手原 sink/payload/fresh native guard，旧 A 的 receipt/payload/allowed 回复在 generation fencing 下无效。
区分断开、lease.close、module.close、业务停止与物理 quiescence，不能用 no-op close 或假 receipt 证明 A 已离开。
验收：两个实际 client 生命周期、原 IDs 与实际接收端/事实/guard 计数闭合，不是两个独立 demo。
保留未知的原在途状态，连接更换不生成新的许可、ledger、coordinator 或执行生命周期。

## B7 同链数据与当前许可

用原 A public ports 核对 fact receipt、payload immutable digest、question/answer/binding 和当前合同，不只读 B 自己的内存状态。
原本次 native-write-intent 的主线 guard 在实际写前重读；历史 allowed、相同文本或旧 target 不可授予另一 request。
验证 ACK 重放、payload response 晚到、旧 lease.close、新 lease 关闭和来源身份改变，任何拒绝不污染当前 pending 或接收端。
recorded intent、observed/result 和 unknown 以真实 A/receiver 为依据，commands.has 或无响应不能单独判是否已发送。
验收：同一原问题的通道交接、回执和许可时点可追溯，错误 source/subject/版本有完整成功对照和有限 deadline。
不要新加 probe 专用空读取方法或 SQL；确有缺口交 A/main 原 ID 最小复现，继续其他独立项。

## B8 第二结果：原进程双客户端可用

将 B5–B7 和原 product/Broker/A consumer 合成实际同 Runner/child 的双客户端路径，含三 callback、原问题和完整守卫。
记录连接前/后/旧回复晚到的 command/attempt/session/request/epoch、事实和 resources，不把 authenticated control wrapper 当 resume。
旧 client 不能重新夺取新 generation，也不能以迟到批准完成新的 native 写；新 client 的正常路径仍能前进。
normal 与 controlled handover 分列，真实厂商/native 未测仍 NOT_TESTED；主线普通 App/安装不等待这个研究或私有 activation。
第二完整结果为 actual 进程/consumer 交接与拒绝，不只是 I 私有模块测试、schema 或 source wiring。
发布 B8 checkpoint 后继续 B9–B12，不因交接接口已绿就结束协调器崩溃恢复工作。

## B9 原协调器退出与新进程

原 coordinator 在私有独立进程运行并持久用 A Store，注入正常退出和 SIGKILL，独立确认旧 PID 已退出。
新 Node 进程从原 A 登记/current binding/业务事实重建连接，原 Runner/child 与 session 保持，不把同进程 reopen 当跨进程恢复。
首次连接和每次副作用重新核当前 host/profile/policy/合同/epoch 与完整资源，不从 source receipt/readiness/旧配置派生启动许可。
精确连接本次原 endpoint，不全局发现或借其他 credential；unknown 原资源保留，不删 marker/队列/state。
验收：新进程实际读原 A、接同 Runner/child，原事实继续入库，完整身份与有限窗口有正常正对照。
缺 main consumer 时先给实际 private consumer 和 source，B 生命周期实现继续，不创造第三 coordinator。

## B10 原问题回答与 native 结果

恢复原 Broker question/version/target、native binding/request、answer 和 command ID/body，不能创建一个等价新问题或换 ID 补洞。
回答许可在真实 native-write intent 上由 main/Broker fresh guard 核对，I channel 只搬运原意图和当前回复，不自行判允许。
允许时实际达到 native_applied；无法判定时保留 indeterminate，response_written、普通 ACK 或 receipt 存在都不是已应用证明。
收到的原 answer/receipt replay 不重复写入 native，不重复计接受/ReviewTiming；旧批准逐请求保持，不能跨 session 迁移。
验收：原身份正确回答、拒绝和未知路径各自可复现，原 A 事实、receiver/native effect 与返回状态一致。
zero vendor/native 不变，所有“真实”指真实产品控制路径配私有 fake，不升级成厂商兼容或价值结论。

## B11 有限 ACK 与 unknown 窗口

对 begin/answer 覆盖写前、receiver 后 ACK 前、ACK 后 fact receipt 前和 receipt 持久后等有限窗口，实际计数而非自己的 send 标记。
同 ID/body 可按原幂等约束返回原结果；冲突 body 拒绝，observed/result 不重发，unknown 不换 command/attempt/session/request ID。
facts 重发与 payload 重读是恢复数据，不自动重发业务命令；成功 native allowed 不跨重绑缓存使用。
覆盖旧 lease 晚 ACK、两个 client 并发、timer/close 回复竞争及 native admission 断连，保持原资源 barrier 和 unknown ledger。
验收：每窗有完整正对照、有限 deadline、原 ID 与真实 A/receiver 事实，无 reset/refund/替代样本。
修正测试中先重复 send 再检查另一个 ID 的假 no-resend，不放宽主线当前授权以让测试通过。

## B12 第三结果：SIGKILL 原身份恢复

B9–B11 必须同一条原业务链闭合：旧 coordinator 确认退出，新进程同 A 原登记、原 native 问题和回答、三 callback 与 ACK/unknown 语义。
记录准确 source/consumer、原 IDs、PID/start/完整 argv、实际事实/回执/写入数和最终资源，不能拼不同 demo。
readiness/configuration-only、source 确认、空目标 DB 或目录复制都不成为新执行权；main 保留私有许可与 target authority。
对外提供 main/H 可复现的实际消费者命令和 bounded evidence；H 不改 B/I 源，也不新建另一 ledger。
第三完整结果交 source 和真实跨进程行为，未测厂商/installed/value 分别保留，不宣称全产品 release。
发布 B12 checkpoint 后继续 B13–B16，把恢复后的工作真正推进到验证与人工交付。

## B13 恢复验证与当前候选

同一原 Work/Ticket/Assignment 在恢复后继续真实产物、registered verifier/check、artifact 和 current candidate/completion gate。
候选绑定原 contract、环境与 check policy；不能借另一个正常运行、直接改状态或把 native end_turn 当机器验证。
机器失败保留失败与原证据，修正后才能生成合格当前候选；复核评分/旧 candidate 不授接受权。
问题、回答、native_applied、验证、artifact digest 与 candidate 的来源同链可追溯，normal/recovered/vendor 各自计量。
验收：恢复后机器失败/修复成功与错 subject/环境/检查版本拒绝有实际应用流程和明确 deadline。
不新 verifier、动态 DAG、autoaccept/merge/deploy 或另一个工作生命周期。

## B14 人工接受与合法版本

以真实应用命令明确人工接受合格当前候选，保留 acceptanceRef/verification/candidate/artifact 与原 Work 身份，不直接写 accepted 字段。
真实 current epoch 至少 2、旧 epoch 至少 1，覆盖旧 contract/question/target/session、迟到 ACK 和修订后旧候选；0 只算无效 schema。
command、native-write intent、fact/receipt 落库都核当前身份，重连或 lease generation 不能代替业务 epoch/合同检查。
原 receipt replay 不重复答案、接受或 ReviewTiming，UI 观测是 partial metadata 不成为质量/授权证明。
验收：当前候选一次接受、旧版本/旧候选拒绝与重放幂等，都来自同一恢复链。
厂商/真实人工审阅/installed 未测如实标注，受控测试 actor 不代表用户生产接受行为。

## B15 2/4 槽和控制重入

先 2 再 4 槽，混合正常、等待回答、交接、SIGKILL 恢复、unknown、停止与已交付，使用原 scheduler 背压与控制优先级。
每槽原身份、generation、credential、cursor、payload 和 receipt 隔离，故障槽不能获取另一槽的许可或数据。
cancel/stop 使用 actual post-proof 和 main complete-resource barrier，覆盖停止途中 coordinator 再退出/重入、仍活 child 与部分观察。
sent、inspect、launcher PID 消失不是 writer 已静止，unknown 不能被空 manifest/换 ID/清标记消除。
验收：完整恢复链并发、控制优先级、容量和 unknown 隔离成立，错误有界且不会影响十二旧实例。
只清理独立确认本 probe 出生的完整身份资源，不全局扫描、pkill 或用路径子串决定所有权。

## B16 第四结果：交付与资源闭合

采集连接/FD/waiter/queue/journal/Runner/child 的开始、峰值、结束，断开重开后无悬挂回调、重复 effect 或漏计 writer。
每次 signal 前新读 PID/start/UID/fullargv/root/config/operation，本次独立出生且完全一致才可操作；unknown 留根与证据。
第四结果组合 B13–B15 同链验证/人工接受、合法版本、2/4 槽与完整资源观察，不能把几个 unit PASS 合成全链。
保留准确 normal/recovered/module/fixture/native 层，短序列只称有界稳定性，不称 48h soak。
交 main/H 实际 consumer 和精确失败复现，E 仍独立做 required product verdict，B 不改其断言。
发布 B16 checkpoint 后继续 B17–B20 的完整模块故障、兼容和操作交接。

## B17 故障与数据连续性回归

在实际同一 I/B adapter 上覆盖合法/坏/torn journal、inline/descriptor/chunk、receipt loss、payload corruption、callback 超时和连接替换。
每个故障只改独立原因，有完整合法 positive、实际 error/exit/原 IDs 与数据/资源不变量，不用一份坏签名代表多个故障。
保留原 unknown 和 durable事实，不清账本、换身份或回填不存在的执行结果；只重跑变化影响的必要 suite。
facts->ref->多块payload->原receipt 连续性与 160 小页正对照同时保持，修一条不能再破坏另一条。
验收：故障有 deadline、实际接收/guard/事实计数和完整退出状态，不产生假恢复绿灯。
不以新价格/协议/模型配方研究、第二 Driver 或新预算代替已授权运行时实现。

## B18 main/I/H 消费者兼容

用 I 实现和 main 小 interface 编译 B 实际消费者，direct strict/exactOptional 覆盖源，不以 root tsconfig 未包含文件的绿灯充数。
H 在独立目录消费同一 port 做合法 fixture/故障观察，B 处理自身源码缺陷；I 修 module 自身实现，不抢 B lifecycle。
输入、错误码、byte单位、cursor、generation、close、ACK 与未知语义都由最终实际 source 定义，文档不维持过强保证。
确保原 RunnerLinkClient 真实 responder 能供新协调器重绑，测试不依赖测试专用隐藏方法、私有 SQL 或新 ledger。
验收：跨 owner actual consumer 能复现五个结果的相应范围，冻结 wire 不变，源码/fixture/native/release 分开。
外部改动未到只阻对应消费者，B 自有正常/故障/资源和文档继续，不无限等新派工。

## B19 操作与文档完整性

提供可运行的连接/恢复/unknown/停止/诊断流程、准确原身份示例和需要 main 明确授权的动作，不教用户清旧 state 解除屏障。
更新早期 RFC，去除 pending exactly-once、feed 就保 begin、单个 chunk reader 就完成业务恢复等超前结论。
有限重复操作观察内存/FD/waiter/连接/queue 增长，明确环境/次数/时限，不能称长期 soak 或跨机器保证。
所有示例私有 fake，不 fallback 真实 CLI/网关；新同事使用原安装/profile/data 不被迁移或重启。
验收：独立消费者按文档完成受控链，失败可定位到实际 source/原 IDs/unknown，而不是靠删除 ledger。
正常节奏交完整产品，不因日历目标压缩拒绝、恢复或资源门槛。

## B20 第五结果与最终交接

写 `tests/native-acceptance/reports/wave27-status.json`，列 B1–B20/五结果、source/B-I-main-A consumer、原 IDs、命令/exit/行为和未达项。
第五结果包含实际模块/消费者完整故障、兼容、可运行操作与文档；不以 helper 数量、局部判断修正、静态源或测试数完成 goal。
4/8/12/16/20 提交 source 后继续独立阶段，whole goal 真未齐就保持未完成，不把 partial 回放报成用户完整可恢复开发。
仅 explicit owned paths 推原 `origin` 分支，不 upstream/reset，保留两个旧 report diff、b16、全部 source/tar/profile/ledger/dirty。
真实 vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 24turn/200000token/USD5/单在途 pilot BLOCKED，无 reset/topup/refund/补样。
十二组 5180/8796 至 5191/8807 与全部 data 保留；不新 Driver/CAC/桌面/autoaccept/writer racing/动态 DAG/第二执行生命周期。

## 独立备选队列

I 早期 module 未到先闭合实际多页/descriptor/大payload 与 B adapter shape，给真实 consumer/RFC；I 发布后立即接源而非长期并存旧 maps。
main/ A 暂缺一个实际输入，交原 ID/事实最小复现并做私有合法 consumer/故障/资源；不为旧 probe 加空方法或 SQL writer。
H consumer 未到 B 自己已有 actual module/进程路径继续，不能把 independent verifier 未到当不实现 lifecycle 的理由。
普通 App/安装/readiness/观察与私有许可/target/研究独立，configuration-only/authority none 不能当 native proof 或授权。
