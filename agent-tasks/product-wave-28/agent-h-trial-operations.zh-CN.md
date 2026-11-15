# H：唯一通道的独立消费者与安全运行支持

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-h`、原分支 `codex/g4-trial-operations`，保留历史后同步最新 `origin/main`，固定实际source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0071](../../docs/rfcs/WP-16/0071-wave-28-architecture-inputs.md)、[0072](../../docs/rfcs/WP-16/0072-wave-28-integrated-delivery-packages.md) 和[固定验收](../../reports/releases/wave28-admission/runtime-channel.json)。
仅拥有 `tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`，不改B/I实现、main/root/contracts、A迁移或E断言。
固定 `0651a50f70e589570aef6a2a91961ee94abbc839`：channel3/3真驱动旧stdio三callback/receipt-row幂等/allow-deny；CAS等是contract数据非I执行。
H消费旧runner-service blob fbd433，不是当前B c299；旧结论保留但不能贴给新B/I。I自有module、B自建同职责channel尚未合一，本包只消费唯一选定实现。
原600/1800/30秒fixture观察和已关preflight/validator范围保留，不因parser/source升级盲目再跑40分钟；不能新造coordinator/ledger/gate。
正常节奏无当日deadline；whole goal无token预算，24阶段在4/8/12/16/20/24交六个完整runnable source后继续，依赖未到转独立队列。

## H1 固定真实 selected source

支持显式B/I/main root/source/必要文件hash，验证实际执行module/adapter与记录身份一致，source变化或错root拒绝而非标最新。
选定I具体implementation，B只auth/adapter/dispatch/lifecycle；H不再仅import自己旧baseline服务就称当前channel已测。
producer来自原trusted registration，actualcallbacks/contractfixtures/模块/进程/产品层分别记录；不凭名字“B服务”授予新source结论。
验收：完整合法source positive与wrongroot/hash/entry/中途变化 negatives，H不修改B/I源码或再复制平行runtime。

## H2 合法 v1 输入与新 intent 关联

复用main local v1 schema与原fullproducer/tuple/source，facts/payload/nativeintent和receipt/payload/write-admission/ack-failed都真实解析。
native fresh frame.id可不同于原business command.id；consumer回原frame.id，不能改成command.id或用固定旧allowed回应下一意图。
旧H回调fact.source与bootstrapproducer不同的fixture需按原registration修正，不能只靠另一份frames.json合法掩盖实际callback错源。
验收：合法完整positive、valid-schema foreign/source/correlation、错误receipt.factId/JSON/协议独立拒绝，副作用计数准确。

## H3 三 callback 的真实消费者

同一selected I+B路径执行fact原A sink/durableACK、immutable payload和main/Broker fresh guard，不把boolean fixture当生产许可验证。
原ProductStore.facts空participant回执只证明receipt-row幂等，真实business projection/原question答复须用既有public ingress/Broker。
记录actual方法、原fact/ref/command/intent/receipt/guard结果，allow/deny/ack-failed/duplicate真正执行，不只列预期scenario数组。
验收：有限正常三回调与失败positive/negative，0模型/native/旧实例副作用，source和层明确。

## H4 第一结果：唯一实现的实际回调

H1–H3组成可运行selected-sourceconsumer，原contract数据可继续辅助，但实际CAS/timer/bounds与回调要调用I/B真实实现。
若B尚未接I，只承认I module/旧bridge的各自范围，给真实差异和consumer给B/I，不以缺实现模拟PASS。
第一结果是有正确来源/输入/方法/原结果的独立三callbackconsumer，不是新的gate、另一个channel或静态报告。
发布H4 source/fixture/观察后继续H5–H8，B源码未到时自己安全工具与已有独立项不停。

## H5 独立出生清单

为本次own进程记录PID/start/UID/fullargv/root/config/operation与独立birth来源，启动前/出生后/health记录前窗口都覆盖。
sharedinstall、parent ancestry、同UID、路径子串或自己声称operation都不是完整ownership；unknown保留不缩为空集合。
源root/输出root与用户12实例明确分开，凭据只显式own路径，不global process/socket扫描或读取home/他人credential。
验收：完整ownpositive与foreign/sibling/recycled/missingfield/pre-record/mixedunknown纯控制，未通过不跑live signal。

## H6 每次 signal fresh 核对

TERM/KILL/升级前分别fresh重读全identity，出生记录和当前观察一致才可操作；不复用TERM前proof去KILL已变化PID。
观察失败/不一致返回REFUSED或unknown，保留material/日志/状态，不因清理压力盲杀或删除还可能活跃的根。
H可早交可复用测试helper/fixtures给B，B自己改原unsafe脚本；H不取得产品stop/upgrade/恢复authority。
验收：own/foreign/回收/字段改变、TERM后变化和unknown控制有完整positive，错误对象zero signals。

## H7 安全关闭与归还

私有测试需要停止时优先原已授权product stop/独立ownhandle；cleanup遵守和正常操作相同完整身份条件，不finally按PID盲kill。
若child/server仍活或未知，保留根并清楚报告；不得先rm state后再尝试确认资源，也不以PID消失证明全writer已停。
计数实际signal/connection/FD/timer/queue与最终归还，区分module.close、lease.detach和物理quiescence。
验收：有限own资源正常退出/拒绝/未知路径准确，只有fresh证明的probe-born对象受signal，用户资源不变。

## H8 第二结果：live 前安全工具

H5–H7形成独立birth/fresh/cleanup工具与可复用consumer，B现有unsafe SIGKILL脚本在采用前仍不运行。
保留已过preflight拒绝前不执行、NOFOLLOW/private token、engine上下界与raw时间校验，不为新signal helper倒退旧修复。
第二完整结果包括纯错误资源控制、正常own正对照和实际安全关闭观察，不是又写一个批准gate或静态allowlist。
发布H8 source给B/main/E，继续H9–H12；无需盲目重跑旧600/1800长soak来证明parser/helper修复。

## H9 原 A/Broker 真实数据支持

为B提供既有public Store/ingress/Broker/Driver产生的原Work/question/answer/nativebinding/payload/receipt合法输入，禁止手写SQL造成功。
fixture layer明确controlled，真实vendor/native/生产operator未测不补样；源producer/fulltuple与服务原登记一致。
保留原normal/legacy callback数据，但它们不等跨coordinator恢复，不能拼多份不相关fixture成单链。
验收：输入来源/原IDs/hash可追溯，A/B/main实际方法能消费，缺字段准确unknown而非要求新表/ledger。

## H10 同 Runner 双 client 观察

消费B selected I实际adapter，同Runner/child A断开、B接管，记录两client/原身份/三callback与完整资源出生证据。
facts同ID为durableACK重发，immutable payload可重读，native未决意图indeterminate且fresh重核；不重发begin/answer业务命令。
H只观察/生成合法输入和调用已有原端口，不另建receipt-onlycoordinator、socketserver、Driver或调度生命周期。
验收：正常交接和wrongsource/oldlease/generation/same-id旧allowed重放反例，在实际唯一实现上运行。

## H11 CAS、poll 与 fresh 回复

独立执行A1→B2、旧A.poll/reply/close、foreignexpectedsource、失败CAS与native freshcorrelation，不仅在report里列contractScenarios。
poll必须read-only，旧A不抢回gen3，foreignpoll不改binding；不要把持有同credential当预期producer正确。
重放旧settled allowed无法resolve新同businesscommand意图，合法新guard allow/deny正常；记录实际发送/guard/接收计数。
验收：完整positive与具体negative，缺Broute/I修复按owner给复现，不修改实现或放宽H/E期待。

## H12 第三结果：真实重绑消费者

H9–H11同一原数据/selectedsource形成独立rebindconsumer，原sink/payload/guard、CAS/late/bytes/close的行为可复现。
没有actualB/I接入时诚实NOT_REACHED，保留各已测scope并继续安全/文档；不是再创建平行测试runtime凑通过。
第三结果交实际可运行输入/consumer/原IDs/结果，不授native/release，不从moduleclose推断物理writer静止。
发布H12 checkpoint给main/B/I后继续H13–H16，独立source发布不是等待新派工点。

## H13 安全 SIGKILL 支持

H安全helper及purecontrols通过后，协助B现有原coordinator测试记录出生和每signal的fresh全identity，不自行制造另一coordinator。
同原A登记/Store/原Work/问题保持，JSON注册可承载引用但合成persistedtrue/seqDate.now不证明A持久业务事实。
失败/unknown保留根，source/owner/observer对资源结论明确，所有等待和进程操作有限，unsafe旧脚本仍禁止直接复跑。
验收：正常private chain与wrong/recycled/pre-record refusal，exact own才signal，不影响12用户实例。

## H14 原问题答复与接收端

收集原question/version/target/nativeRequest/answer/command/ref与真实receiver/A delivery，native_applied或indeterminate必须有原结果。
normal ACK计数和另一SIGKILL transport实验分开，不能“两个都过”就合成同一原问题恢复；合成payload不是原Store值。
main/Broker逐次fresh许可、原receipt幂等与原contract/epoch保持，Hbooleanallow fixture不升级真实permission proof。
验收：selected actualB消费者正常/拒绝/未知，原IDs贯穿退出/重接/答复；H不写业务结果或第二ledger。

## H15 有界 ACK/unknown 故障

begin/answer写前、receiver后ACK前、ACK后receipt前和receipt持久后等窗口用实际接收/原A观测，有限deadline。
已收/完成不重发、unknown不换ID，不用任意fact_receipts总数变化代替原answer确定结果，也不删除unknown标记。
H提供合法输入和独立observation，错误source/correlation/late/timeout有完整positive，不接管B/I实现。
验收：重放/冲突/未知原事实完整，0 vendor/native，真实nativecompat/value仍未测。

## H16 第四结果：原身份故障支持

H13–H15形成真实B原链的安全出生/信号/原问题/ACKunknown独立支持，不能只汇总几个frame JSON或记录scenario。
actualB尚未完成同A原ID时如实标步骤未达，normal候选/旧fixture正对照保留，H自有安全source/consumer继续。
第四结果给main/B准确source、原IDs、命令exit/接收/guard/资源结论，unknown材料与失败证据留存。
发布H16 source后继续H17–H20，不用长soak代替未实现业务链。

## H17 正确候选/接受消费者

帮助B复用ProductCompletion.current/verify/accept、execution.core completionCandidate→application.verify、WorkView.actions.currentCandidate和原accept_candidate。
同checkout原product-execution首测试已证明normal currentCandidate/registeredcheck/manualaccept/delivered；无candidates表不需要A新迁移。
消费真实完整CandidateRef/artifact/check/currentversion，不构造candidateId/workId假shape，也不直接写accepted字段。
验收：normal正对照和恢复后实际原Work候选/接受分层，错subject/旧candidate拒绝，不新verifier/gate/ledger。

## H18 slot cap 与 release 观察

WorkView身份在view.work.id，不能用view.id找不到就声称ended投影不存在；inspect支持workId，原publicbinding/event可补足资源事实。
2/4slot以attempt/queue/Later/原背压观察，五Work记录不等五attempt；释放看完整resources/endedbinding/runtime.exited与后续queued推进。
记录每slot原ID/credential/cursor/payload/receipt隔离，known/unknown分开，单attemptquiescence不贴aggregate归还。
验收：正常/交接/恢复多槽有完整positive和明确notreached，无清marker/空集合强制释放或其他credential扫描。

## H19 精确包与只读试用输入

preflight/诊断使用显式tar/install/root/token与准确source/build/hash/schema/ABI/mode；REFUSED前不运行packagecode或source模块。
新I/B或Appruntime字节未在包里就不称installed支持，checkout/module观测与E final同artifact verdict分别记量。
保持现有private/no-followtoken、engine成熟校验和raw持续时间约束，能力未知不补绿，不对用户实例install/stop/upgrade/migrate。
验收：明确输入和有限拒绝/读取source，H报告脱敏且不替代E独立required，不新增授权层。

## H20 第五结果：完整原产品与试用支持

H17–H19给出正确candidate/accept/slot消费者、真实资源和精确artifact/preflight输入，actualB进度按准确source标scope。
第五结果是可用支持工具/消费者与独立原事实，不是新gate；B/I尚未交业务能力不能靠H仿真补成完成。
旧普通App/install/observations和新recovery独立，零模型/native，不为“证明收益”启动任务/新预算或研究厂商配方。
发布H20 checkpoint后继续H21–H24，源码/数据完整交接才结束wholegoal。

## H21 raw evidence 与隐私

raw记录source/observer/数据layer/采样窗口/真实时间/计数/错误/unknown/资源，脱敏token/header/path/payload/stack，不删失败使结果更好看。
限定输出0600/新路径/不覆盖，raw/derivedreport/最终验收层分别保留，reader拒绝改字段/缺identity/时间不一致。
辅助reader只验证已有明确事实，不把selfdeclared PASS或sourcehash当native/permission/releaseauthority。
验收：正常raw和缺失/篡改/错误时间/source负例，H/E接口可独立消费且不需额外authority。

## H22 有限运行与新风险观察

只对本包新source/场景做必要短观察，既有600/1800/30秒scope保留；不自动重复40分钟或无限等外部target。
若确需live运行，先通过born/fresh/cleanup控制并限定总deadline/采样/bytes/FD/连接，使用明确ownprivate目标。
预期SSE断线、transport错误、unknown真实保留，短run不称48h soak、产品稳定发布或nativecompat。
验收：实际起止/样本/资源前后匹配，无旧用户服务操作、无泄露/盲杀/删unknown根。

## H23 操作指南与跨 owner 交接

文档说明selectedI/Bsource、真实3callback、正确candidate/WorkView/slot路径、safe signals和准确scope，移除旧baseline冒充新模块的表述。
给B/I/main/E合法fixtures、sourcehash/实际consumer/原IDs与缺陷归属，H不改其实现/断言，不索要新A候选表或gate。
先交可复用安全与consumer源码再补报告，checkpoint后继续独立项；rootdeps/sharedcontracts或产品入口需求交main。
验收：独立使用者按明确输入复现受控路径/拒绝，不需要借凭据、清ledger或修改已测期待。

## H24 第六结果与最终交接

写 `reports/trial-operations/wave28-status.json`，列24阶段/六结果、selectedB/I/main/A/H源、原IDs/raw/命令exit/资源/未达，source交后继续wholegoal。
只ownedpaths推origin原 `codex/g4-trial-operations`，不upstream/reset，不改B/I/main/A/E，全部旧data/profile/tar/ledger/dirty和12用户实例保留。
真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5单在途pilot BLOCKED，无reset/topup/refund/补样。
第六结果是完整工具/消费者/安全运维/文档，不新coordinator/ledger/gate/Driver/CAC/桌面/autoaccept/第二生命周期；正常节奏不压门槛。

## 独立备选队列

selectedI/B未到先做source绑定、合法producer/frame/原A输入、safeidentity纯控制、正确candidate/slotconsumer；不复制另一runtime来凑通过。
没有独立证明ownlive目标只做module/进程内/静态材料，保留NOT_REACHED；unsafeSIGKILL前先修工具，不signal旧/unknown对象。
artifact未到继续source/privateconsumer/rawreader/docs，既有长观察不重跑刷数量，E required仍由E独立执行。
缺真实native/operator数据如实未测，不home/global扫描、不借他人credential、不改账本和预算，所有等待/验证有限。
