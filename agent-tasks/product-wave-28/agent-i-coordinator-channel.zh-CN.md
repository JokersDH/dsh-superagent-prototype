# I：唯一具体通道、fresh intent 与真实 B 接入

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-i`、原分支 `codex/g5-coordinator-channel`，保留历史后同步最新 `origin/main`，记录准确source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0071](../../docs/rfcs/WP-16/0071-wave-28-architecture-inputs.md)、[0072](../../docs/rfcs/WP-16/0072-wave-28-integrated-delivery-packages.md) 和[固定验收](../../reports/releases/wave28-admission/runtime-channel.json)。
仅拥有 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`，这些subtree从B广范围明确排除。
B唯一管runner-service/RunnerLinkClient、routes/auth/dispatch/begin/prepared/process/lifecycle；main管contracts/root/授权，H独立consumer，不改I/B实现。
固定 `d95df88bb9dfdeaef74fa49629dcc2aba25d4d1b`：具体module/44测试/direct strict已通过；B新树已删旧maps但用自建channel，I旧树15引用不适用于B。
新独立反例：同lease同command.id再次beforeNativeWrite，会被第一次settled allowed旧回复结算。修fresh correlation再接B，不能以“未缓存许可”声明代替证明。
只管理三个callback与连接/回执/容量，不新server/wireversion/DB/ledger/Driver/approval或执行生命周期；module.close不证明物理quiescence。
正常节奏无当日deadline；whole goal无token预算，24阶段在4/8/12/16/20/24交六个完整runnable source后继续整包。

## I1 原意图与 fresh correlation

保留原business command.id/attempt/nativebinding不变，为每次合法fresh admission调用建立不可与既往settled reply混淆的本地correlation。
现有local v1 native-intent schema允许frame.id不同于command.id，可在不改wireversion/ledger下实现；如需共享interface变化交main最小RFC。
完成/timeout/rebind后的旧allowed不能授权新pending，同ID再次核对也必须达到当前main/Broker guard；未知业务结果先由B原command reconciliation。
验收：合法新allow/deny、相同原command多次fresh核对和重放第一次allowed独立负例；计实际guard/request/reply，不只看发送次数。

## I2 当前 lease 与回复关联

constructor immutable fullproducer、CAS expectedGeneration、唯一active lease和旧receive/close fencing保持；不要重写已过44范围为新接口草图。
新的intent id在同module/lease内不复用，safe counter/关闭/容量边界明确，不能依赖会过期的普通cache后重新接受旧许可。
facts仍原factId、payload仍原immutableRef与请求关联；reply类型、factId、source/fulltuple、原connection/generation在resolve前校验。
验收：producer/CAS/late/timer正反控制与fresh回复连续成立，旧许可在相同和替换连接下都无副作用。

## I3 吸收 B 的实际需求

读B cb4e975实际business-channel/dispatch/poll/callback行为，区分transport待送队列与事实pending owner，将必要行为吸收到I唯一implementation或自有adapter。
保留小interface与dependency注入，不创建新HTTPserver/credential/coordinator；B通过真实send/receive lease适配现有v1frames。
所有pending/timer/generation/bytes规则只由I管理；transport缓冲若必要也有界且不成为另一套reply许可或业务生命周期。
验收：B的实际callback/outbound消费需求有可运行source/类型，不再让B靠复制channel才能使用，也不把复杂度转回每个caller。

## I4 第一结果：可供 B 替换的唯一 module

将I1–I3的fresh intent、完整lease/回复校验、实际B需要的transport行为与原三个方法合为一个可import结果。
交B/main/H实际exports、constructor/bind/receive/close示例与strict编译，说明frame.id是correlation而command.id仍原业务身份。
第一结果必须包括同controller正常三callback与旧allowed-replay拒绝，不只改一个条件或增加测试gate。
发布I4 runnable checkpoint后继续I5–I8；此时无真实Bconsumer就准确保留live/业务恢复未达。

