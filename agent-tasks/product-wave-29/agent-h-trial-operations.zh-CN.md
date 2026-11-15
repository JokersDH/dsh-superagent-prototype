# H：当前唯一通道消费者、可信出生证明与运行支持

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-h`、原分支 `codex/g4-trial-operations`，保留历史后同步最新 `origin/main`，固定实际source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0073](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)、[0074](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)、[0075](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md) 和[验收](../../reports/releases/wave29-admission/runtime-channel.json)。
仅拥有 `tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`，不改B/I实现、main/root/contracts、A SQL或E断言。
固定 `2d1e4941685dfa94f8ff991d7c5dd8c9fdf706db`：历史oldI/B快照消费者真实，但不代表latest；当前默认main-root=H自身与旧headpin089不符，实际source前置拒绝。
B2KB/CAS和I latestnonce/namespace/prune已真关，B仍vendored旧I；normalCandidate5/5保留，sink-only guard0自批及directstrict仍新阻断。
signalpuremock4PASS6FAIL：freshstart变化拒KILL已过，但missingargv/birth、prefixroot/op、psunknown误gone未过；不得先跑现有liveSIGKILL/procguard。
正常节奏无当天deadline/删门槛；wholegoal无token预算，24阶段在4/8/12/16/20/24交六个完整runnable source后继续，不新coordinator/ledger/gate。

## H1 可复现 current selected source

保留旧d95/cb4材料与defect-detectionscope，新增明确currentB/I/main source/commit/blob/dependencyclosure输入，不把历史PASS贴当前修复。
解决默认main-root指自身finalHEAD却硬pin旧089的不可复现组合，拒绝正确但工具应能以显式合法输入实际运行。
依具体运行源/合同bytes验证前后不变，docs-only无关HEAD变化不需伪造runtimeartifact；不得为了绿灯取消source检查。
验收：current合法positive、错root/hash/entry/依赖/中途变化均有限拒绝，source未通过前不执行候选代码。

## H2 最新 I/B 的合法输入

materialize或import最新选定module与RunnerAttachChannel完整transitivefiles，不只旧三文件；明确B旧vendoredblob和latest不同。
复用fullproducer/原tuple/source/v1schema，nativeframe.id是freshcorrelation，原businesscommand.id保持，consumer回复原frame.id。
同rawfact/payloadid、expiredqueue、oldallowedreplay在actualselectedI执行；contractScenario数组或旧bug重放仅是辅助/历史。
验收：正常三callback与validschema错source/correlation/receipt/PIDactor边界准确，无源修改或平行实现。

## H3 真实回调和权限反例

独立运行actualI/Bconsumer接原A durablefactsink、immutablepayload与main/Brokerfreshguard，不把genericreceiptrow或booleanallow升级生产权威。
复验B sink-only missingguard/deny/throw/stale都zero write，external正常fresh/deny有正对照；发request次数不等实际guard执行。
B错源码/旧模块/strictfailure按owner给exact复现，不改I/B或H/E期待，producer/原Work/question来源保持。
验收：actualmethods/结果/副作用计数可追溯，缺guard不会自批，原known/unknown/native未测分层。

## H4 第一结果：current 唯一消费者

H1–H3形成可运行current-source三callback/nonce/queue/CAS/guardconsumer，B新I尚未采用时分别标latestI通过和actualB失败。
保留B唯一class已选中/自建channel已删的进展，不再要求重做旧maps或五块修复，给实际当前差异。
第一完整结果是真实source/协议/原数据/回调/拒绝，不是新的gate或另一套coordinatorruntime。
发布H4 source/consumer/fixtures后继续H5–H8，缺B修复则转独立安全工具而非无限轮询。

## H5 独立出生与不可伪造来源

信号只接受本run独立spawn注册的handle/不可变birth facts，不接任意PID的freshps复制值或缺birth的普通JSONrecord作为ownership。
完整PID/start/UID/fullargv/root/config/operation和必要parent/资源scope在出生时绑定，缺字段/矛盾/unknown先拒。
给B可复用helper/fixtures，B改自己的工具；H不取得产品stop/daemon/升级authority，也不以同UID/ancestry/sharedinstall判断own。
验收：puremock完整ownpositive与missingbirth/argv/pre-record/recycled/foreign/sibling/mixedunknown，错误对象zero signals。

## H6 exact argv/root/config/op

root/config/op必须等于独立原spawnargs中的精确值，不是command.includes前缀；短root/operation不能命中-sibling实例。
保原structuredargv和freshraw观察的完整对应，不把空格归一/猜分词当等价参数，不能record.command正确就忽略独立root字段矛盾。
整个操作resource集合与目标scope首signal前核清，单probehelperpositive不升级为所有Runner/daemonwriter已证明。
验收：同prefix不同state/config/op、包含空格参数、缺/变字段的独立negative与正常positive，拒绝发生在任何TERM前。

## H7 UNKNOWN 不变 gone

ps权限/执行/解析失败保持UNKNOWN，waitGone不能返回gone；正常exit须原ownedchild退出事件或明确不存在的独立证据。
每TERM/KILL/escalationfresh全identity，保留已过start变化拒KILLpositive；不重用TERM前proof，也不因超时盲杀。
unknown/仍活资源留根/状态/日志，禁止先rmstate或finallybest-effortkill后删除，观察故障不宣称安全归还。
验收：pure观察失败/正常退出/回收PID/TERM后变化均准确，0真实signals即可先完成防护控制。

## H8 第二结果：安全工具可供 live

H5–H7合成独立birth/exactargument/whole-resource/fresh-signal/UNKNOWN/cleanup完整工具，不只补一个字符串检查。
全部purepositive/negative过后才有限ownprobe/live，H和B旧unsafe脚本未采用新helper前仍不执行。
第二结果保既有preflight拒绝前不执行、NOFOLLOWprivatecredential/engine/rawtime修复，不为新helper倒退旧安全范围。
发布H8可复用source给B/main，继续H9–H12；无需自动重跑旧40分钟soak证明parser修复。

## H9 原 A/Broker 数据输入

提供既有public Product/Store/ingress/Broker/Driver产生的原Work/question/answer/nativebinding/payload/receipt，不能SQL造最终成功。
fixturecontrolled明确，原source/contract/attempt/fullproducer与实际登记一致，不用frames.json一份合法掩盖callback实际错源。
genericStore.facts空participant只证明receiptrow，原businessprojection/targetguard须actualpublicconsumer接入。
验收：合法/duplicate/conflict/错subject数据能被actualB/I消费，缺字段unknown，不问A新增candidates表/ledger。

## H10 同 Runner 两客户端

安全工具过后消费B latestI实际adapter，同Runner/child A断开B接管，记录client/进程完整出生/原session/命令/回执来源。
facts同ID等durableACK、payload同ref重读；nativepending indeterminate且fresh重核，不能重发业务begin/answer或迁移许可。
H只合法输入/独立观察，原协调器/运行时/授权仍B/main，不另建receipt-onlycoordinator或第二生命周期。
验收：actual同源三callback/late/correlation与资源正反链，缺B能力如实NOT_REACHED不仿真补PASS。

## H11 独立 CAS 与 fresh 回复

旧A.poll/reply/close、foreignsource、wronggeneration与当前B正常poll在actualroute执行，不重派已过B2KB/CAS修复。
重点actualB合latestI后旧settledallowed不能决定下一同businesscommand意图，freshdeny/throw不写，actualguard次数真实。
payload/ref/bytes/queue过期与kindnamespace不串用，actualsource/latest模块/旧pin层分开，失败按owner反馈不改实现。
验收：currentselectedI+B的真实positive/negative，未经执行的scenario列表不作为运行证据。

## H12 第三结果：原数据真实重绑

H9–H11组成同一原source/sink/payload/guard的独立rebindconsumer，合法原IDs/副作用/queue和有限错误可复现。
source未到时准确列I latest与Bvendored差异，继续safe工具/文档，不拿oldbaseline借名为current。
第三完整结果是实际原authority支持的双client/回调路径，不授native/费用/release，channelclose不等物理停。
发布H12 checkpoint后继续H13–H16，所有阶段source交后持续wholegoal。

## H13 安全原链 SIGKILL 支持

birth/exactscope/fresh/UNKNOWN全控制通过后，协助B原coordinator测试，H不另建coordinator/新server或按PID随意kill。
每signal前完整fresh资源证明，原A/Work/question/attempt保持，JSON可承载引用但伪persistedtrue/seqDate.now不是A结果。
确认旧退出与Runner/child不变，unknown材料保留；0vendor/native，不能用其他实例/个人CLI填样。
验收：正常privatepositive与foreign/recycled/pre-record refusal，精确本run目标才signal，不触及12旧服务。

## H14 原答案与接收观察

收集原question/version/target/nativeRequest/answer/command/ref和actualreceiver/ADelivery，native_applied或indeterminate必须原结果支持。
normal答案和另一JSON注册SIGKILLlane不能拼一条recovery，合成payload不替原Store，原freshBroker guard逐次运行。
记录actualsource/actor/contract/epoch，late/重放/冲突不重复nativeeffect；Hbooleanfixture只属模块输入测试。
验收：sameA原链正常/拒绝/未知有准确method/IDs/计数，H不写accepted/结果字段或新SQL。

## H15 有限 ACK 与未知窗口

begin/answer写前、receiver后ACK前、ACK后receipt前、receipt持久后窗口用原A/receiver而非任意总行数增量判状态。
已收/完成不重发，unknown不换ID/退款/清marker；data重读与nativecommand写入是不同副作用。
独立生成合法窗口和错误source/correlation/timeout/late输入，B/I实现由原owner修，所有waits/deadlines有限。
验收：实际恢复/ACK/guard事实完整，控制假设与未达层清楚，不扩大vendor/nativecompat声明。

## H16 第四结果：故障原身份支持

H13–H15合成B同原A/问题/答案的安全signal、实际接收与unknownsupport，不能只汇总几个JSON或framecounts。
actualB未完成对应恢复链时NOT_REACHED，normalProductCompletionpositive保留，自有safe工具/consumer继续。
第四结果交原IDs/source/raw/命令exit/副作用/完整资源，失败/未知不删证据，不跑长soak代替未实现业务。
发布H16 source给main/B/I后继续H17–H20的候选/slot与实际内部试用输入。

## H17 原 Completion 与正常/恢复区分

复用ProductCompletion.current/verify/accept、executionverify/corecandidate与WorkView.actions.currentCandidate/currentVerificationId，no candidates新表。
Bnormal5/5原candidate/accept/artifact路径已过，作为positive而非recovered；完整CandidateRef，不造candidateId/workId私有shape。
wronggeneration/旧candidate/机器失败拒绝，恢复后接受仍需原sameWork/contract/attempt/authority，H不直接改状态。
验收：actualnormal与recoveredconsumer分别记录，原artifact/verifier/source可追溯，无新增gate/ledger/迁移。

## H18 2/4 槽与释放

WorkView身份为view.work.id，原inspect支持workId；用binding/runtime.exited/completeResource和queuedwork推进看release，不只phase。
五Work记录不等五attempt，2/4容量和隔离要稳定actualqueue/attempt/resource观察，normal/待答/重绑/unknown/stop/delivered分层。
一次复用与一次超时照实保留，partial/unknown不清marker强释放，也不拿单attemptquiescence当全aggregate。
验收：同slot前后原IDs/credential/cursor/payload/receipt与完整资源集合，缺数据NOT_REACHED不自造actor结果。

## H19 精确 package 与只读 preflight

使用显式tar/install/source/build/hash/schema/ABI/mode/ownroot/token，拒绝/UNKNOWN前不执行候选代码或自动install/stop/upgrade/migrate。
新runtime未在包中就不称installed，source/privateconsumer与E同artifactrequired各自范围，旧installedscope不因docs变化失效。
保NOFOLLOWprivatecredential/engine上下界/raw时间一致性修复，缺能力unknown，不home/global发现或借其他credential。
验收：限定输入、有限只读/refusal诊断、sourceidentity和脱敏输出，H不成为权限或releaseauthority。

## H20 第五结果：完整产品试用支持

H17–H19交正确候选/接受/slot消费者和精确试用/运维材料，actualB缺恢复能力时不能由H仿真补成完成。
普通App/recipes/insights/install与B/private/target/blockedstudy独立，观察不授native/费用/接受权限。
第五完整结果含实际可用consumer/diagnostics、source和资源范围，不是又一套gate或额外文档项目。
发布H20 checkpoint后继续H21–H24，raw/reader/文档及完整source交接继续推进。

## H21 raw evidence 与读回

raw保source/observer/layer/原IDs/真实起止/采样/错误/unknown和资源，derivedreport与最终验收分层，不能删失败刷绿。
输出新路径0600/不覆盖，大小/记录有界，token/header/原文/privatepath/stack脱敏；reader拒缺身份/改字段/时间矛盾。
selfdeclaredPASS/sourcehash不成为native/permit/release证明，oldpin故障复现与current修复positive不能互贴。
验收：真实有限rawpositive和篡改/缺字段/错source/时间negative，E可独立使用而不依赖H verdict。

## H22 新风险有限运行

只对新source/场景做必要短观察，已有600/1800/30/20秒材料保留，不自动重复40分钟或无限等target。
live目标需全born/resources/fresh纯控制先通过，明确总duration/采样/bytes/FD/连接与cleanup约束，unknown留根。
预期SSEdisconnect/transporterror真实记录，短run不是48hsoak/nativecompat/稳定发布或收益证明。
验收：actual起止/样本/资源前后对应，零旧实例动作/秘密泄漏/盲杀或unknown数据删除。

## H23 使用与跨 owner 交接

更新currentselectedsource参数/依赖closure、actual三callback/freshguard、safehelper/UNKNOWN和正确candidate/slot路径文档。
给B/I/main/E合法fixtures、确切hash/consumer/原IDs/错误归属，H不代修其实现或放宽独立期待，不提新A表/ledger/gate。
早交可复用source后继续独立项，root共享/产品route需求交main，docsonly与runtime变更区分。
验收：独立使用者按明确输入能复现受控流程/拒绝，无需借凭据、清DB/ledger/queue或制造新预算。

## H24 第六结果与最终交接

写 `reports/trial-operations/wave29-status.json`，列24阶段/六结果、currentB/I/main/A/Hsource、原IDs/raw/命令exit/资源/未达，checkpoint后继续wholegoal。
只ownedpaths推origin原 `codex/g4-trial-operations`，不upstream/reset/改B/I/main/A/E，旧data/profile/tar/ledger/dirty和12实例全部保持。
真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED，无reset/topup/refund/补样。
第六结果为完整sourceconsumer/安全观测/运维工具/文档，不新coordinator/ledger/gate/Driver/CAC/桌面/autoaccept/第二生命周期，正常节奏不压门槛。

## 独立备选队列

currentB/I修复未到先做可复现sourceinputs/合法frames/原Aconsumer/safe纯控制；source到后实际执行，不用旧bug快照报新repairPASS。
没有完整ownliveproof只做pure/module/进程内/静态材料，unknown/NOT_REACHED保留；先修guard，不复跑现有SIGKILL/长soak。
artifact未到继续source/privateconsumer/rawreader/docs，Erequired仍独立；normal5/5和fixture层保留不贴recovered或native。
缺operator/native样本如实未测，不home/global扫描/借凭据/新study，不动账本预算和旧状态；所有等待/测试有限。
