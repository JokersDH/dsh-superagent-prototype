# H：独立原业务证据、外在资源与同事试用连续交付

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-h`、`codex/g4-trial-operations`，保留全部历史后同步最新 origin/main。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0080主线检查点](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)。
再读 [0081](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)、[实际验收](../../reports/releases/wave31-admission/runtime-channel.json)。
固定 H `55766f412bde0a4bf3b7b2569e8ae9c5b4c5f3ec`、B `fbc9331`、I `4bce067`，后续绑定准确完整source。
三个连续交付包、每包四个完整成果，共 H1–H12；交检查点后继续，不把修一个helper当整包完成。
建立/继续覆盖十二成果的whole-packagegoal，无token预算、无当天deadline，依赖只阻相应项。
H提供独立消费者和支持证据，不新增第三coordinator/ledger/releasegate，不替代Erequired assertions。

## 归属、准确范围与安全前提

- 只拥有 `tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`。
- 不改B/I/main/A生产源、root/contracts/config/lock/HTTP/UI或E断言；owner问题交精确复现。
- current-source/materialization旧sinkbug断言已修，9finite测试通过，不再派旧修复。
- guard3 privateWeakMap/deepfrozenfacts/returnedcopy已关闭旧retarget，历史guard2不改label。
- 新P1：spawnOwnProbe birth不完整/psUNKNOWN的失败分支仍raw child.kill(SIGKILL)，必须先封闭。
- B actualservice12/guard8/strict/I16已过；remote旧stdio0frame、freshnonce/namespace/prune保留。
- H original-ingress2普通原Application/QuestionBroker/AStore reopen8checks已过，但明确Bcallbackjoin未达。
- 原normal candidate/manualaccept5PASS保留，不等于sameWorkrecovered或2/4真实slot。
- 主线窄合必要通道/薄ports/RunnerLink小修，不引收费DriverKit/index/resourcefacts或fixtureentryoverride。
- vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5pilotBLOCKED，不reset/topup/refund。
- 十二服务5180/8796至5191/8807以及全部state/profile/tar/ledger/history/dirty不动。
- 只对独立证明本probe出生PID/start/UID/fullargv/root/config/op/完整resources允许有限signal；no globaldiscovery/其他凭据。

## 交付包一：安全工具与真实当前消费者

### H1 出生失败的零信号收尾与完整私有意图

产品成果：安全工具的正常、失败和cleanup全部遵循同一完整出生边界。
- 修guard3不完整birth/UNKNOWN观察时直接child.kill(SIGKILL)路径，失败不绕过privateguard。
- 原spawnexecutable/有序完整argv/root/config/op独立捕获，不能用observedcommand自证原意图。
- privateimmutablehandle绑定原ChildProcess和已知完整resources，返回defensivecopy不暴露authority。
- 每signal fresh全身份/knownset，UNKNOWN保留材料，不把ps异常当gone。
真实消费者：spawnOwnProbe/signalFresh/waitGone/produce3正常与异常收尾共同消费同一registry。
- positive完整ownprobe允许目标精确TERM与freshescalation，mutatedobservation仍指原PID。
- negative无birth/psunknown/unparseable/mismatch/missingargv/plan/copyhandle/retarget均0signal。
- 同时spy child.kill与process.kill，不能只测公共signalFresh遗漏spawnsidefallback。
- puremock全过才可有限ownlive；不直接运行旧procguard/长soak。
证据：source、fullintent/freshidentity、spy计数、positive/negativecommands/exit。
- 失败无法核全出生时准确保留probe与reason，不无条件删除根或宣称clean。
- 当前guard3原retarget修复保留，不回退guard2或caller-ownedmutablefacts。
- 不扩成通用daemon管理器，不凭ancestry/path/同UID宣称ownership。
- H1发布后继续H2–H4实际consumer，不以安全helper收工。
- B需复用交源码/使用契约，H不越权改Bsignaltools。

### H2 当前 main/B/I 实际源码消费与来源绑定

产品成果：独立工具执行当前实际主线通道，任何current标签都能对应真实字节。
- 绑定main0080checkpoint及B/I必要sourceclosure，sourceimport前后核对commit/blob/materializedbytes。
- 只运行真正当前consumer；historicbugdetector保留历史，不要求修好的sinkbypass再次存在。
- no missing/deny/throwguard写入，freshallow逐次、remote单transport、oldnonce拒绝保持。
- mainNativebeforewrite/currentcommanddigest/liveadmission是原authority，不由Hbooleanmock替代。
真实消费者：actualBserveRunner/endpoint/RunnerAttachChannel和当前main公开入口。
- positive实际三callbacksource与guard计数、分页/五块/CAS可有限抽样保持。
- negativewrongroot/commit/hash/entry、foreignproducer、oldgeneration不改变owner或写入。
- sourceonly入口缺installedentry时明确tier，不能悄悄从checkoutfallback。
- 输出脱敏且不泄localpath/凭据/原用户privateDB，读取不启动model。
证据：actualconsumerpath、producer/consumerfileshash、exactsource与commands/exit。
- docs-onlyHEAD变化与runtimeblob变化分开，不假造refreeze或旧scope失败。
- H只消费/报告，不改B/I/main源修发现的问题。
- 输入缺失交最小复现，独立normal/source/readonly支持继续。
- 发布currentconsumer后继续H3原Storejoin和H4正常产品对照。
- 不把模块双桩结果升级真实Product接线。

### H3 原 A Store/Broker 三回调独立读回

产品成果：独立证明本次通道写入与本次原Work/question/answer/receipt属于同一业务。
- 消费B/main actualoriginalauthorityentry，facts经原ingress/UoW，payload经原immutablestore。
- 原Broker target/version/current/answeradmission审查来自实际调用，不造booleanpermit。
- 直接用原Apublicreaders重开读Work/question/answer/command/observations/delivery。
- 不把normal-chain产生的数据与另一Bdemo的facts拼成join。
真实消费者：一个same-run原ApplicationWork经actualB/I触发三callback并产生原问题。
- positive原fact/receipt/payloadref、原questionexpectedversion与native_applied同tuple连续。
- negativeforeignsubject/target/version/body/receipt/payload、missingguard拒绝在effect之前。
- 新frameID与原businesscommandID分别记，oldallowed不迁移下一intent。
- genericStore.facts空participant只fixture，精确标actualbusinessjoin是否达到。
证据：同run原IDs/原读口、receiver/guard/effect与source，不只报告checks:true。
- B/main接线未到写NOT_REACHED并交可运行consumer，不新增临时coordinator补洞。
- 现有normalreadback8checks作为positive保留，不能反复算成新join成果。
- 不改迁移/schema/Erequired，原权限源全部保持。
- source交后继续H4产品对照，首四成果不能只修H1等依赖。
- 无真实vendorCLI/gatewayfallback与新预算。

### H4 原问题到普通交付的可复用正负对照

产品成果：原应用正常问题、检查、候选、人工接受链有独立可运行基线。
- 使用原Application/QuestionBroker/Completion/check/currentCandidate/explicitaccept，不直写accepted。
- 同一原Work、artifact/location/verification完整绑定，保留humancriteria与资源门。
- 对照可供B恢复run比对原流程，但标签清楚ordinarynormal，不冒充恢复。
- 原scope/contract/manifest/currentcandidate任何改变须走原拒绝路径。
真实消费者：当前main公开commands/readports、原Store和受控本机fixtureexecutor。
- positive原问题回答native_applied、registeredcheck执行、candidateaccept/deliveredartifact可读。
- negativestalecandidate/旧verification/未审阅/unknownwriter拒绝，不能自动接受。
- 原ready→accept与review时间只记录实际有的观察，不能编人工审阅时长。
- 结果重开还在同state，fixture/native/installedscope分别报告。
证据：完整CandidateRef/原artifacthash/read、原命令status/exit/source。
- 原normal5PASS不重新宣称创新收益，作为稳定对照保存。
- 首四outcomes交安全工具、actualcurrentconsumer、原Storejoin及可复用normal对照。
- 若join依赖未到，H4可独立交付，不以H3暂缺冻结全包。
- 发布包一checkpoint后继续包二sameWork恢复独立证据。
- 不新候选table/ledger/gate或代E签release。

## 交付包二：原业务故障与外在资源证据

### H5 同原 Work 新进程恢复的独立观察

产品成果：独立看见原coordinator已退出、原Runner仍在、继任新PID读取同一原Store。
- H1/B安全准入都完成后才消费有限livefault；每signal按各owner精确birth/resources。
- 原Work/Ticket/Assignment/attempt/session/request/contract/Runner/child不变。
- 继任从原登记/currentbinding/command/payload恢复，而非加载调用方人工结果JSON。
- 读回与执行许可分别标，readscope/旧设置/登记不提供新writegrant。
真实消费者：B实际sameWorkrecoverrun，H独立读取公开材料和本次原AStore。
- positive旧PID gone独立证明、Runner原PID/startalive、新PID原tuple接入。
- negativewrong/recycled/foreign/unknown观测0signal、不清仍活/unknownroot。
- 新Work/新Runner/第二ledger即使普通流程绿也不能算原恢复。
- 无live准入时做正常consumer/纯mock，并精确标故障步骤未达。
证据：原PID/fullargv/root/config/op、originalregistration、state/consumer/source/exit。
- H不创建第三receipt-onlycoordinator或另一个恢复执行器。
- 只观测已证明本probe资源，不全球端口/tmp/ps搜索猜归属。
- 同run材料连续保留，不覆盖旧报告使结果看似latest。
- source早交继续H6ACKwindows与H7外在资源。
- 不以B进程内double当OS新进程证据。

### H6 原命令与原答案 ACK 故障窗口复验

产品成果：独立区分原业务已持久、仅意图、已写但回执未知，防止错误重发。
- 消费same-run beforewrite、receiver后ACK前、ACK后receipt前、receipt持久后的实际fault点。
- 原Acommands/dispatch/observations/answer/delivery与实际receiver一一对应。
- intent_recorded不等价observed；native_written/response_written不等价native_applied或quiescent。
- UNKNOWN保留原ID/state，禁止换command/attempt、refund或伪not_seen。
真实消费者：B原问题与答案通过原Broker恢复后的同run公开readers。
- positive明确durable/observed窗口不重发，not_seen按原策略且仍freshguard。
- negative晚ACK/旧target/session/version/epoch/body、缺delivery时不会推断安全重试。
- 包含已observed但未持久与receipt写后coordinator退出，receiver计数准确。
- 当前windows2逻辑fixture保留，但不冒充真实崩溃窗口已测。
证据：原question/answer/command/fact/receiver/ACK/receipt同tuple和effectcount。
- B无相应hook交缺口和最小输入，继续无signal窗口逻辑/原Store读取。
- 不直写业务state制造“实际接收”或“实际ACK”。
- 不把单条命令sent:true当恢复交付/slotrelease。
- 发布窗口consumer继续H7资源与H8samecandidate。
- 独立结论可FAIL/NOT_REACHED，不能迎合owner状态。

### H7 全资源集合与两槽四槽外在核对

产品成果：业务槽释放有真实全资源结束证据，未知资源不能被绿色汇总掩盖。
- process/child/socket/fd/timer/waiter/queue/journal/Runner集合来自本run原owner已知资源。
- 每资源有独立birth/identity和结束观察；ancestry/path/同UID不是所有权。
- 原barrier、bindingended/runtimeexited与外在资源结论同时核对。
- moduleclose、parentgone、JSONplancomplete或空集合不等价完整quiescence。
真实消费者：B原scheduler2/4slotactualrun，H不另建资源authority或cleanupdaemon。
- positive全knownset结束后原queue第五项真实前进，峰值/结束状态一致。
- negativepartial/unreadable/recycled/unknownchild/waiter/queue不释放对应slot。
- 一槽fail/cancel/unknown不关其他槽，错slot凭据/receipt不跨槽。
- syntheticresources2已过保逻辑范围，actualrun新增外在proof才报产品准入。
证据：各slot原attempt与fullknownset、birth/endidentity、queue/binding与controllerexit。
- 不运行长soak凑时长；有限场景要实际触发不同资源边界。
- H自身collector/timer也有限关闭并单列，不混入Runner产品释放authority。
- 安全不满足只观察/保留，不rawkillcleanup。
- source交后继续H8同恢复交付证据。
- 不修改Erequired把Unknown变PASS。

### H8 同恢复候选与明确人工接受独立复验

产品成果：原sameWork恢复后真的产check/candidate并由明确动作交付，而非换普通任务。
- 原artifactmanifest/frozenref/basecommit/contract与原machinecheck绑定。
- 读取原WorkView.actions.currentCandidate完整ref和原Applicationacceptance，不造acceptedJSON。
- 人工criterion/currentvalidation/resource门照旧，controlledactor不代表实际质量收益。
- 只接受同run原question→answer→check→candidate→accept→artifacts链。
真实消费者：B包二同原run与当前main公开readports/原AStore。
- positive原verification实际exit、同候选recorded→delivered，artifact/location/downloadreadable。
- negativestalecandidate/旧checkref/contract/scope/unknownresources不能接受。
- 原state重开后sameIDs与终态保持，lateframes不复活旧候选。
- ordinarynormal5PASS与recovered结果分列，不用完整JSONtuple冒充实际consumer。
证据：same-run原IDs/producerconsumer/source/bytehash/命令exit/资源终结。
- 缺任何环节精确NOT_REACHED，禁止换subject或仅引用B自报PASS。
- H不代E签installed/native/release，sourceonly就是sourceonly。
- 包二checkpoint发表后立即继续包三同事支持与exactpackage观察。
- 没有live授权也可完成读口/normal/refusal独立队列。
- 不新增候选/receipt/审核台账或自动接受。

## 交付包三：精确发行线与同事试用支持

### H9 锁定829或R2 exact tar 的独立消费者

产品成果：试用支持只针对一个真实不可变包，消费者字节与产品一致。
- 优先锁当前829；若D交必要新runtime则锁明确R2subject，不把旧包改label成新source。
- tuple含source/tar/build/hash/schema/ABI/mode/operation及producer/consumerentryhash。
- 必须从immutablepackage加载实际consumer，sourcecheckout不填包内缺失入口。
- E拥有最终required/verdict，H提供独立调用材料和支持，不新gate。
真实消费者：同包内CLI/startup/readonly入口及只读support工具，完整packageprovenance。
- positive合法samepackageread/diagnostic返回真实观测与exactsubject。
- negative真实foreignconsumer/包缺entry/错hash/sourceonly拒绝该installedtier。
- runtime新byte需Dfreeze再验，docs-only不要求假refreeze。
- ordinaryinstall/review与privategrant/businessrecovery/target分开。
证据：immutableentrypath/hash、实际commands/exit、subject与独立negative。
- 旧package的时间范围保留，不把后来功能缺失称旧包回归。
- D未交R2则继续829真实支持，不能停工等待所有功能凑齐。
- 不碰用户12实例；只精确本次出生installroot/resources。
- 发布packageconsumer后继续H10readonly/SSE/multiroot。
- 不解阻原模型研究或接新Driver。

### H10 只读、SSE 与多根试用问题定位

产品成果：同事能读取允许内容、收到准确事件，并在换根/权限改变时得到可解释拒绝。
- 消费当前实际readonly/restore-review入口和原Scope/principal/receipt/bodyguards。
- optionaldiagnostics不授permission，默认响应不扩大内容或扫描project/candidate/history。
- SSE按真实可用entry测试reconnect/cursor/结束/拒绝，不能声明未有入口已支持。
- 多root作用域与sourceidentity严格区分，不从copiedcredential/registry取得执行grant。
真实消费者：H9samepackage入口，源码counterpart单独标source证据。
- positive合法same-scoperead、允许事件和boundeddiagnostics可读且无privatepath泄漏。
- negativescopechanged/wrongprincipal/root/source/stalereceipt/tamperedbody先拒绝内容。
- 合法REUSED需matchinghealth/PID/selection，错selection/port/unbound仍refuse。
- 原用户实例、socket与credentials不全局扫描，自己的观察也不触发任务。
证据：samepackageconsumer与source/HTTP/SSEstatus/允许内容摘要/拒绝计数。
- 未实现UI消费/privatepermission/target准确未达，不用readscope充grant。
- 有限重连/断开，不跑无限soak制造样本。
- main问题交复现与entry，不改HTTP/provider/UI。
- source交后继续H11backuprestore和H12同事support。
- 普通read/installedscope不依赖B恢复或BLOCKEDpilot。

### H11 备份、还原与显式 review 的同包支持

产品成果：同事按原实际入口备份/还原并明确选择历史项目只读review，数据来源不混淆。
- 分清workflow-snapshot/evidence与personal-evidence/bundle协议，不互换formatversion。
- 使用真实非空normal数据与原requiredfamilies/版本recipe，不relabelling新fixture为旧producer。
- review显式selection/identity/currentroot/principal/host/actionkey/marker/source全部由原入口校验。
- readreview只带authorizationnone，不触发queue/Runner/provider/target或续旧执行许可。
真实消费者：H9samepackageprepare/start/review/readcommands与原公开readers。
- positive同package备份→secondrootrestore→显式review→原candidate/history/frozenbody只读。
- negative无review/错selection/窄scope/changedsource/invalidsignature/错版本拒绝。
- REUSED仅matchingselection/health/PID成立，不能借已有daemon绕access/port或review匹配。
- 记录heldqueue/providersnative0，原backup/tar/history不覆盖删除。
证据：producer/consumerhash、实际nonemptyIDs/source/format与commands/exit。
- D/Einstalled结论独立，H不把sourcecheckoutprepare当包内producer。
- privatepermission、businessresume和targetactivation仍各自未实现/未达。
- 普通restore/review可独立于B livefault与模型预算继续。
- 提交后继续H12完整支持包，不在一次restore成功结束。
- 不新增迁移/ledger或更改原格式authority。

### H12 同事试用手册与有界支持观察

产品成果：内部同事能独立安装/启动/诊断/收集问题，支持材料准确且可迁移。
- 写可执行使用/故障流程，先actualentry/normal功能，再说明权限/未知/恢复限制。
- 输出脱敏source/package/health/operation/事件与必要错误，不收无关凭据或用户privateDB。
- boundedobserver有总deadline/输出上限/明确resourceownership，结束不遗留自身timer/child。
- 成果来自不同真实边界，不用延长600/1800soak或同happycase凑运行时长。
真实消费者：精确包新privateprobe安装根和一个新同事场景，不能操作原12实例。
- positive普通导入/讨论/委托/问题/检查/人工接受/只读恢复按已实现scope使用。
- negativesource/package mismatch、staleidentity、UNKNOWN资源、权限不足给准确保留/拒绝。
- startup/stop只影响独立provenbirth/operationknownset，不能全球端口cleanup。
- 普通功能、controlledrecovery、vendor/native、installedrelease/研究收益分别标范围。
证据：runnabletool/docs、samepackagecommands/exit、脱敏report与准确NOT_REACHED。
- 更新 `reports/trial-operations/wave31-status.json` 记H1–H12/source/run/原IDs和owner缺口。
- onlyHownedpaths推origin原分支，保留所有历史/ledger/profile/tar/dirty。
- checkpoint发布后继续可独立项；wholegoal仅十二成果真正满足才complete。
- 不给E代签、不新supportgate、不代Bmain补第三coordinator。
- 用户可用性结论依据实际entry，不因测试数量上升而抬冻结完成度。

## 独立备选队列

- B/main原join未到：交当前可运行consumer与所缺entry，继续normal对照/readonly/SSE/package/backup/docs。
- B/H安全未过：不liveSIGKILL，继续全mock异常路径、无signal双client与原Storereadback。
- D新tar未到：锁829完整subject继续普通installed支持；新source能力分列，不冒充R2已冻结。
- E最终准入未到：交可复现素材，不新gate/改required/自签release。

## 整包完成条件

- 十二outcomes各有实现/真实consumer/positive/独立negative/exactsource，normal/module/recovered/installed准确分层。
- 三个checkpoint早发布后继续整包，不把一次helper修复、9tests绿或旧长soak报告当结束。
- 不改owner生产源/root/contracts/config/lock/HTTP/UI/Eassertions；发现问题给精确路径和最小复现。
- model/vendor/native0、BUNKNOWNgrant与EBLOCKEDpilot保持，不reset/topup/refund/补样/研究新price/recipe。
- twelve用户服务/allstate/profile/tar/ledger/history/dirty保留；无globaldiscovery/foreigncredentials/rawkillcleanup。
- 最终交可供同事实际使用的支持包和原恢复独立证据，不用耗时、case数或阶段数替代产品成果。