## I5 原 facts 与 durable ACK

同controller跨client重绑，原fact/body可为A durableACK重发，deadline不刷新；旧connection的receipt/ack-failed不结算新lease。
使用真实A public sink/产品ingress的私有consumer或B提供原sink；既有DurableSink Map double仅证明契约，不冒充持久业务落库。
factId/receipt.persisted/seq/correlation/fullproducer精确校验，重复原fact由A幂等，冲突body拒绝，未ACK不宣称已完成。
验收：正常durable回执、原ID重发、late/wrongreceipt和unknown，有完整positive与有限错误，不自动重发业务command。

## I6 原 payload 与 transport bounds

readPayload重绑后仍读原immutableRef，旧reply与错ref/request/producer不得暴露；module只关联/限额，原Store仍定义内容与授权。
与B实际stdio/HTTP有效bounds对齐，合法大数据路径和明确超限分开，不把descriptor当真实业务JSON或静默截断。
保留payload bytes/pending/总量限额和timer回收，失败不能占满容量；request本地id与原ref来源写清。
验收：同值重读、wrong/late reply、合法边界/超限与实际Btransportconsumer，无新payload DB/长期cache/wire类型。

## I7 原 native 意图的当前 guard

beforeNativeWrite只传原意图，当前coordinator每次委派main/Broker fresh guard，I不判断native permission或保存可复用allowed。
detach/rebind拒绝pending native为indeterminate；原已经allowed的旧回复和之后重复帧无法结算新correlation。
原意图重核不等业务重发，原request/target/合同/epoch由B/main核；无法确定native发送时不能变not_sent/可重试。
验收：真实guard调用与allow/deny/unknown、同原command新intent、旧reply重放和源身份错配全在唯一module上运行。

## I8 第二结果：同 controller 真三回调重绑

I5–I7合成同controller A→B的真实sink/payload/freshguardconsumer，保留fact/ref/command/intent/receipt/generation来源。
不是三份互不相干的double，也不因Store.facts空participant有receipt就称完整A business projection；精确报告实际范围。
第二完整结果交可运行consumer与有限正反矩阵，B/H能从同source复现，仍不自授Runner进程/native/产品准入。
发布I8 source后继续I9–I12，B接入未到时推进自有timer/capacity/late/docs不无限等待。

## I9 B 唯一 implementation 切换

给B actualmodule/adaptor/import清单，将原业务channel功能逐项映射到I interface，不能要求B继续维护平行pending实现。
B修改自身runner-service/RunnerLinkClient/routes，I不越界；B旧three maps确已删，迁移对象是现在的business-channel/dispatch重复源。
共享contract/root/wire变化交main最小consumer/RFC，保持auth/currentbusinessguard与lifecycle在原owner。
验收：实际B source import唯一选定I，旧helper职责退役有source与行为证据，不把两个实现“测试都绿”当完成。

## I10 B adapter 的 generation 语义

B显式fullproducer/CAS bind得到lease，next/poll不重绑，reply交原连接lease.receive；I提供清楚的实际interface/错误/remainingdeadline。
旧A.poll/reply/close、foreignexpectedproducer和错误generation必须不能改B当前连接或回应其pending。
任何native fresh correlation保留原业务command，B responder回收到的frame.id，不在adapter错误改成command.id。
验收：实际B/authtransportconsumer证明generation1→2、旧请求拒绝、副作用不增，不能仅I unit正确而B当前route仍可抢占。

## I11 无双轨的真实三 callback

协助B删除平行callback/待回执管道和长期fallback pending owner，实际stdio/attach都使用I同一个module。
三方法在真实Runner中接原A/Store/Broker，begin/prepared/launch/physicalstop仍B唯一管；I不开server或新runtime。
给H可调用source与合法fullproducer/frame数据，H在独立树执行，不改I实现以凑consumer通过。
验收：actualB三callback与正常旧lane同时可用，counts/timer/bounds来自activeimplementation而非未被service使用的dispatchhelper。

