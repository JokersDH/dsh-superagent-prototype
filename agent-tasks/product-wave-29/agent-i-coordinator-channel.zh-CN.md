# I：latest 唯一通道的真实采用与消费者完整性

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、原分支 `codex/g5-coordinator-channel`，保留历史后同步最新 `origin/main`，记录准确source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0073](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)、[0074](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)、[0075](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md) 和[验收](../../reports/releases/wave29-admission/runtime-channel.json)。
仅拥有 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`，明确从B广Runner范围排除。
B唯一管runner-service/RunnerLinkClient、auth/routes/dispatch/begin/prepared/physical lifecycle；main管contracts/root/授权，H独立consumer，I不接管policy或signal。
固定 `4d85cc349fba81a3f3d0149f1803e77d4ea454b8`：fresh salted intent、kindnamespace、settlement/timeout prune独立通过，65/65与directstrict0，禁止重复写旧fix。
B c2ea已删除自建channel并引用I，但vendored仍bf5b25a旧module；latest d1ef81/attach321738未到实际B，H仍消费旧admitted材料。
不新server/wire/DB/ledger/Driver/approval/执行生命周期；成功许可不缓存，moduleclose非quiescence。正常节奏，无当天deadline/删门槛。
wholegoal无token预算，24阶段在4/8/12/16/20/24交六个完整runnable source后继续；I已过范围保留，未到B/H的结果不伪造完成。

## I1 exact latest 采用清单

给B/main/H精确module/errors/index/attach/相关test/docs/source/blob，标清B旧bf5与latestd1/321差异，不能仅凭同路径名称称已采用。
B通过原branch合源而非手改I subtree；I不越界改runner-service/root，协助真实consumer解决类型/适配问题。
保留B已用I且自建文件已删的事实，不再报告旧maps15或“仍有两份Bchannel”，问题是修复版本/实际adapter未采用。
验收：actualsource与import链可核对，directconsumer能编译，最小需要的合入清单真实而非文档计划。

## I2 实际 RunnerAttachChannel 消费

将B手写connections/currentConnection/queue的必要transport行为对齐自有pulladapter，pending/timer/correlation/prune只在I一处维护。
保持bind显式CAS、next只读、原connectionreceive/close，queue按kind命名空间且在settle/timeout/rebind/drop去旧项。
actualnext返回remainingdeadline不刷新，Bauth/路由仅适配已有schema，不创建第二server或长期复制queue修正。
验收：B真正调用RunnerAttachChannel，same raw fact/payload id与过期outbound独立正反例在实际consumer通过。

## I3 权限职责与 sink 反例支持

为B复现sink-only guard0自批提供实际moduleconsumer，I只传原意图，不以businessClosed/FactSink/连接存在默认许可。
明确三个coordinator callbacks需原A事实sink、immutablepayloadreader和main/Broker fresh nativeguard，missing/deny/throw都不native写。
示例/responder不内置always-allow策略，fakeguard只标测试double；业务command原ID不变，回复回收到的freshframe.id。
验收：最新I source下的正向fresh调用与缺失/错误/旧回复negative，B自己的policy错误由B修，不在I新增grant。

## I4 第一结果：实际 B latest 采用

I1–I3形成exactlatest source/realpulladapter/actualBconsumer和权限职责的完整采用结果，不只I再次跑65测试。
含Bmerge和module版本、sink/stdio/HTTPcorrelation、queue和guard反例，main/H可复现对应调用。
外部B尚未切换时如实NOT_REACHED，source可早发但不假称B已修；继续后续独立实现/兼容。
发布I4 checkpoint后继续I5–I8，wholegoal未齐不结束，不为新一天压力删门槛。

## I5 同 controller 与原 A 回执

fact仍原ID/body跨重绑等durableACK，actualApublicsink/ingress幂等决定结果，in-memory DurableSink不能升级持久业务证明。
错误receipt.factId/persisted/source/fulltuple/旧lease不能resolve当前pending；pendingdeadline不因重传刷新。
H/Bconsumer保原Work/question/attempt/provenance，不另建SQL/ledger/coordinator，也不从任意receipt总量推原业务完成。
验收：actual持久consumer与duplicate/conflict/late/unknown有限矩阵，事实重发不是业务command重发。

## I6 immutable payload 与有效上限

同ref重读仍由原Store/responder定义内容/权限，I只关联/校验/限制，不能自己创建内容authority或长cache。
对Bstdio/HTTP实际有效bytes/pending上限明确，合法135540 journal分块回放和三callbackpayload支持的scope分别记录。
wrongref/request/source、late/超界/不可序列化和timeout回收不伤其他pending，超限明确拒绝而非默默截断。
验收：actualadapterconsumer正常/重绑/边界与失败，sharedschema/wire不变，无第二payload实现。

## I7 fresh native 语义保持

每次合法意图freshframe.id唯一，原command/body/nativebinding不变；已settled/timeout/close的allowed/denied不能决定后续意图。
pendingnative detach/rebind为indeterminate，不迁移许可、不自动重发begin/answer，caller回原command reconciliation和mainfreshguard。
correlation跨module实例不重复、safe上限/容量耗尽准确处理；fact/payload原关联仍兼容，不因nonce修复误改业务ID。
验收：已闭fresh-replay、deny/同command并发、namespace/timeout正反例保持，实际B responder用frame.id回复。

## I8 第二结果：原三 callback 重绑

I5–I7同controller经A→B跨client接原sink/payload/guard，记录原IDs/intent/receipt/generation/真实回调，不拼三个孤立double。
actualBadapter使用latest源，缺B产品consumer时仅module/consumer范围通过，normal/live/原A恢复分开。
第二完整结果包括数据连续性与fresh权限，不靠sourcehash、typedinterface或booleanfixture自授product/native准入。
发布I8 runnable source/consumer后继续I9–I12，H未到不成为停止自身fault工作的理由。

## I9 timer 与 single settlement

注入clock/timer维持原deadline，重绑不刷新；timeout/reply、send同步/异步失败、close/rebind竞争最多结算一次。
旧timer/旧intent/旧connection不复活，native未知不因超时变未发送/可重放；fact/payload剩余窗口准确。
用publicinterface和timer/caller观察，不暴露private maps或给probe新空方法，不无期限sleep/poll。
验收：actualconsumer在所有有限race回收timer/pending/bytes，原65相关范围不因B采用而倒退。

## I10 active bounds 与 transport queue

constructor per-kind/totalpending/request/reply/payload/queue/settled状态有界，非法值和超限在发送/昂贵处理前拒绝。
queue是transport待送状态而非第二pendingauthority，每kind/correlation只一个outbound，settle/timeout/drop立即prune。
饱和后控制/关闭可用，重绑/错误不漏容量或授权；bytes限制与B实际route一致，不仅未被service消费helper正确。
验收：sameRawid、刚好边界/超界、timeoutholes、重复rebind/容量恢复都由选定实现和实际consumer验证。

## I11 close、late 与隐私

旧lease.close不伤新lease；module.close拒后续工作、结算pending，未决native保持indeterminate而不是成功/普通closed。
回复schema/producer/correlation/源generation严格，B不得把旧socketframe转当前lease绕过structuralfence。
错误只有限IDs/code，不含payload/credential/私有path/stack，成功/拒绝/unavailable/unknown语义准确。
验收：合法关闭和wrong/late/replay/timeout独立控制，无未结promise、假许可或“channelclose等writer停”声明。

## I12 第三结果：active 模块故障闭合

I9–I11联合actualB adapter检验timer/bounds/prune/close/fresh/source，不拿I自己测试替代所有实际接线。
directmodule/main/B/Hconsumer strict/exactOptional通过，localv1/frozenRunnerwire不变，错误/回调返回类型一致。
第三完整结果给出可复用implementation故障矩阵与真实consumer，不以数字测试数量升级native/release。
发布I12 checkpoint后继续I13–I16的跨owner实际观察与回归支持。

## I13 H exact selected-source 消费

给H currentadmittedcommit/blob/dependencyclosure，不能继续以d95旧快照复现旧bug后称currentmodule通过。
H在自有树执行原三callback/CAS/late/fresh/namespace/bounds，I修自己实现，不改H/E断言或复制测试专用class。
source时间、旧材料、已闭范围与新实际执行清楚，docsonly移动不该伪造新runtimeartifact。
验收：H actualconsumer与I/B真实source对应，引用同一implementation/adapter，无第二coordinator/ledger/gate。

## I14 B 认证和类型配合

B保fullproducer/CASauth和read-onlypoll，I只输出真实lease/失败，不接管principal/currentcontract/nativepermissionpolicy。
配合B修actualrefusalcodeunion/consumercompile，错误不靠uncheckedcast或unknownoutcome兜底失去语义。
actualsink/stdio/HTTP桥只传existingv1frames和原lease，queue/correlation规则不回流到B多处分叉。
验收：错source/oldpoll/CAS/late、合法新intent/source回调在actualBadapter过，独立main消费者编译可复用。

## I15 原产品和 safe 进程范围

消费B/main原A/Broker/问题/答案/候选支持资料，I模块不变成应用业务authority，也不signal或新起native进程。
B/H先过birth/exactargv/root/config/op/UNKNOWNpurecontrols，之后任何live均由B/H自身安全工具与原resourcebarrier执行。
normalCandidate5/5和I65模块scope保留，不贴为原A SIGKILL/业务恢复已完成，source缺口精确提供owner。
验收：module/Badapter/原产品consumer分层可追溯，I不越界改lifecycle、SQL、HTTP或guard策略。

## I16 第四结果：真实跨 owner consumer

I13–I15组合H独立current-source、Bauth/typedcallback和原A/Broker消费支持，source与行为匹配，未到的步骤NOT_REACHED。
latest采用不只是目录存在；核对B实际blob/adapter、typed错误与guardcallback，H记录actualmethod/results而非scenario列表。
第四完整结果不授native/物理quiescence/全产品准入，原ordinary App/install不依赖I live完成。
发布I16 source后继续I17–I20，把可复用接口/实际操作交清楚。

## I17 业务恢复的明确 interface

与B/main明确originalA新进程、原question/nativeApplied/ACKunknown和Completion/slot链需要哪些现有callback，不扩I为coordinator。
原事实/payload可重读与业务command不可自动重发的语义始终保留，modulegeneration不能替代业务epoch或grant。
缺共享字段交main最小actualconsumer/RFC，原v1/localschema和权限不随测试便利改变。
验收：B consumer知道何时等待/拒绝/unknown，caller不用另建pending/timer/授权规则才能用I。

## I18 实际 source 兼容与导出

核mainsharedinterface/Iexports/RunnerAttachChannel/BRunnerLinkClient/Hconsumer同源同义，optional字段strict且frame.id/businessid区别可编译。
source/build/runtimeclosure清单完整，pkg/exports/docs引用实际file，不要求main导入测试fixture或私有临时路径。
旧合法facts/payload与freshnative同时正常，任何错误码/时间单位/关闭含义改变都有真实consumer和有限回归。
验收：实际编译与行为而非复制同名type声明，root/contracts变更仍由main控制。

## I19 可复用运行文档

更新constructor/CASbind/三callback/queue/remainingdeadline/close、latest采用和Bpolicy分工，列可运行正常与失败命令。
清除过时B未用I/旧maps、旧frameid复用、callback自动许可和close即quiescent等声明，不教用户删ledger或借credential。
错误排查有限code/原IDs，不泄露payload/key/root，H可独立生成合法positive/negative而不用读private implementation。
验收：独立开发者按文档消费唯一module，深度来自复杂性集中，不靠额外server/ledger/生命周期。

## I20 第五结果：真实可复用交接

I17–I19形成B/main/H实际interface、兼容与可操作文档，source早交后更新真实consumer，不以额外gate或静态图完成。
跨进程SIGKILL/原A恢复、candidate/manualaccept、slot释放仍由B/main完成，I只按实测范围标支持/未达。
第五完整结果必须说明当前B包含哪些latest功能，缺少时准确partial并继续可独立fault/docs。
发布I20 checkpoint后继续I21–I24，wholegoal真齐才完，不把交付数量当实际准入。

## I21 风险相关完整回归

按本轮source变更回归freshnonce/CAS/bytes/timer/queue/prune/close/producer，原65相关scope保持，不机械跑无关长suite。
新增actualBadapter错误/缺guard案例由B/H执行，I只保证module本身不造policy，不为probe添加隐藏方法。
每项fault有独立合法positive和有限deadline，所有promise/timer/资源结论明确，短序列不称长期soak。
验收：selectedimplementation/consumer在声明bounds内，错误和unknown不变假成功或无限重试。

## I22 依赖与 packaged scope

给main/B/D精确runtime source/type/export/build依赖和旧wire不变证据，不把fixture/double/key/nativeprofile带入运行包证明存在。
source实际改动的installed结论由D/E同artifact独立做，docs/test-only不强制假refreeze或贴旧tar新native能力。
H材料需按exactselectedsource重跑消费者，历史快照保留但不得充current；I不接管Erequired。
验收：source、consumer、包内入口、已测layer与限制清楚，无跨owner metadata churn。

## I23 正常节奏维护完整性

记录剩余owner依赖和实际port，早交source后持续独立队列，不因缺live/native样本或某个root功能未到停止module工作。
不扩大到newserver/DB/ledger/Driver/CAC/桌面/autoaccept/guard授权/执行生命周期，也不研究价格/计费recipe。
所有复现仅明确privatefixture，无global发现/其他credential/旧服务操作，I不signal任何旧或不确定进程。
验收：真实源码/文档/消费者一致，不设当日deadline或token预算替代质量门槛。

## I24 第六结果与最终状态

写 `reports/runtime-channel/wave29-status.json`，列24阶段/六结果、main/B/I/Hsource/原producer/connection/intent、命令exit/真实回调/未达。
只ownedpaths推origin原 `codex/g5-coordinator-channel`，不upstream/reset/改Bflat/root/contracts/A SQL/E断言，旧dirty与12服务data/profile/tar/ledger保持。
真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED，无reset/topup/refund/补样。
第六结果是latestmodule真实采用、完整interface/consumer/fault/docs；source在4/8/12/16/20/24发布后继续wholegoal，不把partial称业务全恢复。

## 独立备选队列

B采用未到先给exactsource/adapter/consumer和最小复现，继续module故障/兼容/docs，不重写已关freshnonce或抢Bpolicy/lifecycle。
Hcurrentconsumer未到可执行自己的actualinterface正负例，但不能把旧H材料或contract列表当独立最新运行。
main共享缺口交真实consumer/RFC，原normalCandidate/普通Appscope保留，缺实际native输入不申请预算填样。
所有等待/验证有限，owner独占和wholegoal持续，checkpoint不是停工点，配置/目录/readonly材料都不授执行权。
