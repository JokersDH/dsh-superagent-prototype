# D：三个连续工程包，完整 installed 使用、恢复与可维护交付

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-d`，原分支 `codex/g3-local-distribution`。
先读 AGENTS、START-HERE、product-spec/README 和 [本轮 README](README.zh-CN.md)。
读 [0089 模型配置消费者](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)。
读 [0090 独立验收架构](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)。
读 [0091 连续子系统计划](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
一个 whole goal 覆盖三个连续工程包，每包三个完整产品成果，共九成果。
这是更大的完整发行子系统任务，不是九条小修、临时 ZIP 或反复重建相同字节。
每个成果均交实现、actual consumer、合法正向、必要独立负向与可运行 source handoff。
source 早、中、晚发布后继续后续包与独立队列，不等待用户再次下发或用一次 green 结束。
不设时长、工时、同日 deadline 或 token 承诺；共享依赖只阻相关项。

## 固定输入与已经闭合的范围

- D 输入 `86301c9f`；固定 W33 source `048f0184606202b0b39e7426b7747f3fe57541c1`。
- inner build `f880e5bc9c6c1c57`，tar SHA `ee45c92c7c5a8f2caa0449572b14bf97175b0392f1fd92c6f89d7a19464604e8`。
- outer ZIP SHA `46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9`。
- inner20547728字节/6867项、outer63481603字节/6875项、canonical closure192均保持。
- 新的原始 rollback retry exit0/BINARY_ROLLED_BACK 已补，旧 BLOCKED 原样保留，旧回执冲突已关。
- 重复非空使用已产生两个原 Work、两次接受、36 artifact；两根八个产物引用字节已独立核对。
- 显式 restored review 已有 ordinary unanchored message候选投影200，业务422继续拒绝。
- 上述授权200是准确元数据读取，不等于所有 Work锚定内容或恢复执行许可。
- E325PASS/20NT 现已实际锁 W33 outer/recovery/upgrade，不能继续称它只测 W32。
- E200/201仍包含legacy R1，不能说每个required都已在W33独立执行。
- H合法ready accept与原caller UNKNOWN保留的两个反例已真关，不重派为新缺口。
- 当前包首次并发Start/status的EEXIST与共享工具残余按本轮审计处理，不隐藏原重试。
- main4cde5883已发布F真实模型配置POST/private save/App，8cd709ca已修launcherEEXIST源问题。
- 两组均为已交source、0模型/native；未来必要runtime successor需一起消费，原W33不变。
- 新runtime successor必须另tuple；W33不原地改字节，不追moving main，不因docs/tests refreeze。

只拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`。
main拥有共享契约/config/lock/HTTP/provider/App/transport及唯一bootstrap封装；A独占生产迁移。
E独占产品断言，D不改E gate，不造第二daemon、review、安装器或业务账本。
状态写 `tools/distribution/reports/wave35-status.json`，按九成果、source和actual subject分层。

## 工程包一：同 installed 版本的完整日常开发产品

共同出口是同一版本可反复配置、委托和重开，而非只看到启动网页。
先消费固定W33的已证范围；共享新能力发布后明确源和包边界，不借checkout补旧包。

### 成果 D1：真实模型配置与普通运行生命周期

实现范围：配置未就绪、已有设置、显式保存/切换、重复打开、停止与重开形成一致流程。
actual consumer：原pa生命周期、main模型配置消费者、当前公开配置/readiness和安装工作台。
- 保留私有JSON/权限规则与现有允许模型切换，不把配置存在当网关调用成功。
- 消费main4cde5883已发布的认证POST/private save入口，不另写配置器或复制原key到共享包。
- 保存是用户明确的配置动作，不发送模型任务；错误不回显key或泄漏原私有文件内容。
- 原包缺网页保存时准确说明；source准备好后再选必要后继，不能用新网页连旧冻结后端补证。
- ordinary/discussion-only/fixture/native availability分层，缺执行器明确降级或拒绝，不真实CLI fallback。
- 原version/auth/admission/beforeNativeWrite继续权威，主对话key不授开发许可。
- 核实际保存后读取、同tuple复用、停止/再启；覆盖坏格式、宽权限、错误路径和不支持模型拒绝。
- 首启EEXIST的main8cd源修复已交；保留原失败，在必要后继安装验收，不重复派源修复。
验收：配置状态、实际私有保存、运行身份与用户可见结果一致，无隐式供应商调用。
交接：源码接口、真正入口/entry hash、原始正负结果与旧包兼容范围，早交后继续D2/D3。

