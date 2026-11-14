# I：具体 CoordinatorChannel 深模块与真实 B adapter

2026-11-14。新目录 `/Users/hh/Desktop/joker/superagent-agent-i`，分支 `codex/g5-coordinator-channel`，由 main 创建后使用，不另建嵌套仓库。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0068](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)、[0069](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)。
仅拥有 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`。
main 将这两个 Runner subtree 从 B 广路径中明确排除。B 仍唯一拥有 runner-service/RunnerLinkClient、HTTP auth/dispatch/begin/prepared/lifecycle 和其余 Runner 源。
main 正发布 `packages/contracts/src/coordinator-channel.ts` 的小 interface/local schema；以实际 latest origin/main/0068 为准，I 不修改 contracts/root/runner-service/recovery transport。

目标是一个具体 CoordinatorChannel module，集中原 factWaiters/payloadWaiters/writeWaiters 的连接、超时、回复关联和重绑复杂度，不加一层 pass-through 留旧 maps 永存。
interface 仅围绕 recordFact/readPayload/beforeNativeWrite、bind lease 与必要关闭语义；constructor 固定 producer，注入 bounds/clock/timer，不自行创建网络/DB/进程。
复用现有 v1 fact/payload-read/native-write-intent 与 receipt/payload/write-admission/ack-failed；不新增 server、wire 版本、ledger、Driver、授权或执行生命周期。
main/Broker 保持逐次 fresh 写前授权；channel 只传原请求/回调，成功许可不缓存复用。H 可独立消费测试，不修改 I 实现。
十位外部 A–J 加 main 按正常节奏做完整产品，无当日 deadline 或门槛删减；建立 whole goal 无 token 预算，I4/I8/I12/I16/I20 五个完整结果交 source 后继续。

## I1 理解现有实现与 interface

读取 B/main 实际 runner-service 三 waiter maps、fact journal/sink、payload 与 native-write hook，以及原 RunnerLinkClient responder 的调用关系。
按 codebase-design 使用小 interface 隐藏复杂 implementation，caller 不需要同时维护另一套 pending map、timer、generation 或回复去重。
明确 constructor immutable full producer、request 身份、bind ordering、错误/超时/容量和 close 不变量，不能把模块深度误写成代码行数。
读 main 小 interface/local schema，给 B 一份实际 adapter 调用片段与最小缺口；不复制 private DTO 或修改 frozen Runner wire。
验收：每个 caller 知道何时等待、哪类请求可重读/重发、哪些结果未知，源码能承载而不只交接口草图。
接口早期变化交 main/B 具体编译/行为复现，继续可独立实现，不新造第二 coordinator 或测试专用空方法。

## I2 immutable producer 与 CAS bind

实现具体 CoordinatorChannel，constructor 用 main schema 固定完整 producer/attempt/source；不依赖后来可变对象或调用方随时替换身份。
bind 消费 full producer、connectionId、expectedGeneration、send，返回绑定该 generation 的 receive/close lease；精确行为以共享 interface 为准。
同一时点只有一个 active lease，expectedGeneration 做比较更新，失败不改变当前连接；替换必须原子失效旧 lease，不双活或静默抢占。
完整 tuple/source 不符的 bind/reply/request 在发送或 resolve 前拒绝；connection generation 不代替业务 fence epoch/主线授权。
验收：合法首次/明确替换与并发 CAS、错 source/attempt/contract/expectedGeneration 独立 positive/negative，旧 receive/close 不伤新 lease。
不创建 socket、credential、server、driver 或 DB；transport send 是 caller 注入的 adapter，不成为新的执行权威。

## I3 三 callback 的实际单连接行为

recordFact 接原 CriticalFact，等待与原 factId 匹配的合法 durable receipt；payload 和 beforeNativeWrite 分别关联原 ref/request/command。
用原 v1 request/reply frame 和 main local schema，不把未经校验 JSON 或任意消息类型当回复，也不新增 wire 版本。
readPayload 返回原 immutable reference 对应的合法 JSON，并受 bytes 限制；beforeNativeWrite 仅发原意图并等待当前 coordinator 的 fresh 回答。
每次请求注册 timer/pending 后才发送，处理同步 send/同步 reply/发送失败；失败结算一次、释放自己的 timer/pending，不吞成成功。
验收：实际三个方法的正常、ack-failed、拒绝和错误关联通过同一个 interface，不用三个彼此独立的假模块。
成功许可只结算当前意图，不缓存给下一调用；模块不知道也不改变 native 实际发送、执行生命周期或物理资源。

## I4 第一结果：具体三回调 module

交完整可 import 的 source/exports、严格类型、最小 B adapter 示例与调用顺序文档；main/B 能早期实际使用 constructor/bind/三个方法。
interface/local schema 遵循 0068，clock/timer/bounds 注入使故障可有限验证；默认值明确，不无期限等回复。
用合法原 fact/payload/answer 与原式 receipt 的完整正对照，不以 malformed schema 代替 stale/source 拒绝。
第一完整结果是 I1–I3 的具体实现加同一 controller 单连接的三个真实请求/回调，而非 constructor skeleton 或测试类。
记录 source、接口、方法/错误/计数/bytes 与未达范围，明确此时未证明同 Runner 进程或跨 coordinator 崩溃恢复。
发布 I4 runnable checkpoint 给 B/main/H 后继续 I5–I8，不等待下次派工才实现重绑。

## I5 facts 重绑与 A durable ACK

同一个 channel controller 经 client A 断开再 bind client B，原未决 facts 可用同 factId/body 等 A durable ACK，保持原 immutable 身份。
采用现有 A public sink/产品 ingress 的私有合法 consumer 或 B 提供实际 sink，不新 SQL/ledger；fixture 的 persisted:true 字符串不证明落盘。
重复 facts 依赖原 A 幂等，冲突 body 拒绝；旧 generation receipt/ack-failed 无法结算新连接的 pending。
receipt.factId 与当前原请求精确一致，合法 seq/persisted schema 验证，错 factId 或错误来源不 resolve 原 promise。
验收：同 controller 两 client、原 sink 真实回执与重复/冲突/晚到各有有限证据；没有 durable ACK 时保持未完成/unknown。
此处只允许数据事实重传，不派发或重发 begin/answer 业务命令，不宣称模块提供 durable exactly-once 执行。

## I6 immutable payload 的重读

readPayload 的 pending 关联原 immutableRef/请求身份和当前 lease；断开后可在新 client 重读同一引用，不自动换引用凑结果。
合法 payload 由现有原 Store/responder 返回，caller 继续负责原 content/digest 语义，channel 保证关联、schema 和字节限额。
旧连接相同 requestId 的晚 payload 仍被 generation fencing 拒绝；新请求不能误收另一个 ref/producer 或上一请求的值。
大 payload/无效 JSON/错误 frame/发送失败/timeout 有明确结果，超限在模块约束内拒绝而非让 pending 永久占用。
验收：正常重读、原值不变、旧回复不生效与 bytes/pending 回收，仍通过同一个 module interface。
不在 I 新建 payload 数据库、持久 cache、分块 HTTP endpoint 或另一个数据权威，B 保持 transport route 和 payload protocol owner。

## I7 原 native 意图的 fresh 核对

beforeNativeWrite 只表达原 answer/native 意图，当前 coordinator adapter 每次委派 main/Broker fresh guard，再回复允许/拒绝。
断开或重绑时原未决写 promise 拒绝/indeterminate，不自动迁移；caller 回原 command reconciliation 后才可发起 fresh 意图，旧 allowed 不得复用。
成功后后续相同文本/command ID 的调用仍需合法当前核对，模块不得把成功结果缓存成通用批准或跨 request 复用。
若 caller 已无法确定 native 是否发送，返回/传播 indeterminate 交 B/A 原恢复语义处理，channel 不能重发业务命令消除未知。
验收：实际 fresh guard 计数、allow/deny、断连/旧 allowed 晚到与 wrong full tuple 都在副作用前正确处理。
native request/target 细节由原 immutable binding/主线 guard 核对，I 不发明第二 approval/permission grant。

## I8 第二结果：同 controller 两客户端

把 I5–I7 合为同一个 controller 从 client A 到 B 的实际事实 sink、payload 和 fresh guard consumer，而非分散 mock 字符串。
明确 active lease/generation/request 与真实 callback 的归属，A 旧 receive/close 和迟到结果无法改变 B 的 pending/许可。
记录 actual A sink/Store、原 fact/ref/command、guard 调用/回执/错误与 bytes/timer；测试输入不含真实 credential 或模型资源。
第二完整结果为可运行双 client 真实三回调路径，仍不自称 B Runner 进程、coordinator SIGKILL 或原生兼容已通过。
source 与消费示例早交 B/H，明确 transport adapter 的职责与尚未由 B 接入的步骤。
发布 I8 checkpoint 后继续 I9–I12，B consumer 未到时转有限故障/容量，不无限等人。

## I9 B 实际 adapter 消费

与 B 对齐其真实 runner-service/RunnerLinkClient 的调用和 frame 路由，提供可编译 import/types/错误与 lease 生命周期示例。
B 负责认证/绑定 producer/当前连接与原 lifecycle，I 只接 B 已验证的本地 frame/回调，不绕过 HTTP auth 或主线 fresh guard。
发现 B adapter 仍保留原三 maps 时给准确替换点和真实复现，不在 I 目录造并行的 server/controller/lifecycle 帮它凑通过。
main shared interface 缺字段时提最小实际 consumer/RFC，I 不直接改 contracts/root/wire，不和 B 并发编辑原服务。
验收：B 的实际调用跨进 I module，三个 caller 不再各自管理 pending/timer/generation，direct strict/exactOptional 通过。
按已到 source 渐进交接，不要求 main 先发布整个 B 恢复包才能让具体 module 被消费。

## I10 删除重复实现的配合

按 module 的删除测试检查复杂度：接 I 后 B 原 fact/payload/write waiter maps 应消失，而不是多一层接口并原样留在旧管道。
I 的 implementation 将 correlation、timeout、bytes/capacity、lease fencing 集中一处，caller 只适配原请求/回复，避免 N 处复制规则。
给 B 重入/关闭和旧正常链必要回归输入；B 唯一调整 dispatch/begin/prepared/stop，I 不接管这些职责。
短期兼容桥如存在，明确退役条件并促成此包实际删除，不能长期双写 pending 或双发事实/许可。
验收：源级调用清单与实际三 callback 计数证明只有一个 pending owner；源码 grep 只能辅助，不代替真实行为。
B 尚未完成删除时准确记录该结果未达，继续 I 自有实现/故障，不把计划或两个 fake adapter 算 B 接入。

## I11 真实 Runner consumer 与身份

消费 B 提交的同 Runner/child 双 client consumer，核对原 producer/attempt/session/command/ref 和 actual A sink/guard 事实。
B 负责进程出生/物理资源与业务 epoch，I 不独自 signal、启动原生进程或新增执行入口；module generation 不证明 writer quiescence。
联测旧 lease reply/close、连接断开、partial receipt/payload/guard 和新 client 正常路径，未测范围精确分层。
H 可从独立测试目录调用同一 interface 复现，I 修自己 subtree 缺陷，不改 H/E 的断言使测试通过。
验收：actual B consumer 调同一个 CoordinatorChannel，而非测试替身/另一份 receipt-only coordinator，旧源/新源身份可追溯。
无真实 B consumer 时只承认 module/same-controller 范围，给 source/RFC 并继续 timer/capacity/strict 阶段。

## I12 第三结果：B 去旧管道接入

第三完整结果为 I9–I11 的实际 B adapter、原三 maps/重复管道退役及真实 Runner consumer 的三回调接入证据。
记录 B/I/main/A 精确 source、consumer import、原 identities、actual方法/回执/guard计数和未达步骤。
不把单连接 unit、模块两个 client 或接口文档贴成 B 进程/原 native 恢复准入；coordinator SIGKILL 和业务交付仍由 B/main 完成。
有外部依赖时诚实标 NOT_REACHED，source 可先发布但该结果不伪造 PASS，继续 I13–I16 完整故障。
caller 只知道共享 interface 的不变量/顺序/错误，不需要窥探 private maps 或实现细节；不为探针加空方法。
发布 I12 source checkpoint 后继续整包，不以 B 阶段未到为无限轮询或停止自身工作的理由。

## I13 clock/timer 与结算竞争

注入 monotonic clock/timer adapter，定义每类请求 deadline、重绑后的剩余时间和 close 的结算语义，避免 timer 永久悬挂。
覆盖 timeout/reply、close/reply、send failure/synchronous reply、rebind/late reply 的竞争，最多结算一次且移除本请求资源。
timer 取消只取消对应 pending，不能误删另一请求/lease；过期回调或同 ID 再调用不复活旧许可。
未知原生结果不因为 timeout 自动变未发送/允许重发；facts/payload 合法重读与业务 effect 仍区分。
验收：全部通过 public interface、注入 timer 和 caller 观察验证，不暴露 private map 作为测试 interface。
测试等待有限，使用可控时钟推进，禁止无限 sleep/polling 或真实模型调用填充故障窗口。

## I14 bytes/pending 容量与拒绝

constructor bounds 校验 finite safe values，明确每类/总 pending、请求/回复 bytes、错误文本和 queue 的最大值。
容量满、单体超限、坏 JSON/frame 和 send 不可用在对应作用前拒绝；不能先创建无界 pending/timer 再返回普通成功。
native guard/控制相关 pending 保持声明的优先级，不让大量 payload/fact 请求拖垮必要关闭；不引入新的业务调度器。
大合法 payload 边界正对照与刚超限负例并存，correlation ID/receipt schema 错误不误耗另一请求的资源。
验收：饱和、回收、重绑、超时后容量恢复，错误有明确 code，资源规模受 constructor bounds 约束。
不抬 shared schema/global wire cap 来迁就测试，不新建 spill DB/ledger 或长期缓存未授权数据。

## I15 晚到、关闭与秘密最小化

精确区分 lease.close 和 module.close：旧 lease 关闭不伤新 lease，module.close 终止全部 pending/timer 并拒绝后续请求/bind。
close/rebind 的错误不能被转换成“已准许写”，旧 generation allowed/payload/receipt 都不能误 resolve 当前 promise。
拒绝 unsupported frame/type、错 source/full tuple/factId/requestId，保留合法重读/ACK 正对照，不能只测无效 schema。
错误/可读诊断只给有限 IDs/状态，不记录 payload 原文、credential、私有绝对路径或原始 stack。
验收：关闭后调用/旧 receive/晚 timer 无副作用，秘密与 payload 不出现在错误或报告，caller 可确定需补数据还是 unknown。
不声称 channel close 停止物理 writer；资源/barrier 由 B/main 原控制端证明。

## I16 第四结果：完整模块故障与 strict

将 I13–I15 与真实三 callback/双 client positives 组合，形成可重复的有限故障/容量/late/关闭矩阵。
direct actual-module 和 B/main consumer strict/exactOptional 覆盖新源；不要用未包含文件的 root typecheck 代替。
保留具体 send/receive/receipt/guard 和 timer/capacity 观察，quiescence/native/vendor 未测不贴 PASS。
所有测试仅 owned private fixture，不进用户12实例，不借其他 credential，不使用 global discovery 或实际厂商CLI。
第四完整 runnable 结果包含完整 implementation、跨调用不变量和消费者类型，而非数字工具函数小测试。
发布 I16 checkpoint 后继续 I17–I20 的真实兼容、文档与模块交付。

## I17 H 独立 consumer 与复现

给 H 与 main 同一个公开 interface、最小 fixture 和实际 B adapter source；H 在独立路径写合法 consumer/fault，不并改 I。
独立消费者要能做到原 fact receipt、immutable payload、fresh guard 的同 controller 重绑，不只构造 schema JSON。
收到复现先定位自己 implementation 或 B adapter 的具体 owner，提供 exact input/source/error，不能要求别人放宽断言。
坚持只有一个 module implementation 和当前 concrete B adapter，避免为了 H 另做只有测试可用的平行 class。
验收：independent consumer 在相同源码范围复现 positive/negative，源码相同并不等于完整产品/native准入。
H 输入未到继续自有故障/兼容和文档，不无限轮询或让独立验收成为不交源码的借口。

## I18 interface 兼容与迁移完整性

核对 main shared小interface、I exports、B adapter/RunnerLinkClient 和现有 frame local schema 一致，原 v1 wire bytes 不变。
错误、timer/bounds、CAS generation 和 receive/close 的含义写入最终 interface 文档，不留 caller 需要猜的时序知识。
旧合法调用与同源新 consumer 都能严格编译，optional字段符合 exactOptional；未实现新能力不得用空方法返回绿灯。
事实幂等仍 A 原 sink 保证，payload immutable 仍原 Store，native approval 仍 main/Broker；模块无隐藏 DB、permission 或 lifecycle。
验收：实际消费者兼容和旧重复实现删除的源/行为证据齐备，局部变化按风险回归，不机械增加测试数量。
若共享interface需要修正交main最小RFC，不越权修改root/contracts或B原服务。

## I19 操作文档与模块可复用性

在 docs/runtime-channel 给具体用法、三 callback、bind lease/CAS/关闭、可重传数据与不可重发业务 effect 的准确说明。
说明同 controller 重绑可解决哪些进程内通信问题，哪些跨 coordinator/crash/durable/native问题必须由 B/A/main 完成。
用可运行 consumer 展示 constructor注入、合法frame、错误/unknown 与资源结算，不只画接口图或写“exactly once”。
保留实现集中性：新 caller 不必复制 waiter map/timer/retry逻辑，删除module时复杂度会回到caller，这才是本包的深度价值。
验收：独立开发者按文档消费实际 module，不新server/DB/ledger/Driver/wire/lifecycle，也不需要隐藏测试方法。
正常节奏交完整结果，无当日强压、token预算或真实模型 allowance；checkpoint不是等待点。

## I20 第五结果与最终 source 交接

写 `reports/runtime-channel/wave27-status.json`，列 I1–I20/五结果、main/B/I/H source、原 identities、命令/exit/实际回调与未达项。
第五结果包括具体可复用 module、B真实 adapter、完整故障/消费者兼容、操作文档，不只又一份测试 gate 或 interface草图。
4/8/12/16/20 source发布后继续 whole goal，外部步骤未达准确标记，不把 partial module 叫完整原业务恢复。
显式 owned paths 推 `origin` 的 `codex/g5-coordinator-channel`，不upstream/reset，不改B/runner-service/HTTP/recovery/root/contracts/A SQL/E断言。
真实 vendor/model/native 0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样。
十二用户实例与全部data/profile/tar/ledger/dirty保持；I不signal任何旧/未知进程，不新Driver/CAC/桌面/autoaccept/第二生命周期。

## 独立备选队列

共享interface尚未到先读原三maps和v1frame，给最小实际需求并做可注入implementation；interface发布后立即对齐，不能长期维护私有复制版本。
B adapter未到先完成同controller双client/真实sink-payload-guard、timer/容量/late/close/strict和文档；准确记录B真实接入仍未达。
H consumer未到继续自有source/可复用consumer和故障，不因缺额外gate停工，不抢B生命周期或main/A授权所有权。
所有观察有限，只有明确私有fixture；旧服务/凭据/队列/restore标记都不操作，configuration/readiness/目录材料不授业务执行权。
