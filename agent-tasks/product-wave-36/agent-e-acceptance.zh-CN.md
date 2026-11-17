# E：完整资源与同cohort产品的独立验收子系统

2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-e`，原分支 `codex/g3-product-acceptance`。
先读 AGENTS、START-HERE、product-spec/README 和 [本轮 README](README.zh-CN.md)。
读 [0092 主线历史消费者](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)。
读 [0093 本轮验收架构](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)。
读 [0094 完整子系统闭环](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
一个whole-subsystem goal覆盖四个更大端到端产品闭环，聚合旧九成果，不再9→12列fix。
每闭环都包含实现、actual默认consumer、合法positive、必要独立negative、同版本维护与source交接。
早、中、晚源码发布后继续全部闭环、联调与独立队列，不逐fix等派工，不在green或报告后停工。
无时长、工时、同日deadline或token承诺；外部依赖只阻对应项。

## 准确基线、已关闭反例与责任

- E固定输入 `2644d23f`，最新实测source `4b4d4089`，336PASS/0FAIL/21NT原记录保持。
- ordinary204/functional205是legacyR1加currentW33等测量scope，local-alpha不含native。
- full206因native delivery/control缺失拒绝，不得称完整方案B或所有W35能力已通过。
- E真实outer/recovery/upgrade仍是W33 `048f/f880/ee45/46e`；不是D新W35。
- D新W35 source `edfe5e14f2f8fbc7f395a84520c781c7f07ce9e7`，build `599de3e98c02de0b`。
- innerSHA `11027a375848c25c2d2ae8e18755f65fa77272db533dcee7bb9ff27ba8ba50db`，20598155字节。
- outerSHA `39c0fff0e13d61c59198f8a55f0ed692b887194aaa4e2782b2b3e9cbd623f6c5`，63536701字节。
- 6883inner/6891outer/CRC/modelGUI/launcherfix真实字节已独立过；main新allowlist也已actual静态消费。
- 新GUI保存D自测是进展，仍需E同subject独立scope，不借W33或main当前checkout补。
- shared旧mixed-staleset信号和duplicatepost反例已真拒，原finallyUNKNOWN留存、oldtar空after也已关。
- 原项目403、pending和mainoperationunknown的旧whole-report反例现真拒，不重复称这些未修。
- 新残余是lateDescendants queryerror被当无child、releaseAllowed缺布尔仍allow、requiredoperation副本不绑定。
- Havailable后合法接受是真进展，不为旧review-unavailable抢跑松产品gate或编第二review。
- D旧W33rollback原retry已真关；当前W35upgrade raw仍BLOCKED，不可借W33success证明。
- Dalpha/beta是连续单项目runtime controlledscope，E原个人项目applicability仍NOT_TESTED。
- main正在接新completion-history，真实source发布后消费；ContextHistory不可替原Work history。

仅拥有 `tests/product-acceptance/`，E独占required/assertions/oracle和最终独立结论。
不改D/main产品、共享协议或其他owner；缺实现给最小输入约定，不放宽原授权/机器FAIL。
状态写 `tests/product-acceptance/reports/wave36-status.json`，准确标source/consumer/cohort与未达。

## 产品闭环一：所有资源query未知均严格阻断signal与release

完整出口：实际caller从出生到结束的每个effect和材料处置，都由完整当前resource proof授权。
聚合旧operation/query/signal/release/finally，形成一个生产工具协议，不只再补几条helper测试。
actualconsumer是outer/cohort/upgrade/故障case、sharedcaller-safety、原stop及实际完整report资源观察。

- 保留旧父死/no-set、mixedset、duplicatepost、finallyUNKNOWN反例已关的真实结果。
- pgrep-P只读关联查询不是授权来源；status0有效PID、合法status1无匹配和UNKNOWN必须区分。
- error/ENOENT/EACCES/timeout/signal/其它exit/坏输出不能catch成[]或“没有child”。
- 当前actualmodule在query失败后仍可TERM或rm，必须使整个operation retain且零effect。
- 不用globaldiscovery补缺失，不把发现的latechild自动收编；缺完整原登记就UNKNOWN。
- 每笔signal前fresh全immutable set，再fresh目标；不得先停validparent再发现stale/unknownchild。
- release本身验证一一映射与显式alive/sameIdentity/query/start/UID/argv，不只靠reportvalidator严。
- 缺布尔、空对象、duplicate/foreign/missingpost或查询失败均不等于退出。
- 正常完整set全exit是必要positive，原helper修复不得退化成全部阻断。
- 实际caller catch/finally/断言失败/stop拒绝都保留install/state/config/model及相关材料。
- 不能另建cleanupoperation复制birth绕stickyUNKNOWN，也不能先删资料再发布assertion失败。
- 所有子case、negative启动和GUI/Node/modelmock资源纳入同一完整保留策略，关闭mock不证明产品静止。
- 用显式private root，不重设HOME或借旧用户目录；共享rootconsumer缺则交main依赖并继续纯控制。
- actualsource纯stub要捕获queryerror、latechild、失败重观测、错scope与零误signal/delete。
- 只有安全前提齐备后才对独立完整自有集合做必要live，拒绝和UNKNOWN不被工具cleanup覆盖。

实现交接：wholeoperation接口和actualcaller源先发布，main/D/H消费同一协议，不各造一套清理器。
验收交接：合法完整positive、有限actualsource失败negative、原资源事实与材料保留结果。
这一闭环未齐就不跑新的unsafe故障；继续另外闭环的oracle/source/已有资料队列。

## 产品闭环二：同cohort双原项目、窗口、上下文、接受与重开

完整出口：两个不同原项目在同安装上日常使用，所有身份/范围/原Work与最终主张一致。
聚合旧preview/项目/draft/窗口/context/review/reopen/oracle，不能把单fixture或元数据positive扩称整链。
actualconsumer是该包的公开登记、原form/Application/Broker/verification、scopedinsights与历史/产物。

- 保留合法narrowfixture与两个registeredroot数据scope，但更强required需要真正原项目positive。
- 每个项目有真正完整applicabledraft，apply只预填，编辑后明确create，原scope/check/profile同源。
- Work/合同/attempt/candidate/接受必须对应原项目，不能都换project-atlas或轮换单项目factory冒默认双项目。
- selected-project7/30各自200且同project/窗口；contextSources.scoped200不替代metrics403。
- 保留本轮schema-validdraft但project403全report已真拒的修复，继续错window/project/来源完整控制。
- context预览/确认/使用记录/来源的实际读取与授权数据要同原project/conversation/work，不能借另一消息。
- 接受必须available+原verificationready，机器FAIL/trustedreview/resourceguard不被人工或测试绕过。
- CandidateRef按组合身份读，不因缺单一.id就宣布stale原因不可测；负例不得被其它早guard抢先拦截。
- 同原Work停止/重开读取原phase/contract/accepted与所有artifactIDs/bytes，不只比较消息数或总hash。
- 原问题/答案/native_applied/unknown回执分层，已完成动作不换ID重发。
- main新completion-history发布后消费实际Workhistory；现有ContextHistory不能当该接口已实现。
- 原mode/applicability缺消费者时给精确main/J/F输入并HELD该scope，不改grant或新建verifier补齐。
- producerassert与finaloracle同时严格；每个更强主张必须能被完整report的独立mutation推翻。
- requiredoperation副本也要过同semanticvalidator并与maincase绑定；不能只更改一个副本仍PASS。

实现交接：真实两项目recipe、字段/ID/authoritativeconsumer与必要shared依赖，source早交后持续联调。
验收交接：合法默认流程positive、scope/时序/字段/资源完整negative、精确cohort和可重做结果。
不会因该面HELD停止安装或数据队列，也不会把只修oracle说成原项目产品已可用。

## 产品闭环三：非空portability、当前upgrade和恢复授权/held

完整出口：不断增长的原业务与真实待问题数据，经同准确版本管理操作后保持身份、全部bytes和权限边界。
聚合旧backup/restore/held/directread/publicread/upgrade/rollback，不再以空库或旧target结果充当前闭合。
actualconsumer是安装原业务链、原CLI管理入口、冻结reader与现有明确review/rebinding/readonlyguard。

- 保留W33非空两Work、全部4交付bytes、26registry与held历史facts，不重派成“先证明有非空数据”。
- 新W35producer/reader/旧W33导入数据各自标版本；当前checkout与实际installedentry/hash不能互换。
- Dalpha/beta新不同ID数据是真scope，但同fixture profile/check/连续runtime限制要一直披露。
- backupsource、evidence、manifest、tar/ZIPtuple与target绑定，真实每个snapshot不可覆盖。
- 全引用artifact逐项read/hash/bytes及registry核对，不能只取前三个或改label当不同格式。
- 原question在stop前确有open/phase，恢复后的historical/held/stopping与活动问答continuation分开。
- 实际pending/effect行读前后保持，answer/business422、provider不增加与no-resend各有观察。
- 查询失败仍unknown，不读错table后用空数组/0声称无任务或答案没变。
- D明确review后ordinary候选投影200/write422已证；更强Workanchored正文或执行权不能借该metadata投影。
- 未授权403、wrongtoken401、已授权原身份200与source/Scope变化拒绝按实际guard分别验证。
- W35当前upgrade原rawBLOCKED不能记CONFIRMED；成功需独立原receipt/exit/operation/pointer/data，或诚实HELD。
- 旧W33成功rollbackretry继续有效，不用于认证不同新target；E自己的同pair管理probe独立为准。
- baselineorigin、新增post-upgradedata、binaryrollback后的原业务和bytes由实际版本读取。
- 不用旧快照覆盖新写入，不降schema；生产migration只消费A已准入路径。
- 任意目标不健康/未知资源/活跃state/改artifact/错format或manifest要无重发、无越权并保留材料。

实现交接：可运行的非空原业务和当前管理consumer，必要owner依赖先交后继续独立队列。
验收交接：同cohort完整字节/逻辑/权限/raw/资源事实及whole-report正负，不依赖summary。
恢复readonly不是native/private/target授权，原Work活动恢复缺接口时继续准确NOT_REACHED。

## 产品闭环四：当前产品独立tiers、重复日常与维护交接

完整出口：main和同事能明确知道当前准确版本可使用什么、证据来自哪里、出错如何保留和继续。
聚合旧outer/GUI/版本/兼容/支持/tiers/wholehandoff，完成一个可维护独立验收子系统。
actualconsumer是所选ZIP的真实外层入口、App/API、defaultconsumer、fullreport/requirements/oracle和维护材料。

- W35真实GUI/launcherfix字节和main新allowlist静态消费已过，不再重复旧滞后问题。
- E当前仍测W33f880/46e；明确下一次锁W35必要successor，不能用204/205mixedlegacy贴全W35。
- exactsource/build/inner/outer/manifest/Node/LICENSE/entry/hash完整绑定，静态声明/当前运行/实际能力分层。
- 对未测的真实GUI保存做同subject独立consumer，保存只写private文件、不发模型；不回显key。
- 已配置/未配置/HTTP明确同意/坏权限/并发/旧服务及重开保持资料与原返回语义。
- Start/status/Stop与原mode/root/build/端口/完整资源同源，状态STOPPEDexit2不等BLOCKED或UNVERIFIED。
- 同事自己的MacM/root/模型/工具/认证，不复制作者HOME或nativeprofile，不把同机copy叫跨机已验。
- 未签名/未公证和组织策略写清，不自动移除安全策略或安装/升级用户全局工具。
- 日常重复/多实例/错误保草稿/版本支持要有实际可复用positive和必要negative，不靠截图或计划数。
- sourceclosure192已列hash正确但新GUI来源清单不完整，区分selectedauditset与完整build/runtimeclosure。
- 支持白名单0600/新输出/无秘密，错误/unknown保留；unsupported不是0或complete。
- main新historysource只有发布并选入稳定runtime后才入安装结论，不追movingmain或为docs/tests反复freeze。
- R1 legacy、W33已测、W35待独立和必要历史consumer后继分别列case，不能平均或重贴scope。
- full206/native/恢复/原项目/收益缺证保留，不用更多PASS或local-alpha标签代更强结论。
- 所有requiredcase包括副本/来源/资源语义都要独立验；重复object不能一处严格一处只认status。

实现交接：稳定source让main/D渐进消费，必要强scope缺口和actualconsumer明确，不新建第二公共服务。
验收交接：当前cohort可重做的完整report、产品/维护说明和准确余项，整个goal继续可做的独立工程。

## 全goal的独立队列、安全与预算

四闭环均需实现→默认actualconsumer→同版本正负→维护/sourcehandoff，不拆更多编号或微阶段。
外部依赖只阻相关项；先交最小可编译约定/owner复现，继续资源纯控制、oracle、兼容和已有数据维护。
仅source可用就SOURCE_READY，无真实原项目/当前包/管理positive就NOT_REACHED，不以PARTIAL停整线。
仅拥有tests/product-acceptance，Esole产品断言；不修改其它owner源码或绕原拒绝来清理。
自动vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5pilot仍BLOCKED。
不reset/top-up/refund/补样/价格研究，不把用户后续主动调用冒作自动验收或旧budget退款。
保留全部state/profile/archive/ledger/history/dirty/runs/五日志及十二5180/8796至5191/8807实例。
live只可对完整独立birth/PID/start/UID/fullargv/root/config/op/fullset的自有资源，全集合先验且逐signal fresh。
任何query/身份/集合未知均retain整份资料；禁globaldiscovery/forcecleanup/HOME替换/路径认领/借凭据。
不新Driver/CAC/subteam/desktop/autoaccept/writer racing/dynamicDAG/第二review/账本/生命周期。
显式owned路径推原origin，不upstream/reset；一个whole-subsystem goal持续所有四闭环与独立队列。
