# B：原业务恢复到交付的四个完整成果

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`，保留所有改动后同步最新 `origin/main`，固定实际 source。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0077](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md) 和[验收报告](../../reports/releases/wave30-admission/runtime-channel.json)。
B 保留原 execution/catalog/policy-preparation/driver/testing/Runner/native-acceptance 路径，明确排除 I 的 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`。
B 唯一拥有 runner-service/RunnerLinkClient、HTTP auth/routes/dispatch/begin/prepared/physical lifecycle；I 只通信 module/adapter，main 管原应用授权/组合，A 管迁移，H 独立消费，E 独立 required。
固定基线 `695efad8066433e2e30eff4f776ed74117c61608`：latest I/RunnerAttachChannel、sink missing/deny/throw 拒绝、fresh guard、direct strict、2KB/五块/CAS 均已真过，不重新派这些小修。
I 新可选 sink-responder/refusals 文件不在 B，不等于旧 P1 仍未修。当前新问题是 remote lease 回调同时发往旧 stdio，以及信号工具出生/资源计划仍可绕过。
原正常 ProductCompletion→check/currentCandidate→manualaccept 已 5/5，通过的是 normal，不是原 A/Broker 恢复；不新 candidates 表、ledger、coordinator 或授权。
建立/沿用覆盖四成果的 whole goal，无 token 预算、无当天 deadline 或删门槛。每个成果尽早发布 runnable source，交后继续整包，不等下一轮再做余项。

## B1 安全可运行的唯一通道与正常工具

**实现范围**

- 修复实际 remote lease 的单一 transport 归属：只有原 stdio connection 可以调用 stdout writer，remote 请求只经自己的 HTTP next/pull 返回，sink 只经自己的 responder。
- 远端接管后旧 stdio 收到的 fact/payload/native intent 数必须为 0；保留旧回复结构拒绝，不能把“双发但旧 reply 无效”当隔离已完成。
- 保留最新 I 的 nonce/kind namespace/prune、显式 CAS 与有效页预算，不再写第二 pending/queue 实现；只调整 B 的原 transport adapter。
- 信号工具只接受独立注册、不可变的本 probe spawn handle/birth，完整 PID/start/UID/fullargv/root/config/operation 和整个所需资源集在首 signal 前核清。
- 缺 argv、任意 readable PID 的 born()、空 exactArgs 或默认 first=false 都不能跳过证明；每次 TERM/KILL/escalation fresh 核对，UNKNOWN 不变 exit、不删 material。
- 可复用 H 修好的安全工具或原产品注册能力，避免再造一个通用 daemon 管理器；unsafe 旧 SIGKILL 脚本在纯控制闭合前不执行。

**真实消费者**

- actual serveRunner + RunnerAttachChannel + 原 RunnerLinkClient/responders 同源运行，remote takeover 后实际旧 stdout 观察，而非只测 module.receive。
- 使用现有私有正常 Product/Broker/check/accept 路径作为正对照，补外在 PID/资源观察；ignored contracts build 与当前源码一致，不能把旧 dist 错误当产品缺模块。
- H 的 current producer 应检测修复后的 missing/deny/throw/fresh 行为，不再要求旧 sink finding 存在；B 不编辑 H/E 断言。

**有限验收**

- 正向：正常三回调、原问题答复/候选接受、fresh 两次 guard、完整页/descriptor/五块、合法 CAS 和准确归还都保持。
- 负向：remote 回调旧 stdio frame0、旧/foreign reply0 副作用、缺 guard/deny/throw0 写，以及缺 birth/argv/resource plan、foreign/sibling/recycled 对象0 signal。
- 观察失败保持 UNKNOWN；只有独立完整 own 资源才允许有限 live。测试有总 deadline、输出上限和精确自有清理，不跑未证实安全的故障脚本。

**交接证据**

- 交实际 runtime/adapter/helper source、B/I/H/main 精确 SHA/blob、原 IDs、外在进程/资源与 positive/negative 命令/exit；区分受控正常、module 和 native 未测。
- 第一成果必须能独立运行安全正常工具，不能只因一段 if、测试数或 I 文件已合入就标完成。发布 source 后继续 B2。

## B2 原 A/Broker 的同 Runner 双客户端

**实现范围**