### 成果 D2：两个原项目的 installed 日常交付消费者

实现范围：消费main的注册项目/模板/合同/检查/接受能力，让发行版承载真实日常项目工作。
actual consumer：同包公开项目/preview/原NewWorkForm/command/verification/Work与产物入口。
- 两个不同项目分别绑定原ID/root/profile/scope/check，不能统一落到project-atlas后称原项目通过。
- draft/apply仅预填，编辑后明确create；机器检查和人工接受仍走原Application与受信review。
- 等available accept和原verification ready，保持H新正向，不为旧抢跑松任何产品gate。
- selected-project7/30、任务/会话返回和原Work重开都来自对应项目，不以open200代scoped403。
- 读取同一合同/候选/接受/产物bytes；组件生成数据、安装fixture和个人原项目分别标记。
- 缺共享注册/dispatch/applicability消费者时交最小依赖，不能用新ID或fixture越权绕过。
- 必要正向后覆盖配置/范围变化、草稿未应用、未知回执原ID重试、错项目与机器FAIL。
- 自动真实model/native仍0；受控验证与用户后续主动真实使用不混预算或证据层。
验收：真正installed项目消费者可用于日常交付；未提供的原项目模式准确NOT_REACHED。
交接：main/E可重做的完整产品recipe，不以某个preview按钮能点当成果完成。

### 成果 D3：反复打开、多实例隔离与可恢复普通状态

实现范围：已配置的日常实例在多会话、重复打开、明确停止和重开中保持用户状态。
actual consumer：原实例记录/锁、状态/目录、公开readiness、原pa start/status/stop。
- 同tuple合法复用；不同install/build/root/模式/端口明确拒绝，不能抢占旧实例。
- 五roots、账号选择和私有配置稳定，资料不进入outer或另一个用户/版本的data。
- 使用显式private root接口，缺接口先交main约定，不能重设HOME或借真实用户目录完成测试。
- 保持草稿、会话、项目和已交付记录，普通重开不重复创建Work、答案或已完成交付。
- 端口竞争和初次目录创建必须在合法并发边界下稳定，未知不能被重试抹成成功。
- 原status STOPPED exit2、BLOCKED、UNVERIFIED和真实物理停止区分，不强删记录。
- 只关闭该operation已证明自有完整集合，parent退出不证明child、mock或文件资源静止。
- 失败留原记录和整份材料；不能靠清空state或换新根掩盖日常使用问题。
验收：重复使用仍是同一用户产品数据，合法隔离与必要拒绝都可复现。
本包交早期source与实际consumer后进入工程包二，外部E结果未到继续独立队列。

## 工程包二：非空业务的完整数据和恢复生命周期

共同出口是不断增长的原业务在备份、搬根、升级与回退后仍可追溯使用。
既有两Work和回退成功是输入，不把已经真关的缺口重新计作交付数量。

### 成果 D4：持续增长数据的重复备份与完整字节版本

