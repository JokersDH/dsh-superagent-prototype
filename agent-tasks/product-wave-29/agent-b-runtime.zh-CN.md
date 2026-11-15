# B：最新 I 接入、真实 guard 与原业务完整恢复

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`，保留全部改动后同步最新 `origin/main`，记录实际source。
先读START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0073](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)、[0074](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)、[0075](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md) 和[验收](../../reports/releases/wave29-admission/runtime-channel.json)。
B保原execution/catalog/policy-preparation/driver/testing/Runner/native-acceptance，明确排除I独占的 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`。
B唯一管runner-service/RunnerLinkClient、HTTPauth/routes/dispatch/begin/prepared/physical lifecycle；I只module/adapter，H只独立consumer，不新authority。
固定 `c2ea8dbcbc3cdc75ef692b3bcdba585704240dc9`：actual2KB161条/五块135540digest、CAS/旧foreignpoll拒绝、原候选接受5/5已过，不重派旧预算/两份channel/候选表错误。
B已用I但blob仍bf5b25a，尚非I latest4d85/d1ef81/RunnerAttachChannel；sink-only会guard0自批，directstrict新codeunion失败，live signal工具仍未准入。
正常节奏，无当天deadline/删门槛；wholegoal无token预算，24阶段在4/8/12/16/20/24交六个完整runnable source后继续整包。
保留两旧reportdiff、b16未跟踪文件、全部用户data/profile/tar/ledger/dirty；普通App/recipes/insights/install独立，不借readiness或声明模板授执行权。

## B1 合 exact latest I 与真实 pull adapter

合入I准确最新source，采用RunnerAttachChannel的fresh intent、kindnamespace、settlement/timeout prune和remainingdeadline，不手改I subtree复制修复。
删除本地connections/currentConnection/pollqueue中重复的关联/清理规则，B只适配认证transport、原connectionlease和lifecycle。
保留旧自建business-channel/dispatch已删除、I已被消费的进展；区别“引用I路径”和“实际包含最新blob/adapter”。
验收：directactualconsumer编译及同command新intent/旧allowed拒绝、同rawid跨kind与timeoutqueue清理，B实际运行源而非I独立测试代替。

## B2 sink 模式显式 fresh guard

去掉options.sink native-intent的allowed:!businessClosed；FactSink只记录事实，不能成为main/Broker许可或批准authority。
为in-process responder显式注入原payload/fact/fresh beforeNativeWrite，missing/deny/throw/stale都不native写，成功也每次按原command/target/version重核。
保留externalstdio deny正对照，actualsink-only guard0不得再allowed；错误准确unavailable/deny/indeterminate，不缓存旧allowed补洞。
验收：missing/deny/throw副作用前zero write，合法freshcallback正常，原businesscommandid不变且framecorrelation独立。

## B3 direct 类型与拒绝语义

修recovery-transport:388新stale_connection/foreign/refused等code不在RunnerLinkError union的actualstrict失败，明确baseerror与serverError语义。
保持当前CAS/producers/旧poll拒绝和结构化reason，不用uncheckedcast或全回unknown_outcome掩盖差异。
root tsconfig未覆盖新路径的绿灯不当编译证据，实际module/main/Hconsumer strict/exactOptional都核对。
验收：合法/拒绝/未知错误有一致类型与运行行为，不影响已过page/五块/原normalcontrolscope。

## B4 第一结果：最新唯一通道与原权限

B1–B3合为actualRunner stdio/sink/attach的唯一最新Iimplementation，三callback正确delegate原A/Store/Broker，不以配置已具备开权限。
交准确B/I/main/A source、actualadapter、缺guard拒绝、freshreply/queue与directcompile正负证据；不只合一个commit或改一个if。
第一完整结果同时保留2KB/descriptor/五块连续性与CAS拒绝，不再以单独I65case称B已接完。
发布B4 runnable source给main/I/H后继续B5–B8，未齐保持wholegoal，不把partial权限接线称完整恢复。

