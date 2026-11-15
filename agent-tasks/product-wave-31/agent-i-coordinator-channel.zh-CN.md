# I：原业务通信采用、恢复支持与长期兼容

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、`codex/g5-coordinator-channel`，保留历史后同步最新 origin/main。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0080主线检查点](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)。
再读 [0081](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)、[实际验收](../../reports/releases/wave31-admission/runtime-channel.json)。
固定 I `4bce0673388f22952513b5e530381f7a95e7a794`、B `fbc933166758f446ba8907ce93795d04d34d11d7`，以同步后的实际 main消费者为准。
本包三个连续交付包、每包四个完整成果，共 I1–I12；是更大产品工作量，不能只把旧测试拆成十二项。
建立或沿用覆盖整个 I1–I12 的 goal，无token预算，无当天截止；检查点尽早提交后继续整包。
外部依赖只阻对应outcome，其他consumer/实现/兼容/故障/文档继续，不逐项等主线回复。

## 归属与已验收范围

- I 只管 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/` 和自己的 runtime-channel docs/reports。
- B 管 RunnerLink/runner-service、认证routes/dispatch/lifecycle；main 管原应用authority/组合、root/contracts/config/lock/HTTP/UI。
- 不新通信server/数据库/ledger/coordinator/Driver，不成为policy/Broker/native permission owner。
- main 窄合七文件实际通道，可选薄ports/RunnerLink两小修，不带DriverKit收费review/index/resource-facts/fixtureentry override。
- actual B12与adapter8/directstrict、新I lane/handover/concurrency16与strict已真过。
- B远端callback旧stdio0frame已闭；latest concrete module/RunnerAttachChannel采用属实，无需重派nonce/namespace/prune合入小包。
- H current-source的旧sinkbug存在要求已修，当前真实nonregression消费者过，不再重复旧阻断。
- 模块100或service-shaped doubles不能证明原A持久ingress/Broker、真实SIGKILL、新PID原问题、恢复candidate/slot。
- B/H当前signaltools各有独立P1；I不修它们，不以模块handle语义授予live kill。
- 保留原完整principal/Scope/currentbinding/receipt/body与原NativeProductAttempt beforewrite；通道generation不是business fence。
- vendor/model/native0，B cap4 UNKNOWN不可花，E原pilot BLOCKED，所有ledger/dirty/12服务原样保留。
- 无新协议/CAC/桌面/autoaccept/动态DAG/第二执行生命周期，本轮专注原已存在实现的产品采用。

## 交付包一：实际主线与原 Store 的完整采用

### I1 实际 main/B 版本与必要源码闭包采用

产品成果：实际产品只使用一套已验收通信实现，采用证据指向真实运行源码。
- 绑定main新checkpoint、B service/transport和I concrete module/pulladapter的精确commit/blob。
- 必要闭包含attach/core/errors/index与实际service/endpoint/transport；区分自己模块和B adapter责任。
- 原driver-kit JsonLineDecoder/encodeFrame足够，不能把review sender/budget/diagnostics新增exports作为通信依赖。
- main原NativeProductAttempt current/digest/live AnswerAdmission不变，不把adoption当恢复已实现。
真实消费者：运行实际main/B serviceconsumer，不仅读B源码中出现RunnerAttachChannel字符串。
- 正向显式sinkguard、单transport归属、现有stdio正常reply保持，directtypedconsumer过。
- negative缺必要文件、旧blob、foreign producer、错误version在入口清楚拒绝。
- source/materialized执行前后核对，docs-only不同HEAD不伪造成runtime字节变化。
- 记录B/I index差异；I可选responder/refusals不是B七文件必需项。
证据：必要relativepaths/blob、实际import/source/命令exit和source范围说明。
- 保留actualB12/adapter8正向；不机械再跑100模块来证明采用。
- 缺mainconsumer交I-owned可运行port用法和B最小调用要求，不跨owned改service。
- source早交后继续I2–I4原authorityconsumer，不能停在manifest。
- 不新增公共contract版本或另一resolver绕过既有authorities。
- 归属不清留精确RFC给main/B，但独立队列持续。

### I2 三回调原 Store sink 的实际采用支持

产品成果：原A business ingress/payloadStore与通信hooks实际闭合，回执可追溯。
- 支持B/main caller把factSink送入原runtime ingress/UoW，ACK来自原durable事实。
- payloadhook请求保留原immutable ref与原source，返回JSON/bytes语义准确。
- 新fact ID、requestID和business commandID不得相互混用，跨kind同rawID不合并。
- 原Store/receipt是authority，I只传递验证后的request/reply，不自造persisted:true/seq。
真实消费者：一个由原Application创建的Work在实际B服务触发fact/payloadcallback。
- 正向原Store有该通道事实及原receipt，payload与同ref原body一致。
- negative错receipt factId、错payloadref/body/source、超界/超量有实际拒绝和0错误settle。
- 已settled/timeout队列项清掉，不保留可被继任再次分发的幽灵回调。
- 失败明确typedresult，不能把Store异常变成虚假ACK以维持进度。
证据：同runWork/attempt/producer、factID/payloadref、原A readback和通信frame。
- generic Store.facts/no-op participant只作fixture，不报原business采用通过。
- B缺entry时交可接原ports的I consumer，记录缺的方法并继续其他支持。
- 不修改A持久schema或复制业务ledger，需迁移由A/main处理。
- 完成实际normal回调支持后继续I3原Broker guard/问题。
- 自己只改attach-channel/src/test和docs/reports。

### I3 原 Broker fresh admission 与原问题回调

产品成果：通信无法越过原Broker对每个原native请求的许可与当前性审查。
- 保持frame fresh nonce与business command.id/body，旧allowed不允许下一intent。
- 支持原main guard async/throw语义，缺guard/deny/throw皆zero modeled/native write。
- 原question/version/target/session/contract/currentbinding来自原Store，不由I生成policy。
- 通道close/drop/rebind只描述通信，不能宣布businesscancel或resource quiescent。
真实消费者：原B/main三callback应用consumer中的实际原问题与回答。
- 正向每次legalintent调freshguard，原答复最终native_applied或准确indeterminate。
- negative旧nonce、错commandbody/target/version/epoch、guardexpired不settleallow。
- nativepending跨handover不把先前allow迁移，回原command reconciliation处理。
- 禁止用boolean guard double当原Broker证据，明确实际caller与其原checks。
证据：同runquestion/answer/commandID、freshframeID、guardcalls/effects与原delivery读回。
- 无真实vendor请求，用明确本机fake协议和真实ProductDriver/原Store。
- 不删preparedpolicy等待或放宽schemas以让fixture通过。
- main/Bauthority缺口精准交owner，不在I复制另一beforewritegate。
- 通信support发布后继续I4正常/双client整体验证。
- 模块guardresponder结果仍标module，不外推原业务。

### I4 同原 Work 的正常与双客户端采用交付

产品成果：同一正常原Work能被原client和合法继任client连续消费，三callback不重复路由。
- 使用actualB HTTP next/reply和stdio/sinkadapter，不只service-shaped mock。
- explicit CAS合法换owner；oldA使用其原generation，不能拿currentgeneration伪装旧poll。
- 同一fact/payload原ID/ref/remainingdeadline续接，nativepending未知不自动重发。
- 原Work/attempt/contract/Runner/child/session不换身份；channelgeneration不等于epoch。
真实消费者：I2/I3同runconsumer支持B包一，H可独立跑公开入口。
- 正向clientB接同Runner、原问答/Storefacts连续，guard仍由原mainBroker判定。
- negativeoldA/foreignpoll/reply/close0副作用，新remotecallback旧stdioframe0。
- sink/remote互斥settle、duplicate/lateframe与wrongproducer拒绝。
- 显式记录begin只1次与queue/connectionowner，不能用两段demo拼同Runner。
证据：原tuple、两连接代际、实际Bframes、原Store和guard/receiver计数。
- 首四outcome必须交原Store/Broker采用支持，不能只完成I1清单再等下轮。
- B/main未到仅相应actualcase未达，模块支持和可调用源码先交。
- 不跑B/H尚未准入signaltools，正常双client可无signal完成。
- 包一checkpoint发布后立即继续包二fault/backpressure支持。
- 不用测试总数上调恢复完成度。

## 交付包二：原业务继任与故障窗口支持

### I5 原 lease 继任与剩余时间窗

产品成果：旧coordinator离开后，通信能为同原Work提供准确的继任而不刷新旧许可。
- bind/state/next/reply携带原producer和explicitexpectedgeneration，非法source不改变generation。
- 回调timeout从原请求deadline计，detach/rebind不刷新剩余窗口。
- fact/payload可保原ID续接，nativeintent跨owner保持indeterminate不重放。
- 清楚区分drop旧connection、close整个channel与physicalteardown。
真实消费者：B原Store重新连接caller通过actualendpoint消费，I不建恢复coordinator。
- 正向oldclient离开/currentclient合法CAS后同fact/ref续接且deadline相同。
- negativeexpired/cancelled/closed/stalelease不能poll或reply，旧client不能关闭新owner。
- 外部fakeclock只证明logic，实际service有限时序给单独结果。
- 包括generation已更新但oldframe迟到、无当前lease等独立对照。
证据：原request/时间窗/代际、actualroute和typecode，原Work仍同tuple。
- SIGKILL只由B/H安全准入后运行，I不以自己模块PASS批准live。
- 支持无signal进程内client离开先完成，真实进程部分准确未达。
- 主业务currentbinding/epoch变化仍由原authority拒绝。
- 发布handoverconsumer后继续I6真实faultcorrelation。
- 不导出能绕开typedinput的raw pendinghandle。

### I6 原 ACK 窗口与命令相关性支持

产品成果：原业务未知写入窗口能获得准确通信结果，重试决策仍归原command状态。
- 同rawID跨fact/payload/nativekind互不settle；duplicate只能第一次settle。
- reply必须匹配producer/attempt/generation/requestkind/相关ID，不仅字符串相同。
- preserve timeout/closed/stale/denial/indeterminate typed分类，不能统一为“未发送”。
- I不生成新commandID、refund、receipt、observed或native_applied事实。
真实消费者：B原问答run各receiver/ACK/receipt窗口，通信结果与原A状态一起读。
- 正向durable receipt回原fact，正确payload回原reader，freshnativeintent回原guard。
- negative旧ACK/错误kind/错误producer/body/unknownreply不解锁错误pending。
- 原nativewritten但ACK丢失时indeterminate，通信不能返回safeToRetry=true。
- 重开后原command/state判断由B/main同一authority，不从modulememory猜结果。
证据：原command/answer/fact/payloadID、requestframe与typedfailure/receiver计数。
- B埋点缺失交最小request/result记录需求，不能自己直写A窗口表。
- modulefaults仍保其logic scope，实际原run完成单独标记。
- 补有界极端顺序和重复帧，不长soak重复普通happycase。
- 支持发布后继续I7backpressure与I8恢复候选消费者。
- 不将receipt字符串当业务已交付证明。

### I7 背压、饱和与控制请求可用性

产品成果：多回调并行/继任/慢Store下容量有限且释放准确，控制不会无限挂起。
- 原maxPending/queuebyte/timeout限制在send前检查，超界准确refuse。
- fact/payload/native并发保持各自相关性，settle/timeout/drop/rebind都精确回收。
- 不新增第二pollqueue/定时器/pendingstore，保留RunnerAttachChannel唯一实现。
- 向B明确控制priority接口和business/physical区别，不接管lifecycle。
真实消费者：actualB三callback+原Store慢ACK/guarddeny/缺payload有限并发consumer。
- 正向饱和后正确settle恢复容量，合法后继request继续，无重复dispatch。
- negativecapacity/bytesover/超时/closed拒绝不发送，UNKNOWN不伪装业务完成。
- rebind中饱和不复制队列项，不让一个connection消费另一个请求。
- 外在观察timer/waiter/queue进出，不能只看moduleclose布尔值。
证据：容量峰值/bytes/原ID/queue/waiter/timer差量与命令/exit。
- 受控参数仅用于有限测试，不提高生产上限来通过。
- 所有等待有deadline/输出上限，错误不中断其他独立验证。
- 对actualB改动交精准type/use建议，不跨owned实现transport。
- 提交后继续I8同run候选路径支持与范围交接。
- 不用设置长timeout消除race失败。

### I8 原恢复交付链的通信支持闭合

产品成果：原sameWork恢复链从问题到机器检查/候选/人工接受不被通信重复或丢失阻断。
- 对接B/main的同runoriginalA/Broker消费者，保留原IDs和实际source。
- machinecheck/currentCandidate/explicitaccept仍归原Completion/Application；I只保障所需回调。
- 在terminal之后pending处理/lateframes/closeerror不复活旧permit或污染已退役候选。
- 同run结束检查自己的timer/waiter/queue/subscription准确归还。
真实消费者：B恢复Work的原artifact/check/candidate/acceptance公开链，H可观察。
- 正向恢复问答/native_applied到原候选与显式交付，通信不重复begin/answer。
- negativeoldcontract/epoch/lateintent/oldcandidate由原authority拒绝且通信不吞异常。
- 文档分别报告actualrecovered和ordinarynormal，不能用normal5PASS代替。
- 未跑live时明确恢复进程环节未达，仍交实际正常consumer与faultsupport。
证据：exactsource/原run/typedrequests/results、原verification/candidate/acceptance引用。
- 不在I加candidate表、accepthelper或另一个releasegate。
- 可发布supportcheckpoint，但I完整goal继续包三兼容/容量/交接。
- B/main缺入口给明确函数与调用参数，继续I9–I12独立实现。
- 原vendor/native/installed未测保持，不自授studybudget。
- 默认不引新公共wire版本，需变更精确RFC给main。

## 交付包三：多槽通信、故障与长期兼容

### I9 两槽与四槽的通信隔离消费者

产品成果：原调度器实际2/4槽并行时通信状态互不越权，容量与原队列可对照。
- per-slot producer/attempt/lease/cursor/payload/receipt完全隔离，aggregatepressure有界。
- 一个slotwaiting/unknown/close不关闭其他slot，不共享businessapproval。
- actualB/Iconsumer由原scheduler运行，I不新调度器或直接写slotended。
- channelgeneration只本连接域，原businessfence/contract仍原authority管。
真实消费者：B9/B10原2/4slotrun，I-ownedprobe读取实际channeloutcomes。
- 正向每slot合法三callback完成或准确未知，正确settle归还本通道容量。
- negative错slot/凭据/source/frame/lease0跨槽settle或nativeallow。
- 第五项等待由原scheduler证明，Imodule计数不宣称产品slot已释放。
- 将自己的pending/queue/timer事实交原资源owner，保持证据非授权。
证据：原slot/attempt与channelresource映射，actualrequest/guard/result分槽计数。
- B原多槽未到，可先真实多channelcontractconsumer，准确标非调度器scope。
- 不拿syntheticresourceledger PASS代actualaggregatequiescence。
- 明确原资源unknown与通信close分别语义，不能自动release业务slot。
- 发布后继续I10shutdownfault与I11compatibility。
- 不改rootconfig/slotcontract或newglobalmanager。

### I10 故障与 shutdown 全状态收尾

产品成果：所有通信状态关闭、断连或错误时都有准确终态与资源结论。
- 覆盖open/saturated/pendingfact/payload/native、drop/rebind/close与remoteerror。
- close后旧reply不复活，timeout后队列不残留，nativepending保indeterminate。
- timer/waiter/queue/handler内异常传播明确，不能吞后返回假success。
- moduleclose不代表Runner/child/socket/fd/journal已停，保留B原physicalauthority。
真实消费者：实际B正常/继任/停止路径，I只观测自己的资源并让owner处理physical。
- 正向每种terminal能resolve/reject原pending且没有活跃通信资源泄露。
- negative二次close/晚reply/重复settle/控制中rebind不跨generation或挂起。
- malformed/partialframe与bytepressure有独立合法对照，拒绝前后owner不变。
- 有限deadline与receiver计数，未结束资源如实保留。
证据：实际source/调用顺序、typedresults、resourcebefore/peak/after与退出结果。
- pure故障先过，liveparentdeath依赖安全owner，不由I运行rawsignal。
- 不建另一个cleanupdaemon或timeouttimer来掩盖生命周期不闭合。
- 场景可复跑且不动用户服务，避免600/1800长soak替代边界覆盖。
- 源码交后继续兼容/交接。
- 对B尚未闭合physical项准确NOT_REACHED。

### I11 原公开接口与历史调用兼容

产品成果：当前消费者能升级采用通信改动，旧合法调用与typederrors仍可用。
- 保持原v1frame、structuraltypes、业务ID/nonce和close/drop语义，未获批不新wireversion。
- 检查B薄port/原RunnerLink/mainNativeconsumer directstrict/exactOptional。
- 文档明确bytes与base64开销、有效页预算、payloadchunk合法中间值由原transport维护。
- 不要求无关responder/refusals或收费module才能运行核心consumer。
真实消费者：实际main/Bsource及独立typedconsumer，不能只用自己moduletests。
- 正向原合法stdio/sink/remote与errorclassification编译、运行正确。
- negative错producer/enum/undefinedoptional/非法frame保留可判定refusal与basecode。
- 使用真实参数边界，不以typescriptany断言把不兼容隐藏。
- 当前闭包与historicallabel准确，docs-onlyHEAD不重置能力声明。
证据：API/依赖清单、sourceblobs、strictcommands/exit、兼容正负与精确未达。
- root/contracts变动先mainRFC；不得跨所有权改roottsconfig/lock。
- 避免新abstractbase或重复broker，只有真实减少复杂度才加局部helper。
- 与B/H同sourceconsumerrun建立可追溯调用示例。
- 发布compatibilitycheckpoint后继续I12最终handoff。
- 保留上游MIT与原框架依赖，不建nestedrepo。

### I12 可复现采用手册与完整源码交接

产品成果：B/main/H/D/E能按一份准确手册接入同一实现，调试失败不依赖I口头解释。
- 给actualmain/B最小必要sourceclosure、三callback调用图、原authority归属和错误处理示例。
- 操作示例使用原Store/Brokerconsumer，原identity/deadline/lease/reconciliation来源清楚。
- D/Einstalledconsumer只能从exacttar取入口，sourcecheckout例子不补包内缺功能。
- runtime变化需Dfreeze/Eexactartifact，docs-only不假造refreeze或label新package。
真实消费者：独立H能运行当前consumer，并把结果与原run数据source对应。
- 正向同source/同contract/同runtimeblob调用成功并准确收尾。
- negative缺entry/错blob/oldsource/wrongroot不悄悄fallback到当前checkout。
- native/vendor/installed/recovered各scope分别标记，不靠列表全PASS承诺未跑能力。
- 更新 `reports/runtime-channel/wave31-status.json` 记录十二outcomes与未达，不按测试数提完成度。
证据：exactcommits/blobs、commands/exit、runnableconsumers和main/B/H引用清单。
- 只提交I-owned显式paths到origin原分支，不pushupstream或改他人dirty。
- 已关闭旧repair准确保留，不将本轮source采用重复称新突破。
- 交完仍需独立队列收尾，只有十二成果真正满足才completewholegoal。
- no modelturns、no signals、no newpermissions，不代替B/H安全或E最终准入。
- 通信采用证明产品可接线，不能单独宣称原恢复/发行全部通过。

## 独立备选队列

- actualB/mainconsumer未到，交能直接接原ports的I-ownedconsumer和明确调用要求，继续fault/capacity/compatibility，不只写adoptionmanifest。
- B原恢复阻塞只标相应case未达；正常原Store支持、无signal双client、typederrors与shutdown可独立推进。
- H未到给exactsource/原run/公开consumer，不替H生成独立报告或改required。
- pure安全工具未准入不跑liveSIGKILL；I的mockPASS不是B/Hsignal授权。

## 整包完成条件

- 十二完整outcomes各有source/actualconsumer/positive/negative/准确范围，模块logic与原业务证据分列。
- 三checkpoint提交后继续，整包不以首次测试绿、模块100或一个文档链接作为停止点。
- 只修改attach-channelsrc/test与docs/reports，不改runner-service/rootcontracts/config/lock/mainUI/Eassertions。
- 保留原data/dirty/ledger/tar和12服务；vendor/model/native0，UNKNOWNgrant和BLOCKEDpilot不变。
- 不建第二coordinator/ledger/gate/server/调度器，也不接新Driver/CAC/desktop/autoaccept。
- 整包结束给实际可运行采用路径、原业务支持缺口和精确source，不能按耗时或阶段数量替代成果。