- 在一个原 Work/Ticket/Assignment/attempt 上，原 client A 真实断开，client B 接同 Runner、同 child、原 A Store/注册与当前 host/profile/policy。
- 三回调分别进入原 A business ingress/durable ACK、原 immutable payload Store、main/Broker 对原 native target/version 的 fresh 写前 guard。
- 不用 generic receipt-row 空 participant、Date.now 合成 persisted receipt、手写 requestId payload 或另一 normal Work 替原 authority。
- fact 同 ID 等 durable ACK、payload 同 ref 可重读；native pending detach/rebind 为 indeterminate，回原 command reconciliation，不自动重发 begin/answer 或迁移批准。
- B 交 attached RunningAttempt/consumer 给原 ProductExecution 组合；main 自有应用接线缺口交最小实际 port/RFC，不复制第三 coordinator/执行生命周期。
- 保留原 command/session/request/contract/epoch、完整资源和当前身份；channel generation 不是业务 fence、readiness/配置不是执行许可。

**真实消费者**

- 用实际 product Driver/协议接明确本机 fake 产生原问题，使用原 Application/QuestionBroker 的 question/version/target 和真实 answer delivery。
- actual B/I adapter 对 remote、sink、stdio 都保持正确 transport；H 独立 consumer 用相同 selected source/原数据，I 不接管 policy/lifecycle。
- Runner/child 出生、client 连接与原 A 所有事实可追溯；不以两段不同 demo、module double 或字面状态拼“同 Runner”。

**有限验收**

- 正向：A 的原 begin/question、B 接手实际三回调、正确原答案 native_applied 或准确 indeterminate，完整回执和当前 guard 计数闭合。
- 负向：旧 client poll/reply/close、foreign producer/原 target/version/epoch、旧 allowed nonce、错 receipt/payload 都在真实副作用前拒绝。
- client A 的 transport 不再收到 B 回调；错误/断连不会启动新 child/换 ID/扩大 scope，UNKNOWN 原记录和资源屏障保留。
- 所有连接/等待/观察有限，不使用真实 CLI/gateway/native 或用户 12 实例填样。

**交接证据**

- 发布同一 consumer 的源码与一条完整原问题交接记录：原 A/Broker 数据、进程/client 身份、方法/回执/guard/effect、失败点和资源。
- 第二成果是实际原 authority 双客户端，不是 I module65/84 或普通3回调计数；未到的 main 项准确 NOT_REACHED，source 早交后继续 B3。

## B3 一次安全崩溃到人工接受的纵链

**实现范围**

- B1 安全工具闭合后，在 B2 同一原 Work 链注入原 coordinator 退出/SIGKILL，每 signal 前 fresh 全身份/资源核对，UNKNOWN 留 root。
- 新 coordinator 进程从原 A 登记/current binding/commands/dispatch/observations/question/answer/payload 恢复，原 Runner/child/session/request 不变。
- 原问题回答和 begin/answer ACK/receipt 的未知窗口用真实原 A 与接收端判断；已收/完成不重发，UNKNOWN 不换 ID/退款/清 ledger。
- 同一原恢复 Work 继续产 artifact、注册 verifier/check、quiescent barrier、currentCandidate、明确 application accept_candidate，最终 delivered。
- 复用 ProductCompletion/current/verify/accept、execution.completionCandidate→application.verify、WorkView.actions.currentCandidate；不新 candidates 表/迁移/ledger。
- current epoch≥2、old epoch≥1、旧 contract/question/session/candidate 与 late ACK 在原门拒绝，不能用 current1/future2 充旧版本证明。

**真实消费者**

- 只有一次 consumer/run 的原 IDs 能贯穿旧进程、继任、原答案/事实、check/artifact/candidate/acceptance；正常5PASS只是正对照。
- main 原 ProductExecution/Broker/Completion 是唯一应用 authority，B/I/H 分别提供运行时、通信和独立观察，不另造恢复协调器。
- 明确记录 input actor、controlled fake、native 未测；受控人工接受 actor 不冒充生产用户审阅或质量收益。

**有限验收**

