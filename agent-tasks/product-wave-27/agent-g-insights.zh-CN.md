# G：完整输入约束、真实 Node 观测与工作台摘要

2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-g`、原分支 `codex/g4-usage-insights`，保留历史后同步最新 `origin/main`，记录准确 source。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0068](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)、[0069](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)。
仅拥有 `packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`；main 管 root/contracts/deps/lock/HTTP/授权，F 管自有 trial UI，E 管独立 required。
十位外部 A–J 加 main 按正常节奏做产品，无“今天完成”强压或删门槛；G 不改 UI/SQL/runtime，不新增 ledger、观测 authority 或自动路由/接受。

固定起点 `2adeeff67363d3e13ca6c4e623034c54a14c1e01`：旧四类七个独立反例已真关，核心57/工具34/strict与真实两项目受控问答/接受/ReviewTiming链通过。
保留这些进展，不继续称旧 scope/window/complete-zero/streaming 全未修；未知 usage/queue/duration、partial UI review proxy 与 controlled/native 不混层。
剩余：一个 WorkEvidence 内嵌 outcomes 可绕小 records cap，workIndex A→B→A 可复活冲突映射，以及 G compact 输出未给 F 新 scope 声明，直接传只会隐藏。
main 本轮先接 F hook/insights 语义，可信 G Node 集成渐进推进；分析依赖 Node canonical/crypto，不能让浏览器 import G 根 index 或处理采集凭据。
建立/沿用 whole goal，无 token 预算；20 阶段在 G4/G8/G12/G16/G20 发布五个完整 runnable 结果，发布后继续，不在小修/partial/检查点停工。

## G1 嵌套数据的真实总上限

修复 maxRecords 仅数顶层 wrapper 的缺口：work-only 输入一个 WorkEvidence 内两条 outcome、maxRecords1 不能 accepted2/complete。
明确 outcome/event/container/page 的计数口径，所有派生子记录在昂贵解析/聚合前有真实有限总 cap，不借父记录已计一次绕过。
支持部分处理时记录原 source loss、accepted/notParsed 和受影响 coverage/unknown；不支持的 nested limit 明确拒绝，不能宣称 appliedBeforeParsing。
保留旧 top-level/exact-fit/未解析坏记录 controls，单页/WorkEvidence合法边界、多 wrapper/重复嵌套和有限大输入都验证。
验收：独立 nested negative 与合法 work-only positive 同时过，统计/CLI/summary 的计数、停止原因和 partial 含义一致。
不只新增一个计数字符串 helper；actual analyze/parse/collector consumer 必须消费同一实现。

## G2 冲突映射永久隔离

workIndex 同一 work 映射 A→B 后须留下该输入期的冲突 tombstone，第三次 A、B 或重排不能再次恢复为可信 mapping。
冲突传播到 work 的未知/coverage/metrics，不只顶层 quarantine；不确定所属项目的事件不得成为已知1或完整0。
结合原 outcome/project 映射核对，workIndex/recorded source 自称不可覆盖矛盾；同名 Work 或相近时间不用于 join。
保留 unique-map positive、outcome/index不一致和旧 unmapped/foreign scope 拒绝，新增重复/重排 triples 与混合合法工作。
验收：同一 source 无论输入顺序都隔离同一个冲突身份，合法部分与未知数/损失准确，raw report 与 compact status 不互相矛盾。
不创建新的映射 authority/数据库或让 UI 用手工过滤器修正 analyzer 错误。

## G3 与 F 新摘要声明真正对齐

更新实际 compact projection 使其携带可信的 scope.projectIds/aggregation、windowLabel、coverage 与适用 row metadata，不能只说 TypeScript 可赋值。
scope 从已验证 summary/request 原范围派生，不从任意自由文本标签猜；active project 不在摘要范围时不展示，跨项目聚合明确命名。
null/unknown 保留，整体 unknownCount 若没有一致去重口径就用 null，不把各行未知数机械相加；层/币种/单位不可混合或重复加后缀。
source coverage 与 metric coverage 分开，ReviewTiming.activeMs 每行仍 partial visibility proxy；不能仅因 overall完整就给代理指标完整 badge。
F 只显示输入，main 管实际来源和 root 集成，G 不修改 F/App/transport；给 main/F 真实 compatibility fixture 和行为消费示例。
验收：合法 G 输出经实际 F 呈现规则可见，缺 scope/错 project/缺 window/unknown/partial 的拒绝或限制行为准确。

## G4 第一结果：可信输入到真实 consumer

把 G1–G3 组成可运行的 Node analyze→compact projection→F/main consumer 链，包含 nested cap、永久冲突和准确 scope/coverage。
旧七反例、核心57/工具34的相关范围保留，新增两个边界与实际 compact 行为各有完整 positive；不机械重跑无关全套。
对报告、CLI、Node composition 和 F 输入使用同一数据语义，不因某个入口用旧 dist 或不同过滤逻辑而返回另一套数字。
readiness/configuration-only/authority none 不参与样本或执行判断，实际层/原始 source/limits/unknown 一直保留。
第一完整结果包括实际源、可调用纯 module、真实 consumer 接口与有限正负证据，不仅又修两段 if 或加 gate。
发布 G4 source checkpoint 给 main/F 后继续 G5–G8，whole goal 未齐不结束。

## G5 authorized Node 只读 composition

提供接受既有 authorized read DTO/ports 的 Node composition，main 完成 principal/project访问控制后调用；G 不创建 HTTP server、路由权限或私有 SQL。
项目/Work清单和唯一 work→project 映射来自原 public read，精确约束 requested project/window/contract 与总 nested records/events/pages/bytes。
保留可用字段与 source_missing/not_collected/partial；不能为了完整报告去扫描所有正文、猜隐藏 endpoint 或读 home/private DB。
analyze/collector/crypto 仅在 Node/coordinator，浏览器只收验证后的派生 DTO；root workspace/deps/lock/新HTTP入口由 main 集成。
验收：main 或私有真实 product read consumer 调实际 composition，错 principal/project/source 由原权威拒绝，无模型/native/产品写增量。
共享输入缺口交 main 最小 actual consumer/RFC，不另造认证/acceptance或统计 authority。

## G6 实际来源与数据可得性

消费原 ExecutionOutcome/ReviewTiming/WorkEvidence/History/Attention schema，记录准确 source/provenance/layer/observation window 和接口 coverage。
Work/question/answer/verification/candidate/acceptance 的原 subject 不匹配就隔离，不能将另一工作或版本事件拼成选定 attempt 的收益。
排队时间只用真实端点，duration/attention pending age 不改名 queue；缺 API 字段保留 null，并给 main 精确 availability。
UI 审阅时间保持 observed partial proxy，受控 actor/活动跨度不是真实人类工时；native/vendor/真实效果仍分别未测。
usage 仅 recorded known components，缺 reasoning/token/cost 不补零，不查价格，currency与layer按原事实独立。
验收：同 subject 实际 read 正对照、错来源/缺 timing/partial usage/不同币种和层，Node summary 与原数据可追溯。

## G7 私有真实 HTTP 与同源文件

保持显式 loopback base/token和 GET-only采集；不发现其他实例/home credential，不跟随跨origin redirect，不将token送往外部。
流式读 body执行累计预算、per-request timeout和总deadline，成功/错误/redirectbody均有限，不再整包arrayBuffer后查上限。
显式 verified file先约束regular file/size再parse，独占0600新输出，digest pin和范围override的事实不被隐式改写。
同源 HTTP bundle重读 analyze/verify/report得到一致历史指标，重复receipt/outcome不双计，changed body/ref/digest独立拒绝。
验收：真实adapter与文件同链可运行，原数据和旧报告字节不变，坏来源返回准确partial/unavailable而非空完整集合。
不新增账本、生产writer、实验模型任务或“为了样本”启动真实agent。

## G8 第二结果：真实 Node 读取与复现

G5–G7形成actual authorized product read→有界collect→verifiedfile→Node分析/compact→报告的一条链，不拼多个不同subject示例。
使用私有真实受控Product/Application/Broker/verification/acceptance数据，保留原问答/接受/ReviewTiming与未知usage范围。
记录source/consumer/原项目/Work/合同/时间窗、API、输入digest、读前后events与有限资源，任何fixture不升级nativeproof。
main actualHTTP接入未到时交完整Node composition/private consumer，准确记产品route未达；不让F未展示成为停止G实现的借口。
第二完整结果要求同源可复现且错误/缺失有界，没真实operator数据也可完成工具，不能称因果效率收益。
发布G8 checkpoint后继续G9–G12，正常节奏不压缩身份/coverage/资源门槛。

## G9 两项目隔离与窗口日常流程

使用两个真实受控项目和同名Work，分别独立观察与明确跨项目聚合，project/work/contract/attempt/source不靠文字匹配。
history事件按原entry.at过滤，current attention保持单独snapshot和新鲜度，旧窗已知空与未采集/来源坏必须区分。
两项目重复采集、文件重读、不同窗口与当前项目选择均不双算或跨scope泄露，unknown/partial留在所属来源。
原真实问题/答案/native_applied/验证/候选/接受/timing链与统计同subject，数据生成器只在自有受控装置使用现有公开入口。
验收：两项目实际读取、单项目filter、旧窗口、冲突/未映射source和重复观察的Node/CLI/consumer一致。
不操作十二用户服务，不查询私有SQL，实际operator/native输入缺失准确NOT_TESTED而非自动补样。

## G10 主线真实 UI 的有限指标

给 main/F 可直接消费的可信派生数据和定义：已观察执行/接受、人工交互事实、候选等待、partial UI proxy与已知usage各自说明。
未收集指标不显示错误0；合法known subset可以呈现，但样本、未知、per-row coverage/layer/currency与整体范围都清楚。
UI 不 import G 根Node module/collector/crypto，不接收credential/rawprompt/payload/私有路径；main拥有HTTP/输入授权及最终组合。
与F新scope声明对齐，不把“含当前项目的多项目集合”误画成当前单项目总计，聚合类型与projects数量一致。
验收：actual main/private UI consumer展示合法数据、拒绝错scope/不完整声明，core readiness/四导航在insights缺失时照常可用。
G不改App/transport/F源、Erequired，不增加自动路由/接受建议或把ready解释为质量/执行授权。

## G11 unknown、partial 与层/币种

校验每一来源损失与metric值/样本/未知/排除口径；拒绝记录后没有正面完整枚举时不能变测得零。
整体complete只描述输入完整性，partial review proxy/usage completeness仍逐行保留；来源未知不能因有某个known字段被整体补绿。
原actual_native/controlled/protocol_fixture/schema/operator_note不合并，生产者自写标签/文件可解析不成为独立nativeadmission。
不同currency分别known total，缺cost与token components显式unknown，不能把成本0/订阅免费/缺价格当已知。
验收：完整、部分、全未知、混合层/币种/冲突源的summary与F/CLI展示一致，任何欠缺都无假完整或“提升率”。
保留低成本纯观测定位用途，不因少量样本生成因果结论、用户节省时间或质量评分。

## G12 第三结果：两项目真实呈现

将G9–G11同一真实两项目观察接到main/F的stable summary/interface，合法跨项目/单项目切换和unknown/partial均可用。
实际UI尚未接线时交可运行Node输出+F实际规则consumer和最小main需求，准确保留真实UI步骤未达，不填“结构兼容已完成”。
来源坏/权限限/接口缺失不破坏F核心工作台，不能用rawbundle或caller自写label绕过main来源选择。
保留原source/consumer/hash/实际值和未测vendor/operator范围，controlled数据不会因为按钮可见而变nativeproof。
第三完整结果为两项目数据→可信presentation与失败路径，而非新dashboard草图或更多测试gate。
发布G12 checkpoint后继续G13–G16的CLI、隐私报告与实际operator输入边界。

## G13 CLI 与重复观察可用性

collect/analyze/report/verify/help参数与exit状态统一，scope/window/timezone/limits/输入digest可明确设置，不依赖ambientkey/privateDB。
用户能连续观察同窗口、改变窗口并回看历史，重复运行不覆盖旧报告或双算上轮receipt，真实部分/缺来源有清楚下一步。
Node source/build与CLI消费一致，不能测试src却默认运行旧dist；版本/导出/包内工具需求给main/D准确清单。
stdin/file/HTTP若受支持都执行同一总bound和来源规则，未支持就明确拒绝，不为了便利打开无界路径。
验收：真实合法输入完成一次全流程，badargs/auth/slow/limits/changedsource/diskfailure输出准确，原输入和旧输出保持。
所有等待/读取/处理有限，不循环等外部数据，不申请新模型/原生turn补齐样本。

## G14 隐私报告与不可信文本

报告优先真实project/window/coverage/sample/unknown与有限provenance，数字能回到原subject，不陈述未经测得的收益。
秘密/原文/绝对路径/credential/header/stack不进入分享输出；不可信free text转义，不产生任意HTML/link/命令入口。
输出0600/exclusive/不覆盖，大小/rows/diagnostics有界，截断说明明确；异常只清理精确自己创建的临时资源。
operator自由注释和baseline来源与事实分开，user provided数据不是permission/nativeproof或生产approval。
验收：合法report、hostiletext/秘密/链接、existing/symlink/outputerror/中断负例有正对照，错误不能泄露sourcebody。
main/F接收稳定脱敏DTO而非完整敏感bundle，报告不是第二账本或publication/release authority。

## G15 明确 baseline 与解释边界

operator baseline显式来源、project/window/单位/aggregation/layer/sample/coverage，手填节省工时留operator_note，不混成测得事实。
不同任务复杂度/层/币种/窗口/缺coverage不比较；0分母/无baseline/unknown给null或不适用，不能制造Infinity/100%节省。
确实可比时也只是观察差异，不因today目标、少量sample或实际工具可运行而称因果收益。
readiness/configuration仅附录，不能计入执行次数、native样本、完成率、质量、费用或收益。
验收：明确可比正对照和不可比/缺失边界，CLI/Node/F描述一致，不扩成新的study/fee/模型recipe研究。
没有operator/native数据时工具仍可完整交付，准确列未测和可测范围，不自动增加实验预算。

## G16 第四结果：可使用的观测工具

把G13–G15与已测Node/真实数据组成用户可用工具：有界采集、重复报告、可信privacy输出和baseline解释。
独立消费者按文档从显式合法输入生成准确报告，遇到partial/unknown/integrity错误知道该补什么，不要求删DB/ledger/marker。
给F/main当前stable DTO、实际source/build、范围和失败约定，G不取得main授权或rootUI/runtime所有权。
第四完整结果包括CLI日常可用与隐私/解释边界，不以又加一个validator或静态JSON为终点。
精确记录operator/native/installed未达，普通工作台/安装/研究与本工具独立，changedruntime字节需对应新包才能称installed支持。
发布G16 checkpoint后继续G17–G20，source发布不是等待点或整包完成的代替。

## G17 完整故障与 bounds 回归

有限测试top-level/nested records、events/works/pages、bytes/deadline、冲突triples、schema/cursor/digest和异步source损失。
每个故障有完整合法positive，原四类七反例与新增nested/tombstone不相互回归，未知范围和资源规模可解释。
在声明bound内记录环境/输入量/耗时/内存，不为自造benchmark放开cap或增加外部依赖，短测试不称48h稳定性。
只扩风险相关覆盖，不机械重复大量旧suite；修复后实际Node/CLI/Fconsumer的行为同步核对。
验收：超界在昂贵处理前拒绝或准确partial，cap不能被childwrapper、source映射或fallback绕过。
不使用真实gateway/native来填fault，全部明确私有受控fixture和zero vendor调用。

## G18 main/F/安装包消费者兼容

与main的authorizedNode readcomposition、F presentation类型和D包内exports实际编译/调用，不只复制同名interface声明兼容。
root注册/deps/lock由main，运行包只带必要Node source/dist与稳定schema，不把probe/nativeprofile/key塞入runtime。
caller应该能沿小interface获取已验证summary，不需要再维护一份去重/scope/unknown/limit逻辑才能修正G结果。
安装包consumer实际字节/source/build要匹配，E独立required不归G；checkout通过不能贴给旧tar。
验收：准确consumer严格编译与有限正常/拒绝路径，明确backend/browser隔离和module的适用范围。
外部artifact未到只阻installed步骤，G已拥有源码/工具/文档和数据质量继续推进。

## G19 文档与维护完整性

更新package/tools/reports指南：输入协议、实际命令、计数口径、scope/window/currentattention、partialproxy/usage与baseline限制。
具体说明nested总cap、永久冲突、流式budget、generation无关统计身份和Fscope adapter，不再保留已修/未修混乱声明。
示例包括真实受控两项目和纯fixture，source/provenance/native未测标明，secret/原文不出报告。
调试依赖明确source/subject/cursor/loss/errorcode，不教用户借credential、清ledger、改E断言或重置pilot。
验收：独立开发者复现Node/CLI/consumer，不读实现内部或添加第二分析器/数据库即可使用与排错。
保持正常节奏完整交付，不把今天完成/测试数量/轮次作为提升质量和准入的证据。

## G20 第五结果与最终交接

写 `reports/usage-insights/wave27-status.json`，列G1–G20/五结果、准确source/build/consumer/输入digest/原subject/命令exit/值/coverage/限制。
第五结果包含完整故障/bounds、main/F/包内兼容、可复用文档与实际工具，不仅一组helper修正或新的gate。
4/8/12/16/20提交source后持续whole goal，外部数据未到准确列依赖并继续独立项；完成只指实际可使用scope，不冒充native/收益。
只explicit ownedpaths推 `origin` 原分支，不upstream/reset/rootlock/mainFUI/A SQL/B runtime/E断言，保留所有历史证据与dirty。
真实vendor/model/native0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样。
十二组5180/8796至5191/8807与全部data/profile/tar/ledger保持；不新Driver/CAC/桌面/autoaccept/routing学习/第二执行生命周期。

## 独立备选队列

main真实route未到先交Node注入式composition、合法publicDTO/verifiedfile consumer、实际Fprojection和CLI，不浏览器import根index或私读SQL。
F/安装包未到继续可信scope/bounds/unknown、两项目数据/隐私/CLI/文档；给精确source/输入需求，不责怪main未展示未准入数据。
operatorbaseline/native缺失时单窗controlled/unknown工具仍完整工作，不补样/新study/价格recipe研究，不把readiness当执行或收益证明。
H/I/J有新产品模块时仅消费其明确既有数据，不新增统计authority或抢source；验证/等待都有限，checkpoint不是停工点。