实现范围：从已证的两Work/两accepted/36artifact继续正常使用，保留各版本快照和逻辑来源。
actual consumer：原Product/Application数据、包内backup/verify与artifact registry/正文读取。
- 原Work和接受事件身份保持，新增业务不能直接写summary或把旧ID重建成新事实。
- 备份前记录原source/游标/合同/candidate/问答/接受与全部引用artifact bytes。
- 区分repeat103和后续chat105两个真实快照，不能混manifest/SHA或只手写一个总游标。
- 全量与重复快照均按原bundle协议校验，不新增第二数据仓或私有备份账本。
- key/auth/native session/执行grant和环境缓存不入包，模型配置需用户在目标端重新选择。
- 必要负向包括缺artifact、同长度改字节、错manifest、未来schema、已有输出和活跃target。
- 普通source producer与installed producer分别记录；相关运行bytes相同可证明，但不伪称同层。
- 数据counter不列Work不等于Work丢失；直接合法reader与counter能力各自如实说明。
验收：多次真实使用后的备份可独立对应原业务图和全部bytes，旧快照始终不可变。
交接：参数化非空producer、每个快照tuple与原数据/bytes正负控制，发布后继续恢复链。

### 成果 D5：授权后的搬根只读与历史项目再使用

实现范围：在不继承执行权的前提下恢复历史项目、Work、上下文和交付的实际可读状态。
actual consumer：原restore/review/rebinding、当前授权reader及历史会话/Work/来源/产物。
- 已有显式review后ordinary候选投影200与写422保持，不重复把这项称缺失。
- 向完整原Work/历史来源读取扩展时，明确每个principal/project/message/候选绑定和scope。
- Store直接读取、元数据投影、已授权正文读取和业务写入权必须分层。
- 未审阅、错scope/host/principal/source/marker、过期选择与路径映射变化仍保持拒绝。
- 恢复后业务不执行；已完成动作不重发，真实待处理queue/问题必须有原行和held观察。
- v1/v2 workflow与personal bundle分别消费真实recipe，不重标标签或忽略family绕一致性。
- 目标无原认证/grant/session；readonly可读不授native/private startup或target activation。
- 读取条件未到就交最小共享依赖，继续完整性/格式/路径/产物队列，不自签另一授权。
验收：新根的原身份和允许内容真实可读，未允许或旧执行动作准确不可用。
交接：公开consumer、原始允许/拒绝、实际snapshot/reader/source hash及准确限制。

### 成果 D6：带新增业务的升级、回退与失败保留

实现范围：扩展已补齐的原rollback receipt，让真实baseline数据和升级后新增业务经原管理操作持续可用。
actual consumer：原upgrade/rollback-install/journal/pointer/health、原Work和artifact bytes reader。
- 保留旧BLOCKED与后来的exit0/BINARY_ROLLED_BACK，历史失败和合法成功都不覆盖。
- 新baseline数据由baseline实际消费者产生；复制新版本同schema数据的范围仍明确披露。
- 升级后新增真实业务，再证明binary rollback没有恢复旧快照、降schema或丢新写入。
- 每次成功有原operation/receipt/exit/前后pointer/包身份和数据读取，summary不替原回执。
- A生产迁移、二进制回退与数据恢复是三件事，D不私造migration或回填授权账本。
- wrong target/ABI/health、UNKNOWN writer、copiedrecord和资源不明的失败保持原位安全。
- 不杀外围shell、不做global发现、不跳原stop；未知保留后只通过合法现有和解继续。
- 借E共享信号工具时必须先满足全集合fresh准入，不能用其新signal API绕回退守卫。
验收：新增业务与完整管理操作一同保留，成功可追原回执，拒绝有原材料可诊断。
交中期source后继续第三包；不因一个目标blocked停止所有已授权工程。

## 工程包三：同事可维护的安装、运行和独立交付

共同出口是可由他人在自己的环境维护同一产品版本，而非作者机器上的一次成功。
沿唯一封装与发行事实，不新增Node wrapper/daemon/业务ledger或另一条安装链。

### 成果 D7：同事自己的安全配置与兼容运行