## I12 第三结果：实际 B 接入与删除重复源

I9–I11闭合实际B adapter、唯一pending owner和duplicate source退役，记录B/I/main/H精确source与原frame/receipt/guard行为。
同Runner/child consumer由B提供；I只按实际范围报告，不拿旧树maps数否定新B，也不把moduledouble当live证据。
第三完整结果含实际接入source和运行consumer，外部未到如实NOT_REACHED并继续独立故障项，不能提前标整个goal完成。
发布I12 checkpoint后继续I13–I16，复杂度应集中于深module而非新caller重复实现。

## I13 timer 与结算竞争

clock/timer注入保持deadline单调且重绑不刷新，不用墙钟回拨或重新发送重置原等待窗口。
测试timeout/reply、close/reply、send失败/同步reply、rebind/late的竞争，最多结算一次并回收自己的timer/pending/bytes。
过期timer/旧correlation/重复nativeallowed都不复活；unknown不得因超时被静默改成deny/未发送或自动重发。
验收：通过publicinterface及注入timer/caller观察，不暴露private maps或新增probe专用方法，所有等待有限。

## I14 容量与 bytes

per-kind/total pending、payload/request/replybytes、待送buffer和settledcorrelation状态均有限，constructor边界非法先拒。
超限/发送失败不半注册timer/承诺成功；控制/关闭不被数据拥塞拖死，不引入新的调度生命周期。
与B有效transport上限一致，合法大payload与明确unsupported都有准确结果，既有135540回放路线不被误报为callback全payload支持。
验收：饱和/回收、刚好边界/超限、重绑/timeout后容量恢复，actualconsumer看到稳定code且无秘密/无悬挂。

## I15 close、late 与 source

旧lease.close不伤新lease，module.close结算全部pending且拒后续bind/request；close不等停止物理writer。
reply类型/schema/完整producer/factId/requestId/intentid严格匹配，旧connection帧不能被B转给currentlease绕过fencing。
错误仅有限ids/code，不带payload/credential/私有path/stack；success/deny/indeterminate不同，不吞错成许可。
验收：合法close/deny/latepositive与wrong/expired/replay独立负例，全pending/timer结算一次，用户资源不操作。

## I16 第四结果：完整模块故障与 active bounds

I13–I15与B实际adapter组合timer/capacity/close/source/freshreply矩阵，不仅仅在未使用的helper上证明限制。
directmodule与B/main实际consumer strict/exactOptional通过，localv1schema/frozenwire不变，返回错误/unknown语义一致。
第四完整结果包括可重复implementation故障/consumer和完整资源结算，不称quiescence/native/release或靠测试数量升级。
发布I16 source后继续I17–I20的独立H消费与原产品问题/候选支持。

## I17 H 独立源码绑定

交H实际选定I/B/mainsource、exports、adapter和合法原producer/原frame；H不能继续用旧baseline服务冒充当前channel。
H的contractScenarios只列数据不等实际CAS/callback；要求其独立consumer执行同一个implementation并记录真实method/计数。
I收到defect按自身owner修，B改auth/lifecycle，H保独立断言，不为另一consumer新增测试专用平行class。
验收：同source positive/negative独立复现，无第二coordinator/ledger/gate、没有对用户12实例的操作。

## I18 原 A/Broker 与数据权限

原fact durableACK依赖A幂等，不由modulecache或JSON persistedtrue决定；payload由immutableStore、fresh允许由main/Broker决定。
实际回调要保原Work/question/answer/contract/attempt/nativeRequest来源，不能仅同字符串commandID就视为原业务恢复。
I只提供现有三callback和绑定语义，ProductCompletion/执行/候选/接受无需新表；不要扩大module去接应用业务权威。
验收：H/B消费者能用原公开ports观察真实落库/许可，不越界SQL、不新ledger、缺数据时保持unknown。

## I19 跨进程范围与职责

