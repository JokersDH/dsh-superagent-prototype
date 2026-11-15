# I：真实采用的通信子系统与原恢复消费者支持

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、原分支 `codex/g5-coordinator-channel`，保留历史后同步最新 `origin/main`，记录实际 source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0077](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md) 和[验收](../../reports/releases/wave30-admission/runtime-channel.json)。
仅拥有 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`，明确从 B 广 Runner 路径排除。
B 唯一拥有 runner-service/RunnerLinkClient、HTTP auth/dispatch/begin/prepared/physical lifecycle；main 保原 policy/授权/contracts/root，H 独立消费，I 不新增 server/DB/ledger/Driver/执行生命周期。
固定 `861c03edf9e77c5c250fab59a02103ebb93e56c3`：核心 d1ef81 与 attach321738 已实际进 B695，fresh nonce/namespace/prune、sink fail-closed/direct strict 真过，不重新做这些小修。
I 后加 sink-responder/refusals 是可选小模块/示例，未在 B 不等旧 P1 未修；I 旧报告的 B stale channel 编译错误属中间源时间范围。
当前 actual B 新问题是 remote 回调也写旧 stdio，I 支持准确 consumer/interface，B 修 transport；B/H 信号出生缺口不能由 module 测试替代。
建立/沿用 whole goal，无 token 预算、无当天 deadline/门槛删减。四个完整成果尽早交 runnable source 后持续整包，不堆机械阶段或另一个 gate。

## I1 实际 B/shared responder 与准确采用

**实现范围**

- 更新 exact adoption 清单，核对实际 B/I/main source/blob/exports 与被调用入口；删除 stale“B未合latest/strict仍失败”结论，保留历史记录。
- 现有 CoordinatorChannel/RunnerAttachChannel 保持唯一 pending/timer/correlation/queue 实现，不因新增 responder 再复制 policy 或 transport lifecycle。
- 若采用 shared sink responder，应由 B 在自有 adapter 明确传原 facts/payload/fresh guard；missing/deny/throw 都不允许 native 意图，成功每次重新问当前 guard。
- 原 B beforeNativeWrite 的 void/throw 和 I responder boolean 接口含义须实际适配，不能把 undefined 默认为允许或把函数存在当 guard 决策。
- typed error/base refusal/serverError 与 actual consumer 一致；不为统一目录强制 B 导入不需要的新文件，更不靠 unchecked cast 消除 strict。
- 支持修 B remote/stdio 双发：interface 清楚区分 pending 请求、原 connection lease 与 transport delivery，I 不越界写 B flat service。

**真实消费者**

- B actual service 的 stdio/sink/remote consumer 调同一 I implementation；H 精确 current source 经过 source/materialized 前后验证，不再依赖旧缺陷必须存在。
- 原 A sink、immutable payload Store、main/Broker guard 是回调依赖；模块不持久写、不批准，不用 double 的 persisted:true 代替业务投影。
- 给 main/B/H 可运行的小 consumer 和完整类型/RFC，而非再写一套只用于测试的 channel/responder。

**有限验收**

- 正向：actual B 的核心 blob/adapter 使用、原三回调和 fresh guard、actual direct strict0；I 既有 nonce/CAS/prune/typed error 范围保持。
- 负向：missing/deny/throw/old allowed/错原 producer/correlation 都在副作用前拒绝，旧连接回调不能流向新连接或被 current lease 接收。
- 远端 transport 的旧 stdio frame0 由 B 实际入口验证；I 只提供单 owner 语义与合法输入，不用 module green 代替 B 修复。
- 所有请求/错误/文本/bytes 有界，typed errors 不泄 payload/credential/path/stack。

**交接证据**

- 交实际采用 manifest、source/consumer、回调依赖与运行计数、direct 编译/错误例和准确未达层；optional file 不混成强制产品门槛。
- 第一完整结果是实际采用与真实 responder/类型契约，不是重交 nonce 单测。发布 source 后继续 I2。

## I2 实际 B 入口的三回调闭合、并发和容量

**实现范围**

- 将同 controller A→B 的 recordFact/readPayload/beforeNativeWrite 接到实际 B adapter，原 fact/ref/business command 与 fresh intent frame ID 可追溯。
- facts 重发只等原 A durable ACK、payload 同 immutableRef 可重读；native pending detach 为 indeterminate，批准不迁移/缓存，不自动重放业务命令。
- CAS bind、read-only poll、原 connection receive/close 与 remaining deadline 保持，不能把旧 socket 帧转 current lease。
- pending/total bytes、payload/reply、outbound queue、settled correlation、timer 都在真实 active implementation 内受限，caller 不再维护一套修正 map。
- 并发相同/不同 kind 原 id、相同 business command 多次 fresh 意图、饱和与 timeout/drop/rebind 都不能串用或遗留可派发请求。
- module.close/lease.drop 与 physical quiescence 明确区分；数据读取完整性和真实 native 是否已写由原 Store/Broker/B 判断。

**真实消费者**

- 一条 actual B 三回调 consumer 同时使用原持久 sink、payload 与当前 guard；H 在独立路径运行相同 selected source 的正负例。
- B 管真实 transport pump/身份与资源，I 实现 interface/closure，不接管 auth/routes/进程/lifecycle 或增加新 wire version。
- 缺 B 原数据时先给完整 private public-port consumer，准确区分 double、in-process、Runner、原 A/Broker 范围。

**有限验收**

- 正向：原三 callback 完成、同 ref/receipt/retry deadline、跨 kind 同 raw id 不冲突、fresh guard 每次真实调用，计数与 queue/timer0 结算一致。
- 负向：timeout/reply/close/send failure/rebind 竞争只结算一次，late/expired/错 source/超限0副作用，模块容量恢复后合法请求仍可前进。
- real B 入口的队列/closure/bounds 必须测试，不仅 I 未消费的 helper；旧已过的 34/65/84 scope 只在风险相关变化时回归。
- 验证有 deadline/总量上限、无真实 vendor/native/用户服务操作，不新增长 soak 或第二 gate。

**交接证据**

- 交 exact source/active consumer、原 ids/generation/deadline、收据/guard/queue/timer/bytes 与正反运行证据，未执行的业务链标 NOT_REACHED。
- 第二完整结果是 actual communication subsystem 闭合，source 发布后继续 I3，不以模块数/测试数称产品恢复完成。

## I3 原 handover/crash reconciliation 的模块支持

**实现范围**

- 为 B 原 A/Broker sameRunner 双 client 和安全崩溃纵链提供精确通信错误/lease/remaining timeout/data resend 支持，I 不新建 coordinator 或 recovery ledger。
- 原 coordinator 离开、继任从 A 原登记恢复时，facts/payload 原关联可保持，native 未决意图拒绝为 indeterminate，caller 回原 command reconciliation/fresh guard。
- 不将 timeout/closed/stale/generation 与普通 native denial 混同，不从“消息未返回”推断未写，不在 module 里自动重新批准/派发 begin/answer。
- channel generation 不是 contract/fence epoch，main/Broker/原应用保问题/版本/target/host/profile/policy authority。
- 支持原 Work 的 check/currentCandidate/manualaccept consumer 所需的原事实连续性，不新增 candidates 表、验证器或接受权限。
- B/H 安全 helper 未通过前仅 pure/进程内验证；I 不 signal、不造出生证明、不把通信 close 等同所有 writer 静止。

**真实消费者**

- B actual attached runtime 与 main 原 ProductExecution/A/Broker 组合；H 独立 receiver/事实/错误/外在资源观察，I 修自己 subtree 的具体缺陷。
- 同一个原 Work/question/answer/attempt/native request 的 source/数据能跨旧/新协调器，JSON registry/合成 ACK/double 不能替代实际依赖。
- consumer 缺口给 main/B 最小 port/RFC 与真实输入，不能为旧 probe 加空方法、隐式权限或另一事件 ledger。

**有限验收**

- 正向：actual original authority handover 中通信保持、原 A receipt/payload/fresh guard 可调用，错误准确，让同一原纵链能继续。
- 负向：old connection/old intent/duplicate allowed/错原 subject/超时窗口/重入不产生新许可或业务重发，未知结果保留给原应用判断。
- 完整崩溃/check/accept 是 B/main 产品结果，I 报告只据 actual consumer 步骤标支持/未达，不能拼多个 module positive 升级。
- actual vendor/native、物理 resources、installed/value 分别未测，不加预算或价格/协议/recipe 研究。

**交接证据**

- 交实际 B/main/H consumer 的错误语义、原 ids/source/generation/回调结果和边界文档；明确谁 owns policy、state 和物理 lifecycle。
- 第三成果以原产品消费者真实使用为准，source 早交后继续 I4，外部步骤未到就精确 NOT_REACHED 并做独立兼容。

## I4 已发布 interface、稳定性和真实采用交接

**实现范围**

- 统一最终 exports/options/error/bytes/deadline/nonce/business ID/close 语义与 actual B/H source，caller 只跨小 interface，不维护私有 maps/修正器。
- 完成真实 consumer direct strict/exactOptional、schema/local v1/frozen wire 兼容和风险相关 fault，pending/queue/timer 规模受声明 bounds 限制。
- 提供可运行 current source consumer、使用/故障文档、B adapter 清单与准确 module/进程/原恢复/installed/native scope。
- 采用 manifest 绑定具体 runtime blobs，不因 optional docs、新 helper 或 unrelated HEAD 漂移反复制造假未合入/必须新 tar 的门槛。
- 不新增 watcher、validator 权威、server/DB/ledger/Driver/policy；H 独立验不变成又一套产品 gate，E 保最终 required。
- source 改动按实际闭合/资源风险回归，不机械扩大阶段/测试数，正常节奏不设当日完成强压。

**真实消费者**

- 发布的 I module、B active runtime、main public-port composition、H 独立 consumer 都使用相同实际语义，source/time scope 明确。
- D/main 可消费必要 runtime exports/build 清单，测试 fixture/key/private source 不进入运行包；同 artifact installed 由 D/E 独立完成。

**有限验收**

- 正向：独立消费者按文档可运行原三回调/闭合/fresh decisions，active B/H 严格编译和有限故障/容量矩阵通过。
- 负向：missing deps/旧 source/错误 interface/typed refusal/limits/close/secret 都准确拒绝，不把真实错误吞成 unavailable/成功或无限重试。
- 既有 normal/check/manualaccept 与新 recovered scope 分列，H 旧 defect-required expectation 修复后测 nonregression，不为报绿制造一个 bug。

**交接证据**

- `reports/runtime-channel/wave30-status.json` 列四完整成果、main/B/I/Hsource/接口采用、实际 consumer/原 IDs/命令exit/观察/未达，无机械24阶段填数。
- I 只说明通信子系统的真实可用性，不代报原 product crash/slot/native/release；source 发布后完成仍有外部支持事项，whole goal 真齐才完。

## 独立备选队列

- B/main 实际消费者暂未到：交 current interface/source/private public-port consumer，继续 actual module closure/fault/docs，不重做已闭 nonce 或越界写 B flat 源。
- H current 消费者未到：给准确 blob/依赖/原数据和负例，自己的 actual tests 可先跑，但不能称独立 H 已通过。
- 缺 native/operator/installed 数据如实未测，不研究新价格/协议配方，不从 readiness/配置/receipt 产生任何业务授权。

## 整包完成条件

- 四成果均有实际 implementation、真实 consumer、完整正负对照与 source/行为证据；模块 green、typed interface 和状态文件名称不等原产品恢复通过。
- 只 owned paths 推 origin 原 `codex/g5-coordinator-channel`，不 upstream/reset/B flat/contracts/root/A SQL/E断言；I subtree 保独占，旧dirty/12服务data/profile/tar/ledger保持。
- 真实 vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED；无reset/topup/refund/补样/新Driver/CAC/桌面/autoaccept/第二生命周期。
- whole goal 无 token 预算，正常节奏、早交可运行 source 后继续完整支持，不把 partial adoption 或更多 gate 当终点。
