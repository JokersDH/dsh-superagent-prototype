# E：三个连续工程包，同 installed 日常产品与完整独立结论

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-e`，原分支 `codex/g3-product-acceptance`。
先读 AGENTS、START-HERE、product-spec/README 和 [本轮 README](README.zh-CN.md)。
读 [0089 模型配置消费者](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)。
读 [0090 独立验收架构](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)。
读 [0091 连续子系统计划](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
一个whole goal覆盖三个连续工程包，每包三个完整产品成果，共九成果，不是九条微修。
每成果必须有实现、actualconsumer、合法正向、必要独立负向和可运行source交接。
source早、中、晚发布后继续下一包、联调和独立队列，不等用户再次派发、不在green后停工。
不设时长、工时、同日deadline或token承诺，不重置原预算和wholegoal。

## 准确基线与已经证明的进展

- E输入 `4f9373a4`，最新实测source `7e269fff`，325PASS/0FAIL/20NT原始记录保留。
- outer/recovery/upgrade已真正锁W33source048f/buildf880/outer46e，不能继续称仍只测W32。
- W33innerSHA `ee45c92c7c5a8f2caa0449572b14bf97175b0392f1fd92c6f89d7a19464604e8`。
- W33outerSHA `46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9`。
- E200/201仍含legacy R1，full202因native缺失拒绝；不能把aggregate贴成全W33通过。
- 旧finally两个原反例已由actualcaller+actualsharedmodule纯复验：UNKNOWNretain，无删除或信号。
- 旧foreignPID/缺start、空after含旧tar、notfound已由完整report真拒，不重派成未做。
- 新sharedsignal只fresh目标未预验全set，releaseAllowed可重复parent观察漏child，需整协议收口。
- schema-valid完整draft+sameProject但每项目insights403仍可过；contextSources200不能替代。
- Hreadyaccept、同Work产物重开已真进展，不松产品review或编第二review修旧抢跑。
- D新rollback原raw/exit0、非空两Work/36artifact与授权候选投影200都已真实，保留层级。
- 原个人双项目applicability仍NOT_TESTED；两个fixture Work不能充当完整原项目结论。
- main4cde5883已发布真实模型POST/private save/App，8cd709ca已修launcherEEXISTsource；0模型/native。
- 两组 source 不等于 installed：必要后继同时消费模型GUI与launcherfix，另subject且不追movingmain。
- 只拥有 `tests/product-acceptance/`，E独占required/assertions/oracle和最终独立结论。
- 不改D/main实现或放宽机器FAIL、授权、trustedreview、nativewrite和资源屏障。
- 状态写 `tests/product-acceptance/reports/wave35-status.json`，九成果和每个actualsubject分别记录。

## 工程包一：安全 ownership、完整 report 与原项目日常旅程

本包把已修caller与完整项目语义统一成可用的实际协议，不再只给helper或字符串扫描绿灯。
先做纯控制；安全依赖未齐不跑新的live failure窗口，继续oracle和源消费者的独立工作。

### 成果 E1：从birth到signal/release的完整operation协议

实现范围：把whole-set ownership、fresh effect、unknown保留和材料释放贯穿所有caller及共享API。
actualconsumer：outer/cohort/caller-safety、原stop、mock/model/安装/状态材料与真正failure路径。
- 保留oldfinally和parentdead/noSet已关的正反，不把它们重复计成新的完整成果。
- signal之前必须fresh预验全immutable set，再fresh目标；descriptor字段齐不等于其它child身份当前。
- actualmodule纯控制中validparent+stalechild仍发TERMparent，必须零signal/retain，不能先停再发现。
- release要1:1映射全birth，不能两个实际exitedparent观察凑长度后漏掉livechild。
- 缺UID/start/argv/query/liveness、duplicate/foreign/unknown必须deny，不能只靠另一个reportvalidator严。
- 失败、拒绝、超时和断言结果先进入operation状态，再决定diagnostic材料是否可释放。
- 仅捕获异常的路径已安全；检查actualproducer asserts是否在release之后，避免失败后证据已删。
- 不能新建“cleanup operation”复制旧birth来绕stickyUNKNOWN，也不能global发现或路径认领。
- 实际caller使用显式private root；缺共享root入口先交main约定，不改HOME/借用户目录。
- 合法完整exitedpositive通过，mixedunknown/缺set/parentgone/迟到child/状态失败等actualsource纯控制拒绝。
验收：整operation每个effect和release都有完整当前依据，UNKNOWN整份材料稳定保留。
交接：actualcaller+sharedmodule可重做控制、零误signal/delete与明确资源约定，早交后继续E2/E3。

### 成果 E2：完整 report 的scope、资源和业务语义

实现范围：最终oracle真正消费当前产品主张所需字段，不让producerassert和finalvalidator分家。
actualconsumer：完整真实report、requirements/evaluateRelease、各cohort生命周期/业务validator。
- 所有pre/post按原PID/start/UID/argv/root/config/op一一绑定；empty/duplicate/foreign/missing必须拒绝。
- 保留现已严格的resourceRowsIssues与旧反例修复，不把新sharedrelease缺口混作该修复无效。
- operation_unknown/retained和发布为clean/released的矛盾，必须在完整report而非单helper里拒绝。
- 两Work/pendingQuestion/held effect/allartifact/directreader等新主张需有对应完整validator与独立negative。
- before/after未知保持unknown，查询错误不能catch成空数组或0；actualtable/reader必须正确。
- sameProject原旅程要求每个项目7/30scopedHTTP可读、同原project/窗口，不能只查contextSources.scoped。
- 使用schema-valid完整draft、匹配原executionID再把metrics403变异，最终report必须拒绝目标原因。
- 所有合法narrowedfixture与legacypositive保留，不要求它们满足更强原项目或native主张。
- negative从合法positive单变量派生，避免被缺字段、过期、错schema提前拒而伪称测到目标guard。
- wrongsubject/crossartifact/runtime/producerconsumer来源需精确绑定，不接受“接近”或文档HEAD替实际。
验收：完整report上的错误主张都准确拒绝，真实已有positive与诚实NOT_REACHED仍清楚可用。
交接：原始whole-report正反、字段契约和actualconsumer provenance，不用PASS数替独立证明。

### 成果 E3：两个原项目的可重复 installed 日常开发

实现范围：两个不同原注册项目各自preview/apply/create/check/candidate/人工accept/返回/重开。
actualconsumer：同包公开项目、原表单/command、verification、selected-project观察和Work/artifactreader。
- 每项目真正applicabledraft与完整fields，原ID/root/profile/scope/check不漂移。
- Work/合同/attempt/candidate/接受属于对应项目，不把两次project-atlas执行称两原项目通过。
- 原模式缺消费者时给精确owner依赖和有效positive条件，不以fixture越权、换ID或手写业务补齐。
- 原availableaccept与verification ready先到才接受，保持H合法正向和机器FAIL/受信review权威。
- CandidateRef按完整组合身份读取，不能因没有单一`.id`字段就宣称stalenegative不可表达。
- selected-project7/30各自返回原project和窗口；scope403与open200是不同结果。
- stop/reopen读同原Work/phase/accepted和全部artifactIDs/bytes，不只看消息数或摘要标记。
- 撤回/变化项目配置、scope/criteria变化、unknown原ID重试、staleCandidate、机器FAIL各有准确边界。
- 模型/原生自动发送仍0，受控产品结果不外推native或用户真实编码收益。
验收：同安装的两原项目日常旅程可重复，错项目/未就绪/假scoped读取/假重开不能过finaltier。
本包交source和准确余项后继续包二，原项目外部阻断不停止资源、安装和数据队列。

## 工程包二：一个稳定cohort的安装、非空数据和完整管理操作

保留W33已证明的outer/非空恢复/升级subset，向完整重复使用扩展，不再追movingmain。
本包actualconsumer必须来自选定安装；真实新增runtime准备好才由D冻结必要后继另立subject。

### 成果 E4：当前outer产品与模型设置的真实使用

实现范围：固定W33的首次/已有配置/导入/重复打开/再启，与必要后继新模型保存消费者分层验收。
actualconsumer：真正outerZIP、bundledNode、Start/Stop/Settings或main发布后的认证网页配置入口。
- currentW33outer/recovery已真锁，不重派“先不用tar冒充ZIP”；旧SettingsGUI仍按HELD保留。
- 原ZIP/config未变时不refreeze，不能把未安装的模型POST/App能力重贴旧f880。
- main4cde配置与8cd launcherfix source已发布，必要successor一起验；保存不发送模型任务。
- key/BaseURL私有保存、已允许模型选择、错误状态、替换密钥和并发保存都按实际合同核对。
- 页面/HTTP/错误/日志/支持文件不回显秘密；无旧配置也能明确区分可打开与可开发。
- 原firstStartEEXIST+retry记录保留，8cd源修复不重派；后继验合法并发Start/status/Settings身份不受破坏。
- 测试显式private roots，不借用户默认配置/认证，不通过HOME覆盖隐藏根隔离缺口。
- 错scope/session/origin/body/权限、occupiedport和invalidconfig均应无覆盖、无泄密、保留材料。
验收：包内配置和普通运行是真正用户可用路径，旧包/新source/新安装身份准确分开。
交接：actualUI/API/私有文件/事件和调用次数、冻结entry/hash与完整正反范围。

### 成果 E5：不断增长的非空业务备份与授权恢复

实现范围：同cohort反复使用后，原acceptedWork、待问题Work、history和全部bytes经备份/新根只读保留。
actualconsumer：安装原业务链、backup/verify/restore、冻结直接reader和授权后的公开HTTP。
- 保留E现有两Work、全4交付bytes、26registry、73游标和heldreconcile实际positive。
- 待问题Work停机后历史questions与活跃问题continuation分层，不把phase stopping当恢复执行。
- allartifact不是前三个样本，全部引用bytes和registry事实逐项匹配，具体source/manifest不可拼接。
- publicauthorizedcontent、metadata投影200、unauthorized/wrongtoken、Store直读各有明确scope。
- D新ordinary候选projection200/write422是合法新范围，不能自动认证全部Workanchored正文读取。
- query不可用保持null；不能用错误question_answers表或missingeffect表虚构“答案没变/无queue”。
- 真实pending/effect行在读前后保持，answer/business422、provider不增加和原请求不重发独立记录。
- readonlymarker不授native/private/target权限，路径/主机/principal/source变化消费原review/rebindguard。
- 从合法快照派生missing/tamper/wrongformat/跨subject/expiry/活跃target等必要拒绝。
验收：不断增长的原业务在新根有真实完整身份与bytes，授权范围和原动作状态都准确。
交接：每轮逻辑/字节证据、actualpublic/directconsumer及完整report负例，不仅一个总digest。

### 成果 E6：非空升级、后写入与原回退的独立结果

实现范围：真实baseline业务和升级后新数据经原managedupgrade/binaryrollback继续可用。
actualconsumer：同准确pair的原pa/journal/pointer/health和业务读取，而非Dsummary或当前checkout。
- D已补successfulrawretry/exit0，旧“D仍没有回执”标记需更正，但保留原BLOCKED历史。
- E自己的原升级/回退结果独立为准，baseline/target的source/schema/archive/entry roles精确绑定。
- baseline-origin业务、新增postupgradedata、rollback后数据都由实际版本读取，不能只看文件还在。
- 不用旧snapshot覆盖新写入，不schema降级；数据恢复与二进制回退、A生产迁移分别判断。
- wrongtarget/tamperedentry/不健康/unknownwriter/失败回退等控制必须保留原operation材料。
- 全setpreflight和每个signal fresh，在mixedunknown时绝不能先动validparent再发现stalechild。
- 旧合法成功和新blocked分别记录；后继runtime对旧数据兼容不能借不同cohort结果推定。
验收：完整管理操作的原回执/exit/pointer/data均可独立追溯，成功与held无矛盾。
本包交中期source与同tuple结论后继续第三包，不以某次upgradegreen结束wholegoal。

## 工程包三：同事运行、真实恢复接线与整体独立交付

把准确安装和数据成果放回完整方案B，不让包装或helper数量取代长期产品使用。
外部依赖只阻相关scope，CAC/subteam与新执行协议本轮仍不包含。

### 成果 E7：同事自己的可维护配置与多实例运行

实现范围：真实目标AppleSilicon环境中的普通使用、自己的配置、版本识别和安全失败处理。
actualconsumer：选定安装、显式root、原readiness/status/doctor/support和真正用户导航。
- 不复用作者key/auth/HOME/state，不把相同机器copy冒称跨机/多用户已验。
- 无全局Node打开范围与Git/npm/pnpm项目工具依赖分开，保持许可/平台/未签名现实。
- 原多实例PID/start/root/build/端口隔离和用户返回草稿/工作/会话路径都需实际可重复。
- 信息缺失显示unknown，支持文件白名单/private/nooverwrite，错误不泄漏密钥或正文。
- 声称可维护必须有合法正向与必要升级/目录/权限/缺执行器负向，不能只给一张截图。
- 长期/跨机/签名未测就准确未达，不能为完成goal修改系统策略或借别人的认证。
验收：同事能依据该版本实际状态操作和报告问题，数据/原授权和其它实例不受影响。
交接：准确安装输入、actualflow/可操作support、保留材料和独立兼容边界。

### 成果 E8：原Work恢复与控制消费者的集成验收

实现范围：当main/B/I交出真实consumer后，独立验证原Store/Application/QuestionBroker的同Workcontinuation。
actualconsumer：发布的原attachcallbacks/guard/ingress、原问答/检查/候选/接受与调度slot。
- callbacks source-only不是完整恢复positive，通信module槽位也不是原scheduler资源归还。
- 只用原登记endpoint/producer与freshwriteguard，不缓存旧allowed、不把void成功当新权限。
- unknownsend/noresend、旧epoch/foreignsource/latefact/terminallease要在原业务记录中反映。
- 恢复到同Work/合同/问题/候选/人工接受及原2/4slot归还，不能用新任务代旧任务。
- 这条链所缺owner接口先精确标出，继续cohort/oracle/data/支持队列，不造receipt-onlycoordinator。
- fault仅在完整安全前提后作用于明确自有受控资源，自动真实vendor/model/native仍0。
- recovered/private/target/native各自准入，原readonly历史positive不授执行权。
验收：实际已发布的原业务链正反成立；若尚缺consumer就诚实NOT_REACHED而非helper替证。
交接：原IDs/rows/effect与资源事实、actualsource/packageconsumer及准确scope，发布后继续E9。

### 成果 E9：cohort分层tier与完整工程交接

实现范围：最终主张由准确产品positive和独立完整reportnegative决定，不由summary总计决定。
actualconsumer：完整report/requirements/oracle、immutablepackage/consumerprovenance和最终产品说明。
- legacyR1/currentW33/baselineW32以及futuremodelconfigsuccessor分别列case和范围，不平均或重贴。
- 生产主张每项有实际consumer；缺原项目、恢复、当前native或价值证据不准入更强tier。
- whole-reportmutations必须拒wrongsubject、错fieldbinding、错resource、假scoped200与假data连续性。
- 修复后的合法caller/resource/ZIP/rollback/authorizedread保留，不反复制造同一个“未做”。
- 已证source/controlled/installed/data/native/recovered/value独立，未知不补0、partial不冒complete。
- 每个新安装结论实际绑定entry/filehash；外部新runtime来后按必要subject另测，不追movingmain。
- source早发布后继续其余包和独立队列，给main/D/A/B/C/I/H可重做结果，不只新增PASS数。
验收：九成果共同形成可使用和可判断的完整产品结论，错误材料不能通过更强scope。
晚期交接保留全部原证据、确切余项和下一必要owner输入，wholegoal不在报告发布处停工。

## 安全、预算与完成条件

只有实现+actualconsumer+合法positive+必要独立negative+sourcehandoff齐备，才算对应完整成果。
自动真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5pilot仍BLOCKED。
不reset/top-up/refund/补样/价格研究，不把用户后续主动真实使用算成本轮自动验收。
保留所有state/profile/archive/ledger/history/dirty/runs/五日志和十二5180/8796至5191/8807实例。
所有自有处置需完整birth/PID/start/UID/fullargv/root/config/op/fullset，先全集合fresh再目标fresh。
UNKNOWN整份材料保留；禁止globaldiscovery/forcecleanup/重设HOME/路径认领/借凭据/真实CLI fallback。
不改D/main产品，不新Driver/CAC/桌面/自动接受/第二review/账本/生命周期。
仅提交显式tests/product-acceptance路径到原origin，不upstream/reset，不回滚用户改动。