实现范围：Apple Silicon用户用自己的root、配置、工具和认证完成打开、普通操作与诊断。
actual consumer：现有outer/bundledNode、原CLI、main配置入口和明确private roots。
- 保留完整Node/LICENSE/依赖许可与未签名未公证现实，不自动改变组织系统安全策略。
- 空格/中文路径、稳定安装位置、缺项目工具、无全局Node和端口占用给准确行为。
- 打开工作台无需Git/pnpm不等于开发任意项目不需这些工具；真实项目检查依赖写清。
- 不分发构建者key/HOME/native profile/state，配置保存与错误诊断不能泄密。
- 跨机、第二用户、长期、其它平台和签名分别测或未达，不从同机copy推断全部兼容。
- main新配置consumer仅在发布且选入必要runtime successor后才显示为installed能力。
验收：同事可按当前版本说明重复使用并安全处理失败，不借作者目录或凭据。
交接：平台/许可/入口/兼容/权限/安全保留的完整消费者与必要正反材料。

### 成果 D8：唯一发行事实与可操作支持诊断

实现范围：把版本、数据、运行可用性和失败材料汇成可维护的事实链。
actual consumer：canonical manifest/sourceclosure、原doctor/status/support及共享支持消费者。
- source/dirty/runtimecheckpoint/build/inner/outer/hash/bytes/schema/ABI/entry必须准确绑定。
- 当前canonical192、grouped204与历史197/192/209按真实角色生成，不再手写并行数字权威。
- launcher/console/coordinator/storage/portability/依赖闭包一起核，原安装库存不靠当前checkout补缺。
- support0600/新路径/白名单/无秘密，保留错误与unknown，不能把删材料写成已修问题。
- sent/recorded/observed/accepted/process-exited各有实际证据，摘要不推物理静止或收益。
- cross-artifact/陈旧entry/坏hash/外链等负向必须实际拒，合法旧包时间scope保持。
验收：部署和数据问题可从一份准确事实源定位，未知不被包装成0或complete。
交接：main/E可消费的实际接口、规范数据源、必要控制和稳定支持说明。

### 成果 D9：当前cohort独立交付与必要后继管理

实现范围：形成完整产品安装/数据/支持成果交E独立消费，同时管理必要运行后继。
actual consumer：E固定cohort loader/required/oracle、同安装业务recipe和原外层入口。
- W33f880/46e先给准确当前结论，E200/201 mixedbaseR1+W33不重贴成全W33已测。
- main4cde模型GUI/private save与8cd launcherfix是必要未来runtime，另选完整source组合后再freeze。
- 只因实际runtime变化形成successor；docs/tests/报告校正不refreeze，不让E追movingmain。
- 旧cohort所有raw/tar/ZIP/数据/失败保持；后继不可覆盖或重命名旧subject。
- E工具安全和oracle由E修，D不改断言；产品缺口仍须owner提供实现与actual consumer。
- source早发布，稳定后按原build/stage/freeze形成完整输入，随后继续独立工程和联调。
验收：当前与必要后继都有完整可复用输入和准确scope，完整方案B不由一次包装宣告完成。
晚期source/原始证据/具体余项交main/E后继续直到三包九成果实际可消费。

## 独立队列、完成条件与预算边界

每成果都需实现、actual consumer、合法positive、必要独立negative与source handoff。
外部依赖只阻对应项；发精确owner复现/最小约定，继续配置、兼容、数据、support和交付队列。
只交source记SOURCE_READY；没有原项目/安装/数据正向就NOT_REACHED，不用PARTIAL结束可做工程。
自动真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5pilot仍BLOCKED。
不reset/top-up/refund/补样/价格研究，不用用户后续主动调用冒充本轮自动验收。
保留所有state/profile/archive/ledger/history/dirty/runs/五日志和十二5180/8796至5191/8807实例。
仅完整独立birth/PID/start/UID/fullargv/root/config/op/fullset可入自有处置，每signal全set预验且目标fresh。
UNKNOWN保留整份install/state/config/model资料；禁止globaldiscovery/forcecleanup/借凭据/真实CLI fallback。
不新Driver/CAC/subteam/桌面壳/自动接受/writer racing/动态DAG/第二review或生命周期。
只提交显式owned路径到原origin分支，不upstream/reset，不回滚用户或其他Agent改动。