## B5 先修独立出生与 exact ownership

signal工具只接受独立注册的本probe-born handle/不可变birth facts，必须有PID/start/UID/fullargv/root/config/operation，不能capture任意PID当ownership。
root/config/op逐原spawn参数exact匹配，不是substring/siblingprefix；缺argv、缺birth或矛盾record先拒，完整资源集在首signal前核清。
先puremock ownpositive与missing/foreign/sibling/recycled/pre-record/mixedunknown控制，保留fresh-after-TERM已过范围。
验收：错误对象zero signals，unknown材料留存；未通过不跑B现有SIGKILL/liveprocguard脚本。

## B6 UNKNOWN 不冒充 exit

区分正面ownedchild exit/明确不存在与ps权限/命令/解析失败，confirmExit不能把观察失败改exitedtrue。
每TERM/KILL/escalation前fresh全identity；证明不足不signal/删根，不能finally按旧PID数组盲清理。
借H可复用safehelper/fixture但B改自身工具，产品stop/全writerquiescence仍走原registered资源barrier。
验收：pure观察失败留UNKNOWN，正常退出有独立证据，freshstart变化仍拒KILL，不因工具升级重跑长soak。

## B7 三 callback 与同 Runner 双 client

私有真实product Driver/协议fake产生原Work/question，A真断开、B接同Runner/child和原A sink/immutablepayload/mainfreshguard。
fact同ID等durableACK、payload同ref重读；nativepending indeterminate且原意图fresh重核，不重发begin/answer或迁移旧许可。
安全工具通过后才做live，保原processbirth/session/request/contract/epoch和两clientsource；不以两个demo或合成persistedtrue代替A。
验收：actual同源三callback/交接/late/guard计数与完整资源，controlled/normal/vendor/installed分层。

## B8 第二结果：安全真实交接

B5–B7构成sameRunner/samechild、原authority和safeprocess操作的完整路径，缺guard/foreign/旧lease不产生副作用。
module.close、lease.detach和physicalquiescence分别测量，H可以消费同source，不把I模块double贴成B live通过。
第二完整结果包含safebirth/UNKNOWN、actualA/Broker和两client正反链，普通App/安装不等待blockedstudy或私有target。
发布B8 source后继续B9–B12，typedinterface/握手成功不是原协调器崩溃恢复的终点。

## B9 新进程读原 A

新coordinator从原A登记/currentbinding/commands/dispatch/observations/question/answer/payload恢复，不仅读手写registration.json。
原host/profile/policy/fullproducer/资源与当前contract/epoch重核，只有main原授权有效，不从source receipt/旧配置/目录材料派生grant。
B交actualattachedRunningAttempt/consumer给main原ProductExecution组合，root缺口交最小RFC，不复制第三coordinator/ledger。
验收：真正新Node进程用原A原IDs接原endpoint/Runner/child，unknown不清空、错误来源拒绝。

## B10 安全原身份 SIGKILL

safehelper全部purecontrol过后在同原业务链注入退出/SIGKILL，每次fresh核本probe-born完整identity和操作资源scope。
确认旧coordinator退出、原Runner/child身份不变；unknown留root/证据，不按ps失败当gone或删还活state。
继任连接仍原A/Broker，JSON仅可携原引用，不能Date.now伪receipt或requestId假payload来做PASS。
验收：正常positive、有限deadline、原PID/start/IDs/资源和真正继任行为，不把两个OS PID读同文件叫原产品恢复。

## B11 原问题和 ACK/unknown 窗

恢复原question/version/target/nativebinding/request/answer/command，main/Broker在实际native-write时fresh核对，允许达native_applied否则准确unknown。
begin/answer写前、receiver后ACK前、ACK后receipt前、receipt持久后的有限窗用原A/接收端判断，不用总receipt增长替代原答案结果。
已收/完成不重发、unknown不换ID，facts/payload数据恢复不授权业务自动重试，旧allowed/lateACK不能决定新意图。
验收：同原IDs正确/拒绝/未知、重放/冲突与actualeffect计数闭合，zero vendor/native不变。