消费B安全同Runner双client/SIGKILL支持输入，但I不独自signal或启动实际vendor；B负责出生/完整identity/fresh每次signal。
原A新进程、原问题native_applied、验证/候选/accept和slot release都是B/main集成结果，I只说明module提供哪一步。
未执行的scope准确NOT_REACHED，不把same-controller double、H旧stdio或typedinterface拼成完整恢复。
验收：source时间/实际consumer/原IDs可追溯，I报告不再列当前B不存在的旧maps，也不自行授native/产品准入。

## I20 第五结果：独立与真实消费者兼容

I17–I19形成H独立selected-sourceconsumer、B真实三callback、原A/Broker权限语义和准确跨进程支持范围。
没有实际B/H输入时source可先发但该结果不伪造PASS，继续自身兼容/docs；consumer待到后立即按实际源验证。
第五结果保留normal/module/rebind/live/recovered/vendor各层，不新server/wire/DB/授权，不把channel close当writer静止。
发布I20 checkpoint后继续I21–I24，独立验证不是新增gate项目或最终交接的代替。

## I21 interface 与实际类型

核main shared小interface/Iexports/Badapter/RunnerLinkClient/Hconsumer一致，原intentcorrelation与businessid区别、错误与close顺序写清。
optional字段遵守strict/exactOptional，旧合法数据路径和新freshreply都能编译/运行；不以root未包含文件的typecheck充数。
需要shared变更交main实际RFC，不直接编辑contracts/root或Bflat源，不发明私有protocol让caller猜。
验收：actualconsumer跨interface使用，不窥private maps、不维护自己的timer/pending去修正I结果。

## I22 可复用操作文档

更新docs/runtime-channel：constructor、CASbind、send/receive lease、三方法、重传数据/不可重发业务、deadline/close/unknown。
明确fact/payload/guard各原权威，禁止“pending exactlyonce”“同frameid重放等freshguard”“moduleclose即quiescent”等过强声明。
例子可运行且source/原ids准确，错误定位靠有限code而非输出秘密，不要求用户删ledger/state或借别的credential。
验收：独立开发者能使用唯一module和Badapter，无另一coordinator或平行implementation。

## I23 有限故障与交付清单

风险相关回归覆盖fresh-id/replayedallow/CAS/stalesource/time/bytes/close和实际Bqueue，原44历史scope保持，变化后测必要组合。
给main/B/H精确runtimefiles/test/docs/consumer/source，不把testfixture/key/nativeprofile塞进产品运行包证明存在。
源变化后installed结论由D/E同artifact独立验；docs/test-only不伪装runtime更新，也不强迫重跑长soak。
验收：代码/文档/消费者scope一致，所有自己的验证session/私有服务收尾，unknown材料留存。

## I24 第六结果与最终交接

写 `reports/runtime-channel/wave28-status.json`，列24阶段/六结果、main/B/I/Hsource、原producer/connection/intent与命令exit/实际回调/未达。
只ownedpaths推origin原 `codex/g5-coordinator-channel`，不upstream/reset，B/I排除路径和旧dirty/12服务/data/profile/tar/ledger不动。
真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED，无reset/topup/refund/补样。
第六结果为唯一模块、actualB/H消费者、完整故障/接口/文档；wholegoal真齐才完，不新Driver/CAC/桌面/autoaccept/第二生命周期。

## 独立备选队列

Badapter未到继续fresh intent/CAS/三callback/bytes/timer/consumer/docs，给准确port/复现；不抢Bauth/lifecycle或长期留下第二实现。
Hconsumer未到模块自身正常/重绑/故障继续，独立结果明确scope，不把contractfixture当H实际执行。
sharedinterface有缺口交main最小consumer/RFC，保持原v1wire和权威；没有真实native输入时不用付费/新协议研究填样。
所有验证有限，仅自己的私有fixture；I不signal旧/未知进程，checkpoint发布后继续完整结果，不设当日强压。