- 正向：真实旧 coordinator 已退出、继任同 A 原身份、原答案/native_applied、registered verification、完整 CandidateRef 接受与同 artifact delivered。
- 负向：写前/receiver后ACK前/ACK后receipt前/receipt持久后窗口，旧 source/许可/候选/版本和冲突 body 都有独立正常对照与原 effect 计数。
- wrong/recycled/未记录资源0 signal，ps/观测失败不当 gone；中断/错误保留原 UNKNOWN，不清 marker/queue 或另起任务凑绿。
- 每次运行有 deadline、真实退出状态和完整外在资源结论，不机械重复长 soak。

**交接证据**

- 交 exact source/consumer/原 Work-question-answer-command-attempt-candidate-acceptance-ref、PID/start/fullargv、机器检查/接收/回执和资源的同 run 证据。
- 第三成果完整纵链真过才标 recovered delivery；缺任何一步保留精确未达，source 发布后继续 B4，不以报告名承诺能力。

## B4 原调度器 2/4 槽与持久归还

**实现范围**

- 原 application/execution scheduler 先2后4槽混合 normal/待答/交接/crash/UNKNOWN/取消/恢复/delivered，保持原背压与控制优先级。
- 五 Work 记录不是五 attempt；第五等待/拒绝、结束后 slot 真实释放/queued 工作继续由原 queue/binding/resource 观察证明。
- per-slot 原 credential/generation/cursor/payload/receipt 隔离，aggregate writer 集完整，UNKNOWN 不释放，不拿单 PID/phase/inspect 当全 quiescence。
- WorkView 身份为 view.work.id；观察 binding ended/runtime.exited、外在 PID/FD/连接、queue/待回调与原 full-resource barrier，重开后状态不丢。
- 控制中再退出、迟到 ACK、部分资源和真实取消/恢复都在同一原生命周期，不新增调度器、第二 ledger 或自动接受。
- 完成实际 consumer 兼容、bounded resource/fault、当前操作文档和准确 source/package/native scope，root deps/共享 contracts 仍 main 管。

**真实消费者**

- main 原 product command/read ports + actual B/I Runtime，H 在自己的路径独立记录接收端和外在资源；不得直写数据库归还 slot。
- I 仅通信错误/闭合支持，B 管 physical lifecycle，A 提供已有持久 ports；普通 App/recipes/insights/install 不因该矩阵未到被挂起。

**有限验收**

- 正向：2/4 原槽都能按各自状态运行/恢复/交付，slot 释放后原 queued 项前进，重开读取原持久事实一致。
- 负向：超槽、错 source/slot/credential、UNKNOWN writer、控制重入、late intent/ACK、容量/timeout 都在既有门受限，其他槽不受错授权。
- 记录开始/峰值/结束的完整资源，只有精确本 probe 出生才 signal；无法证明保留 material，有限 run 不称48h稳定性/native兼容。

**交接证据**

- `tests/native-acceptance/reports/wave30-status.json` 写四成果的 actual source/run/原 IDs/命令exit/外在观察、已过与 NOT_REACHED，不用阶段数/测试数当完成度。
- 发布 runnable source、使用/故障文档和精确 main/I/H consumer 清单；runtime 字节/installed 由 D/E 同 artifact 独立验，docs-only 不伪造 refreeze。

## 独立备选队列

- main consumer 暂缺先交原 A/Broker 的真实 port/最小复现，完成安全工具、单 transport 路由和正常消费者；不要再重复已关 nonce/页预算/strict 小包。
- I/H 输入未到给 exact source/contract，继续自身实际 closure/fault/操作文档；不得跨 owned paths 自修或新造 coordinator/gate。
- safe proof 不完整只做 pure/进程内控制，不跑现有 SIGKILL/长soak；未到的同 run 恢复/slot 准确保留，source 交后持续整包。

## 整包完成条件

- 四成果都含真实实现、实际消费者、完整正负对照和准确同源证据；只有模块/正常5PASS/JSON注册读回不满足原恢复产品完成。
- 显式 owned paths 推原 origin 分支，不 upstream/reset；保留两旧 reportdiff/b16、所有旧 data/profile/tar/ledger/dirty 和12服务5180/8796至5191/8807。
- 真实 vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED；无reset/topup/refund/补样/新Driver/CAC/桌面/autoaccept/第二生命周期。
- wholegoal无token预算、正常节奏无当天强压。四成果 source 交后继续仍未闭合事项，只有实际整包可用才结束。