## B12 第三结果：同 A 原问题恢复

B9–B11必须同一Work/question/attempt链完成原coordinator退出、新进程、真实原回答/回执和finitewindow，不拼normal/transport两lane。
main/I/B/A/Hsource、原IDs/guard/receiver/native状态与最终资源清楚；缺产品consumer准确NOT_REACHED并继续独立项。
第三结果不新grant/ledger/候选writer，原字段不足交owner实际复现，不能为了绿灯放宽当前授权。
发布B12 runnable source后继续B13–B16，恢复后检查/候选/人工交付仍需同链证明。

## B13 保留 original Completion 进展

原ProductCompletion.current/verify/accept、execution.completionCandidate→application.verify和完整CandidateRef已实际5/5，不再问A要candidates表。
将normal5项作为合法positive，读取WorkView.actions.currentCandidate/currentVerificationId，不造candidateId/workId私有shape或直接写accepted。
正常接受/4个artifact可读不是recovered成功，保持source/provenance和原generation/contract绑定。
验收：真实既有接口可复用到恢复consumer，机器/候选/接受的原权威不变，无迁移或第二ledger。

## B14 同链恢复产物与注册检查

在原恢复Work/Ticket/Assignment上产生真实artifact/manifest，沿原fixture-driver/execution/core与Workspace冻结检查，不借其他normalrun结果。
registeredcheck/currentenvironment/policy/contract完整匹配，原resourcebarrier未静止不得verify，nativeendturn不是验收。
机器失败保留原证据，修正后生成新当前candidate，错subject/旧artifact/checkversion拒绝。
验收：恢复→产物→注册verification→currentcandidate来自同原IDs/source，B只补adapter而不新verifier/authority。

## B15 明确接受与旧 epoch

用原application accept_candidate命令接受完整当前CandidateRef，保留acceptance/verification/artifact/source，不能脚本回填最终字段。
current epoch至少2、old至少1，覆盖旧contract/question/target/session/lateACK；current1对future2不算旧epoch证明。
重放原receipt不重复答案/接受/ReviewTiming，channelgeneration不代替business fence，partial UI活动不是质量或授权。
验收：当前一次接受、旧候选/版本拒绝和回执幂等均来自恢复同链，controlledactor准确标注。

## B16 第四结果：原恢复交付

B13–B15闭合recoveredartifact/check/currentcandidate/manualaccept/delivered，原question/answer/nativeApplied/profile/contract可追溯。
normal5/5保留但不贴recovered；缺步骤如实未达，不再用不存在表或错误grep当结构阻断。
第四结果交实际source/consumer/原IDs/verification/acceptance及完整正反证据，E仍独立required。
发布B16 checkpoint后继续B17–B20，slot复用与aggregate资源不能由一次delivered推断。

## B17 原 scheduler 2/4 槽

用原application/execution背压先2再4槽，混合normal/待答/交接/恢复/unknown/stop/delivered；五Work记录不等五attempt占槽。
第五等待/拒绝以actualattempt/queue/Later/稳定原状态证明，不只看400ms暂时计数；每槽原credential/cursor/payload/receipt不串用。
wrongsubject、foreign lease与unknown隔离保留，不新scheduler/lifecycle，源/配置/actor原authority仍main。
验收：合法2/4与容量/控制优先级/原Work-Ticket-Assignment-attempt绑定，有限时窗与明确状态。

## B18 真 slot release 与复用

WorkView身份为view.work.id，既有读接口已支持，不能再因错find shape声称projection缺失。
用原binding ended/runtime.exited/complete-resourceproof和queuedwork实际继续核释放，不以phase字符串或单PIDgone作充分证明。
一次复用和一次45s未释放分别保留，定位actualsource/资源/命令，不把偶发positive升级整组PASS或清unknown强放行。
验收：每slot释放前后原IDs/资源与新attempt推进明确，未知writer不释放且material留存。

