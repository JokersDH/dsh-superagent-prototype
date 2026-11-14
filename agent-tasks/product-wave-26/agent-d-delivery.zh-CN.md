# D：完整试用工作台与真实原目标恢复发行长包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。
保留历史并合并最新origin/main，读实际AGENTS、START-HERE、product-spec/README与[本轮README](README.zh-CN.md)。
读[0066主线试用工作台](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)和[0067完整产品包](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)。
建立或沿用整包goal，不设token预算；D4/D8/D12/D16四个完整可运行结果，提交后继续独立阶段。
只拥有launcher/portability/distribution；状态写 `tools/distribution/reports/wave26-status.json`。
main拥有根配置/锁/契约/HTTP/UI和授权，A拥有迁移，E拥有独立required；八个外部A–H加main不互改拥有路径。

本轮逐次TERM/KILL fresh、childconfig/argv、mixedunknown旧负例已独立通过，不再补派旧修。
准确a826包6754项、closure87/87通过；E仍只认证3b普通scope，不能贴到a826或本轮F App。
main正在真实集成F到App并接四个callback/readiness，G默认指标暂不接；本包以实际source checkpoint为准。
原分支/dirty、所有state/profile/tar/ledger、历史范围和失败全部保留，不重开项目或清旧材料。
每个检查点交source、有限命令/exit、准确tuple/consumer/data、完整positive/negative与剩余缺口。
普通工作台和安装独立于B恢复/private/target/BLOCKED试点；不得因此停掉可独立工作。
四个检查点是交接时刻，不是goal结束；未达项持续推进，外部依赖只阻对应阶段。
本轮重点是原目标真实数据及完整可试用包，不用更多旧测试计数代替端到端结果。

## D1 固定当前产品输入与范围

固定D HEAD、a826不可变tuple和main本轮实际F App/readiness源码，注明F/G/H各自是否真的被集成。
比较launcher/portability/build/stage与main已有字节，不重新导入旧runtime或用旧报告说入口缺失。
保留已关安全控制，只有新代码触及资源边界才针对新增风险补有限检查。
准确列source与tar时间差、E认证到哪个包、哪个结果尚未到，不把标签当版本事实。
验收输入表可被E/H直接使用，主线不等E最终结论才提供源码。

## D2 完整F App与四个导航callback闭包

消费0066实际发布的App组合，确认F TrialWorkspace在真实首屏/selector路径可到达，而非只存在导出模块。
核四个callback导航到主对话、项目、待办或证据等实际既有目标，以main接口命名为准。
不得在D修改UI/导航实现，不把导航callback当自动执行命令或模型调用。
console静态资源、transport、HTTP、contracts和readiness必须属于同一准确source。
验收源码/构建产物完整；旧a826缺本轮F App只是时间scope，不强称回归。

## D3 readiness与准确发行依赖

用实际GET /v1/readiness和公共schema读取讨论/读取/执行未就绪/readonly/unknown事实，不派生新授权。
完整closure记录launcher、portability、coordinator、console与必要外部依赖，不靠当前checkout补包内缺项。
缺执行器时普通个人工作台仍按原产品规则启动，不能隐式换fixture或读取旧native profile。
根配置/锁/公共API需求交main处理，G默认指标未准入时包中不得宣称已提供完整指标。
验收新source的build/stage与manifest、自校验和实际组件/接口字节一致。

## D4 第一里程碑：可运行完整工作台候选

交含真实F App/四callback/readiness的clean构建和准确候选目录，以及完整source/dependency清单。
命令帮助、status/doctor在独立根有限验证，不对旧用户实例启动/停止或迁移。
给E/F/H最短可运行流程、显式输入、准确未达范围，不只交静态marker或截图。
第一结果必须让其他Agent能实际打开完整工作台；源码未到只阻该项并转独立队列。
发布检查点后继续D5–D16，不等下一轮才开展原目标和恢复组合。

## D5 A/C原目标与fingerprint真实绑定

使用A完整producer/expectation及C实际manifest consumer，记录原Store、subject、source、manifest digest与原target映射。
不能以全manifest原样echo代替消费；C需要根据原目标字段验证实际读取对象和预期身份。
原binding/attempt/contract/question/answer/native_applied及SDK候选使用真实字段，不用任意第一条或近似名称。
producer源码身份必须可追溯，不再把a*40占位SHA称实际来源；声明和执行的entry/hash一致。
验收改一个fingerprint、target关联或coverage时，在错误数据被采信前准确拒绝。

## D6 两format链分别进入同包consumer

同一次源实际create/verify默认workflow1与显式2，各经独立材料/包consumer到两个不同新目标根。
使用A稳定备份/reader输入，不删WAL/SHM来伪造静止；原数据只读且目标不复制旧执行授权。
每根分别断言原Q/A/native_applied、answer digest、attempt、Work和候选的实际关联与原fingerprint。
C唯一驱动读取A期望并验证该根，不能把一条单根流程或一次DBSHA等价重贴两遍。
验收同包prepare/start及未选择403→选择后history/candidate/source200，业务422、queueheld、provider不增。

## D7 原target漂移与用户只读边界

独立合法positive后，覆盖target换根、fingerprint变更、源失效、Scope收缩/排除与旧receipt的实际拒绝。
新UI显示与body/Scope/receipt守卫一致，诊断失败不泄正文，readiness只是观察事实。
same-file REUSED绑定原PID/start/health，不同/缺失选择、端口和登录拒绝且不改旧实例。
保留原队列和UNKNOWN资源，不以清marker/force switch/空DB或旧回答获得执行许可。
验收每个负例明确归因，不用已坏签名重复证明另一个原因。

