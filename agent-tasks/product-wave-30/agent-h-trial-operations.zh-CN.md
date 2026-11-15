# H：不可变出生句柄、真实消费者与同事试用支持

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-h`、原分支 `codex/g4-trial-operations`，保留历史后同步最新 `origin/main`，固定实际 source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0077](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md) 和[验收](../../reports/releases/wave30-admission/runtime-channel.json)。
仅拥有 `tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`，不改 B/I/main/A 实现、root/contracts 或 E required/assertions。
固定 `f8cf5713c269a3a920231f23baf11aadd90db736`：current selected 参数/commit/materialized 已能实际运行12项I/5项B正向；现在报告失败是还要求旧 sink bug 存在，非 B 新回归。
B latest I/RunnerAttachChannel、sink missing/deny/throw 与 strict 已过，原 normal check/candidate/manualaccept 保留；同一原 A/Broker 恢复/accept/2&4 aggregate 尚未到。
H guard2 已拒普通 JSON/前缀错误、UNKNOWN 不当 gone；新 P1 是返回的 mutable record 与 REGISTRY 内部共用，可将原 handle 改指向 foreign PID，必须先封闭。
H 提供独立 consumer、事实和运维支持，不再建设另一 gate/coordinator/ledger/生命周期；既有600/1800等 raw fixture scope 保留，不盲目重跑长观察。
建立/沿用四成果 whole goal，无 token 预算、无当天 deadline 或删门槛。每成果早交 runnable source 后继续完整工作，外部依赖未到准确记未达。

## H1 不可变 owned handle 与运行前安全基线

**实现范围**

- 用 private immutable cloned/deep-frozen birth facts 和原 ChildProcess 绑定 opaque handle，优先 WeakMap 按原 handle 对象保存；不要返回可修改的内部 record/token。
- 返回 observation 只能防御性副本，caller 修改 pid/argv/root/config/operation/birth、伪造 handle 或拷贝 token 都不能改变目标或取得 ownership。
- 独立来源含原 spawn args、child birth report 和 OS start/UID/完整 argv，root/config/op 对应精确原参数；全 resource set 首 signal 前验证，后续每次 escalation fresh。
- B 的 born任意PID/缺argv/可跳resourceplan不是可用模型；可交可复用 helper 给B，但产品 stop/资源屏障仍由原 owner。
- 保留 UNKNOWN/普通 JSON拒绝/精确前缀已闭范围，观察失败不当 exited/gone，不删 still-live/unknown根；unsafe live 脚本在纯控制过前不运行。
- 本工具只管明确 own probes，不成为通用 daemon 管理器或产品授权；no global discovery/祖先进程/路径子串判 ownership。

**真实消费者**

- 当前 H spawnOwnProbe/signalFresh/waitGone/pureControls 共同消费同一 private immutable registry，B 在自有工具采用不越权共享源。
- 使用完整 own positive、原 tracked child exit 和独立外在 OS 观察；不以 caller 自写 JSON full identity 冒充本次出生。
- H current producer 同时切为修复后 sink 缺 guard 拒绝/合法 fresh 允许的 nonregression，历史缺陷报告保留但不再是绿色条件。

**有限验收**

- 正向：原 immutable handle 只能 signal 本 probe 原进程，fresh before every TERM/KILL，原资源集合/退出准确，重开观察 UNKNOWN 不变安全退出。
- 负向：returned record 全字段 retarget foreign、copy/missing birth、伪 handle/token、missingargv/resourceplan、foreign/sibling/recycled/mixedunknown0 signal。
- 先全 mock OS/spawn/kill 保证0真实信号，纯控制闭合后才有限 own live；不直接重跑旧 SIGKILL/procguard/长soak。
- mutation 不得影响内部 registry 或 waitGone 的 ChildProcess 归属；首轮全 plan 不可由默认参数跳过，UNKNOWN material 保留。

**交接证据**

- 发布 helper/consumer source、immutable origin/资源/fresh/unknown 的实际命令/exit/spy计数与完整正对照，不只报告 checks:true。
- 第一完整成果是安全可运行 toolkit 与正确 current regression expectations，source 发布后继续 H2。

## H2 当前 I/B 生产入口与原 A/Broker 数据

**实现范围**

- 绑定 explicit current admitted I/B/main commit/blob/dependency closure，materialized bytes 与实际 import 前后验证，docs-only unrelated HEAD 不制造假 runtime mismatch。
- 保留旧 defect-detection 材料，current producer 不要求 B29 sink finding 为真；missing/deny/throw/oldallowed 拒绝与合法fresh允许均按当前语义测。
- 三 callback 使用实际 B runner-service/RunnerAttachChannel，facts 回原 A persisted business ingress、payload 原 Store、native guard 原 main/Broker target/version/host/profile/policy。
- generic Store.facts 空 participant、boolean allow、合成 persisted:true、requestId伪payload只是 fixture 契约，不可升级原 authority。
- 独立复验 remote lease 回调旧 stdio frame0、旧 producer/lease reply 无副作用，I namespace/prune/fresh nonce 与 B transport source 同时实际采用。
- 不新 coordinator/server/ledger、Driver 或第三套 callback，H 只消费原公开 ports/合法协议、给 owner 精确复现，不修 B/I 源或 E 断言。

**真实消费者**

- 一条原 Work/question/answer/attempt/contract 的 controlled Product/A/Broker consumer，能独立读取原事实/原 target 与回执和 native_applied/UNKNOWN。
- H 实际执行 latest selected implementation 而不是 old source snapshot/contract scenario 列表，明确当前源和历史修复 scope。
- B/I 修复未到时只标该实际步骤 NOT_REACHED，core source 与正常 ProductCompletion positive 仍可继续，不能仿真替产品。

**有限验收**

- 正向：selected source/materialized 不变、原3callback成功、missingguard拒绝、freshallow逐次、原问题/数据来源与 receiver/Store一致。
- 负向：wrong root/commit/hash/entry、foreign producer/原 subject、旧 allowed/lease、超界/timeout 都有独立 positive 与0副作用。
- 远端请求只能经自己的 connection 收到，old stdio 不得同时接收新 callback；typed/interface/error 与 actualB source一致。
- collector/producer只有明确 private inputs，读取不触发模型/任务，原用户12实例/credential/private DB不碰。

**交接证据**

- 发布可运行 original-authority consumer/原 IDs/方法与实际事实、source/bytes、回执/guard/effect和准确未知，H报告的“current”必须真对应执行源。
- 第二成果是生产入口的合法独立消费支持，非又一套 gate、12项模块计数或把 normal 结果贴 recovered；source交后继续 H3。

## H3 独立 ACK 故障与外在进程资源闭合

**实现范围**

- H1 工具闭合后支持 B 同 Runner/child 双client 与一次原 coordinator 安全SIGKILL，新进程回原 A 登记与原 question/answer/ACK，不另起 coordinator。
- 同一原 Work 从恢复到 artifact/registered check/currentCandidate/manualaccept 的数据和 receiver 可独立核对，原正常5PASS仅作positive。
- begin/answer写前、receiver后ACK前、ACK后receipt前、receipt持久后窗口以原A/实际接收端判known/unknown，不靠总receipt行数变化。
- 已收/完成不重发、UNKNOWN不换command/attempt/session/request/refund或清marker；原允许需每次fresh，data重读不等业务写。
- 原 scheduler2/4混合待答/重绑/UNKNOWN/取消/恢复/交付，WorkView.work.id、binding ended/runtime.exited、queuedwork推进和完整资源都核对。
- FD/连接/timer/waiter/queue/journal/Runner/child 开始峰值结束与外在PID观察互证；moduleclose/parentgone不等所有 writer quiescent。

**真实消费者**

- B 原 runtime/main Application/Broker/Completion/A public Store/H独立receiver与外在进程观察，同一 source/run/原 IDs贯穿，I只模块支持。
- H可提供安全signal wrapper、合法输入与观察，但故障进程/lifecycle由B管理；全operation资源set证明前不signal，UNKNOWN留material。
- actual B 原链尚未到时如实未达，不用几份normal/JSONregistry/fixtureunit组合“恢复成功”。

**有限验收**

- 正向：safe原退出/新进程、原答案native_applied或准确unknown、同runcheck/accept/delivered、slot真释放后queued项继续，source和身份一致。
- 负向：foreign/recycled/pre-record/资源缺失、旧source/nonce/epoch/candidate、lateACK、容量/timeout/取消/再崩溃均有限且zero越权。
- 外在PID/root/config/op不符不signal，错误/UNKNOWN不删state；normal/controlled/live/recovered/vendor/native/installed各自记录。
- 不机械跑40分钟/48h或真实gateway/CLI填样，所有wait/bytes/sample有上限，短序列不宣称长期稳定。

**交接证据**

- 交 current run 的源、原Work/question/answer/attempt/candidate/acceptance refs、PID/start/fullargv、窗口/接收/Store/资源与准确未达。
- 第三成果是真实原故障/资源支持，不能以独立模块通过自授native/fee/release；source发布后继续 H4。

## H4 exact 当前包的只读观察与同事支持

**实现范围**

- 以 D 提供的 exact tar/install/source/build/hash/schema/ABI/mode 输入执行有限 readonly preflight/diagnostics/SSE，requested根/配置/恢复模式与 health一致。
- 检查恢复 personal/discussion/fixture 请求按当前实际包分支处理；测试检测到BLOCKED不等功能 start-health-stop成功，不放宽 originalstop或删marker。
- 明确新main工作台/recipes/insights/0077建议入口是否真的在该包内，checkout/staticmarker/另一sourceconsumer不能贴旧artifact为新功能准入。
- 复用现有 structured manifest/archive/client 工具，不新parser/gate/自授权限；preflight REFUSED/UNKNOWN前不执行候选代码或自动install/upgrade/迁移。
- explicit ownroot/token/allowlist，无home或他人credential发现，有限总duration/请求/bytes/样本；现有raw观察按原scope保留不盲重跑。
- 完成同事使用/故障说明、可脱敏支持材料和准确缺口；H运维观察不是 E required verdict、nativecompat、因果收益或组织多用户授权。

**真实消费者**

- 只读已有 package CLI/readiness/config/source/history/insights/既有 SSE，actual输入绑定到一个明确subject，不拉起未经证明own的用户进程。
- 若需要执行私有进程，先采用H1 immutablebirth/fullresource/fresh规则与原product操作；缺明确target保持NOT_REACHED，不操作12旧实例。
- main/D/E提供入口/字节/最终独立准入，H只给原始source-bound observations；B恢复与普通包支持独立前进。

**有限验收**

- 正向：exact当前包的合法只读流程/有限SSE、raw起止/样本/实际health/requestedmode/source齐备，原数据/账本不改。
- 负向：wronghash/schema/ABI/mode/root/token、坏source/HTTP/慢流/SSE断线、缺记录/UNKNOWN resources准确拒绝或部分，不伪造完整。
- 全输出新路径0600/不覆盖、token/header/payload/私有path/stack脱敏；raw与derived/最终E层分离，reader可检测篡改/时间矛盾。
- 不把功能bug-detection PASS贴functional PASS，不因docs-only无关移动refreeze或把真实缺字节视为当前main回归。

**交接证据**

- `reports/trial-operations/wave30-status.json`列四成果、exactsource/artifact/实际consumer/原IDs/raw/命令exit/外在资源/错误/NOT_REACHED，不填机械阶段完成数。
- 交可运行 current toolkit/同事手册、原始有限观测和 owner缺陷复现；已测ordinary/normal/recovery/native范围准确，E保独立required。

## 独立备选队列

- current B/I实际产品consumer未到先完成immutablehandle/安全纯控制、source合法输入和当前fail-closed回归；不得保留“必须出现旧bug”的green条件。
- 没有完整ownproof仅做pure/module/进程内/静态材料，UNKNOWN留根；unsafeSIGKILL/procguard/长soak不复跑，不创建平行runtime填缺口。
- exact包未到继续source/privateconsumer/rawreader/文档，current实际源与历史材料分开；缺真实native/operator数据如实未测。

## 整包完成条件

- 四成果均含实现、真实consumer、完整positive-negative、准确source/run/raw/资源证据；模块计数/normalaccept/缺陷检测不等原产品恢复或release完成。
- 只ownedpaths推 origin原 `codex/g4-trial-operations`，不upstream/reset/B-I-main-A源/E断言；12旧服务5180/8796至5191/8807及全部data/profile/tar/ledger/dirty保持。
- 真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED；无reset/topup/refund/补样/新coordinator/ledger/gate/Driver/CAC/桌面/autoaccept/第二生命周期。
- whole goal无token预算、正常节奏无当天deadline；四个runnable source早交后继续整包，未达依赖精确保留，不以更多阶段替代可用成果。