## B19 控制重入与资源集合

cancel/stop依actualpostproof/currentcompletebarrier，测停止期间coordinator再退出、仍活child、mixedunknown与late callbacks。
每signal前fresh核完整operation资源set和目标birth，PID/UID/argv/root/config/op一致才操作；未知集合不缩空。
记录FD/connection/waiter/queue/journal/进程开始峰值结束，sent/inspect/parentPID消失不是全writer已停。
验收：per-slot与aggregate归还准确，normal/recovered分层，12旧实例/数据无操作。

## B20 第五结果：多槽与归还闭合

B17–B19形成actual多槽恢复/交付/stop/release/复用，含控制重入、隔离、完整资源与unknown保留。
H在独立目录消费同一selectedI+Bsource提供合法输入/receiver观察，B修实现不改H/E期待或新增gate。
第五完整结果不只distinct IDs或单attemptquiescence，短run不称长期soak/nativecompat或发布。
发布B20 source后继续B21–B24，source交接不是整包终点。

## B21 active module 故障与 bounds

在actual最新I/Badapter测timeout/bytes/pending/queue/close/late/guardmissing-deny-throw，未使用helper的绿灯不证明activepath。
torn/corrupt journal、descriptor/chunk/ref/digest/ACKloss保持独立合法positive，已闭2KB/五块/CAS不互相回归。
限制在副作用/昂贵处理前生效，unknown原事实不reset/改ID/补结果；只扩本次相关必要suite。
验收：实际调用/接收/guard计数与timer/资源有界，没有许可、回执或writer状态的假成功。

## B22 消费者 strict 与 source 兼容

main/I/H/B actualconsumer directstrict/exactOptional通过，最新blob/exports/typedrefusal一致，不以root遗漏绿灯充数。
原connection产生的回复只能交原lease，不转current；freshframe.id与originalcommand.id语义在所有responder一致。
I管module/adapter，B管auth/dispatch/lifecycle，H管独立consumer；无重复pending/queue规则或测试专用私有authority。
验收：同一source跨consumer复现相应完整结果，module/normal/recovered/installed/native/required分别记量。

## B23 准确操作文档

更新latestI采用、sink显式guard、typederror、安全birth/unknown、originalA恢复/Completion/slot接口和实际命令，不保留已修/未修混写。
文档不承诺pendingexactlyonce、配置/FactSink等于批准、ps失败即退出、normalaccept等于recovered成功。
给独立开发者source/原IDs/有限错误复现，不教删DB/ledger/marker/queue或借credential；runtimebytes变后由D/E同artifact验。
验收：新consumer按文档可运行受控链/正确拒绝，docs-only不伪造runtime重冻，正常节奏不设当天强压。

## B24 第六结果与完整交接

写 `tests/native-acceptance/reports/wave29-status.json`，列24阶段/六结果、B/I/main/A/H源、原IDs/命令exit/实际行为/限制/未达，checkpoint后继续wholegoal。
只ownedpaths推origin原分支，不upstream/reset；两旧reportdiff/b16及全部data/profile/tar/ledger/dirty和12旧服务保留。
真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样。
第六结果含完整故障/类型/consumer/文档和实际scope；不新candidates表/ledger/coordinator/guard授权/Driver/CAC/桌面/autoaccept/第二生命周期。

## 独立备选队列

latestI合入未到先做sink显式guard/directerrorstrict/safe工具/正确candidate-slotconsumer；到源立即实际采用，不forkI自修或留平行queue。
mainconsumer未到给真实原A/Brokeradapter/RFC并继续自有fault/docs；H输入未到不成为B不实现lifecycle的理由。
safeproof未过只做pure/进程内控制，不跑现有SIGKILL/长soak；unknown留根，不signal旧或无法证明的资源。
普通App/recipes/insights/install与B/private/target/研究独立，readiness/配置/声明模板均不授native执行或费用许可。