## D8 第二里程碑：真实原目标双恢复整链

交同一次A→C→两个snapshot目标→同包UI/读取的完整可运行recipe与实际断言。
记录producer、data subject、C consumer、package/runtime及两目标身份，field/fingerprint对应明确。
缺真实port时给最小需求并准确NOT_REACHED，不能再用opaque echo称全链完成。
第二结果覆盖合法整链和独立漂移负例，历史部分通过保留不重贴。
发布后继续准确冻结、普通安装和交付，不等待B/native/private/target。

## D9 冻结必要新包并早交E

本轮F App/readiness等运行字节变化后，用实际clean source冻结一次必要后继。
记录source/build/tarSHA/bytes/schema/platform/ABI/Node/SQLite和完整file/link闭包，含真实console/API。
准确a826和旧3b/0ede/a9b/595全部保留；docs-only不反复冻结，不覆盖旧tar或重标E结果。
运行字节先freeze再E最终验；给E已经存在的新包，不让它长期只测旧3b。
验收tar重读tuple/hash与交接一致，开发driver和产品consumer身份分开绑定。

## D10 普通冷装、无执行器和多state

在全新private根运行有限cold/reuse/no-executor/multi-state，明确个人/fixture/恢复readonly模式。
无执行器不读取个人native profile、不回退真实CLI或fixture；工作台可用与执行未就绪准确展示。
不同根/配置/端口/登录不静默复用，所有真实资源出生和每次signal前完整fresh规则继续保持。
未知归属或停止不明保留材料，用户十二实例从不作为测试/清理对象。
验收准确新包内实际用户入口可用，未测平台/ABI不标兼容。

## D11 升级、回滚与新数据保护

用安全已测baseline→候选及16→18，核actualexit/status/pointer/operation/data及完整资源集合。
保留升级后新增数据，不拿旧快照覆盖它以制造rollback通过；UNKNOWN live资源阻断切换。
只做必要新窗口与完整positive，旧危险97路径仍mock，不无限扩历史矩阵。
新运行字节有后继身份；报告/指南修补不触发机械重冻或重复全部测试。
验收每项结果贯穿同一candidate tuple与实际consumer，两个start不冒充managed升级。

## D12 第三里程碑：同包普通安装交付

交新包冷装/无执行器/多state/升级结果、准确缺口及E可独立运行的最短命令。
E独立required，D自测不授release；F用户反馈、G分析和H样本都是原始输入。
给H只读preflight/status/doctor/readiness/support的准确recipe，H不接管D生命周期。
第三结果应是同事可实际安装与理解限制的候选，不只交目录路径。
发布后继续重开、支持材料与最终源码/文档收口。

## D13 重开与有限可用性

同包prepare/start/reuse/拒绝/stop后重新prepare/reopen，原数据可读且完成请求不重发。
有限SSE、刷新和并发只读核provider、queue、连接/FD与子资源归还，不称长期soak。
UI/readiness状态与真实后端一致；导航动作不自动启动任务或模型。
失败有有限deadline和准确材料，终态/exit矛盾不得靠等待抹掉。
验收原Store和两个恢复根不串身份，未授权执行始终不执行。

## D14 support与同事指南

support私有0600、脱敏、拒绝覆盖，不包含token、model key、native credential或旧可执行授权。
提供包选择/准备/启动/查看试用工作台/审阅/重开/报错的最短用户步骤。
H工具REFUSED或未核资源时不能执行包命令或signal；不能因为帮助试用而绕过其新门槛。
记录产品/fixture与时间scope，源码文档和CLI帮助一致，不让内部模块名成为用户操作前提。
验收支持材料可复现问题，用户state/home和历史profile不被访问或清理。

## D15 来源与最终包一致性复核

比对最终source、tar、实际console/API、四callback、readiness和两恢复根的consumer hashes。
F/G若又产生必要运行变化，按实际main checkpoint冻结后继；G默认不接时保持明确未集成。
E发现产品问题只修D拥有路径，跨owner给准确复现，不修改E断言或根锁。
H原始观察只在相同subject且方法适用时引用，既有600/1800fixture不贴产品包稳定性。
验收所有文档、状态和原始结果适用范围一致，缺项保留真实未达。

## D16 第四里程碑：完整试用发行包

交含真实F App/readiness的新包、原target双恢复整链、普通安装升级重开/support与完备指南。
更新wave26-status、四source检查点、有限命令/exit与待修清单；wholegoal未达继续独立队列。
只拥有路径推原origin分支，不upstream、不清dirty，不以提交checkpoint代替完成整个结果。
vendor/model/native0；Bcap4 UNKNOWN不可花，Epilot24turn/200000token/USD5/oneflightBLOCKED，不reset/refund/补样。
十二组5180/8796至5191/8807及全部state/profile/tar/ledger保留，无新Driver/CAC/desktop/autoaccept。

## 独立备选队列

本轮mainF App source未到：先a826准确包交E、原target/fingerprint和同包双恢复，不猜主线实现。
A/C整链未到：准确发行、无执行器/多state、升级/重开/support继续，不造第二manifest权威。
E/H/B/private/target未到：普通安装和指南继续，原数据/UNKNOWN/账本保留，执行授权不扩大。
