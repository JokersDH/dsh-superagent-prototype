# Agent C：可靠历史、完整普通流与准确包恢复三包计划

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`。
仅拥有 `packages/context/`、`packages/proposals/`、`packages/knowledge/`、`packages/routing/`；原 `pnpm-lock.yaml` 差异、全部 runs/旧材料保持。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0080](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)、[0081](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)。
保留改动后同步 `origin/main`，current source/接口以 AGENTS 和 main checkpoint 为准。
A 历史/当前和 F scope/selection 两旧P2真闭，canonical/proof三反例及真实当前两项目source流保持，不重派。
本轮先修新 history wrapper 丢弃 A per-ticket source coverage，再交完整历史/普通/准确包 consumer。
main 本轮接公开 display export 与精确 B 七源/原 native guard consumer；原 Work 恢复尚未准入不能伪造。
`829RC` 冻结 bytes/verdict 不变，新的 R2 source/successor artifact 单独绑定；十外部 Agent A–J 加 main 正常并行。

用户一次下发三个连续完整交付包，建立/延续 whole program goal，无当天 deadline、token预算或时长承诺。
每 outcome 早交可运行 source checkpoint 给 main/A/D/E 后继续其余独立成果，不等用户下一次派发。
C 不新 HTTP/API/SQL/LLM loop、候选表、ledger、grant 或第二确认权威；main/A/B/I/E 保留原 ownership。

## 交付包一：可靠历史与来源审计产品消费者

结果是一个诚实保留原始覆盖边界、可分页、可解释部分/未知来源的真实历史消费者，并能审计决定撤销/替代。
不是让 raw history/currentLink 成为当前批准，也不是新增一组只测数组的 gates。

### C1 上游 per-ticket coverage 与本地上限正确组合

实现范围：

- `wave30-completion-history`/正式后继 consumer 必须组合 A source coverage/limits 与本地 `--limit`，不能只看 slice长度。
- reviews/verifications/acceptances/unclassified 各自保留 complete/truncated/unknown；available 是本地可得还是总源已知明确命名。
- 不以 complete_known 掩盖源cap，history真实性与当前资格继续由 A/原 ProductCompletion 分开。

实际 consumer：

- 当前 main/A/C 正式 reader 与输出工具使用同一 coverage contract，不复制 A SQL或新 canonical 算法。
- main/F 历史视图可以准确说明部分/缺失，C 不直接写其 UI/HTTP或加权限 token。

验收正负：

- 真实完整小history、源51条返回50/truncated、本地limit0/更小上限分别输出准确，原旧positive保持。
- 上游错误/unknown/缺字段不能变完整零值；读取不追加事件/接受/模型工作。

source 交接：

- 交公开coverage类型、实际A reader输入与consumer命令/exit，尽早给main/A接入。
- 发布source后继续C2，不在修一条cap反例后结束包一或whole goal。

### C2 正式历史分页、原事实与来源审计 consumer

实现范围：

- 消费原Work/contract/revision/attempt的review/verification/acceptance、metadata/evidence与冻结source关系。
- 复用A稳定枚举/continuation与主线public cursor，不自己写SQL、另建历史ledger或批准层。
- 原canonical/strict/binding历史校验保持，raw/unclassified与当前可接受性明确分开。

实际 consumer：

- main/C从实际Work进入历史、按revision/attempt查看原事实、返回当前数据，来源和coverage可追溯。
- 现有ProductCompletion.metadata/current/preflight/accept仍唯一authority，历史浏览不移动current或执行指针。

验收正负：

- 多attempt/多候选/多项目非空历史可分页且不丢/重复，epoch改变不抹旧review。
- foreign/cursor错配/旧source/缺artifact/坏receipt准确拒绝或partial，不fallback全项目/完整空历史。

source 交接：

- 交实际consumer/API、原IDs/metadata/coverage、兼容与成本记录，不依赖固定另一个Agent checkout。
- checkpoint后继续撤销/替代审计，不以单纯API可编译代替历史产品。

### C3 决定撤销、supersession 与当前来源语义

实现范围：

- 复用既有record/revoke/supersede/current source领域ports和main真实命令接口，不在C新增HTTP/确认authority。
- 旧记录保留可审计、被替代/撤销准确，原receipt replay不复活predecessor或旧candidate。
- frozen context/body与当前选择/决定状态分开，撤销不是重写历史正文，历史可读不是当前native批准。

实际 consumer：

- current main context/evidence/source审计展示真实原因，F拿准确输入，不由C做替代静态页。
- 原source/principal/Scope/body gate仍唯一，数据导出不含token、无关路径或credential。

验收正负：

- 真实record→supersede→revoke→原receipt重放保持旧状态，当前context不引用已撤销决定。
- accepted/unknown、旧版本、跨项目和不活动predecessor准确处理，无新验证/接受/模型增量。

source 交接：

- 交原IDs/status/命令/exit与实际current-source消费记录，保留普通已过三新source场景。
- 发布后继续包一整合，不以一次revoke测试代替完整来源审计能力。

### C4 历史/部分/来源浏览整链与包一交付

实现范围：

- 将C1–C3组成实际可浏览的历史数据产品consumer：原完成事实、分页/部分、来源、撤销替代与当前关系。
- shared schema/root API/UI由main整合，C早交typed consumer及非空输入，不造第二historyauthority。
- output明确selected read/独立内容/report-only/history/current/unknown，caller不用猜verified含义。

实际 consumer：

- main/F/C真实Work历史与来源视图消费同批原数据，独立调用者能定位原receipt/evidence与状态。
- H/E使用原始材料核对scope，不让C包装器的complete标签替代独立required verdict。

验收正负：

- 一个multi-attempt历史browse流、一个两项目隔离流和一个撤销/部分来源流实际闭合。
- 缺页/源截断/错误映射与合法当前数据区分，strict/build和真正consumer通过，无读触发副作用。

source 交接：

- 发布包一实现、actualconsumer、命令/exit/范围与可搬运例子，记录外部wire未达而不放弃独立工作。
- 完成后直接进入包二，不要求用户重新下发普通两项目流程。

## 交付包二：当前主线完整两项目普通工作

结果是当前原HTTP/UI数据组合下的持续日常流程：模板/对话/问题/检查/接受/来源与观察返回，而不是新demo或模型loop。
自动vendor/model/native预算仍0，controlled/source与真实厂商/native兼容分层。

### C5 当前J模板到原表单/Work的真实数据组合

实现范围：

- 使用main已实现的同serverfields建议→restricted selection→原NewWorkForm预览/应用/编辑/明确创建重验。
- root只由已登记lookup取得，facts/config/catalog/fields摘要是预填观察而非执行token。
- 不信不一致展示、不恢复F本地完整fields构造，不把package scripts/模板文字变trusted check。

实际 consumer：

- main/F原App和Application是真consumer，C交真实项目配置/模板/原Work数据与最小复现，不越owner写UI/API。
- J/F各自公开数据按main准入消费，未知/readonly/缺check/profile保持需要输入/不可用。

验收正负：

- 两个项目的普通模板选择、预览/取消、应用后编辑和原创建字段准确，预览零业务写。
- currentconfig/facts/source/原子/期限变化使旧草稿失效，无自动创建/权限扩大。

source 交接：

- 交真实source/consumer、原preview/command/receipt/字段与观察，无新的授权pipeline。
- source早交后继续问题/检查/交付，不在三个建议行展示完成时停工。

### C6 问题、机器检查、当前候选与明确接受

实现范围：

- 在两个真实controlled项目完成原Broker问题/回答、registered check、currentcandidate和人工accept。
- 原Work/合同/attempt/verification/artifact/接受记录关联，失败检查、修正后新候选和旧版本分别处理。
- 不创建candidate表、手写accepted或用native end_turn/指标/模型score替代可信完成。

实际 consumer：

- main现有问题/证据/接受入口与A完成reader/C来源consumer消费同一原始链。
- ProductCompletion/原应用写前guard继续唯一，C只提供领域数据与正式consumer。

验收正负：

- 正常问答/检查/接受闭合，机器失败和旧candidate/合同/目标不能借普通数据读取获权。
- 同body receipt重放不重复发送/接受/计时，unknown原样保留，不用新Work填掉未知结果。

source 交接：

- 交原IDs/实际次数/check/artifact/currentmetadata和主线consumer记录，controlled/native层清楚。
- checkpoint后继续source expiry与原文审计，不把普通成功宣称live恢复。

### C7 source expiry、context audit 与日常观察返回

实现范围：

- 原message/contextbinding/receipt/frozenbytes与当前Scope/expiry、决定状态、Workcontext准确关联。
- 当前live source不替历史原文，权限问题显示不进入普通上下文，原token不可转给另一native请求。
- readiness/7&30 usage/displayexport按项目/窗口/layer/currency/partial/unknown显示，不反解析格式化数值或估收益。

实际 consumer：

- current main context/evidence/source/观察原HTTP与F日常视图复用真实数据，C不造private SQL/API或平行collector。
- 新main显示导出与原始history/proof导出范围分开，观察不变质量/工时/费用权限证明。

验收正负：

- 正确source审计、expiry/选择变化、缺/坏artifact、revoked/superseded与错误项目准确，原文gate不放宽。
- 晚到/错误/旧后端/partial窗口数据不覆盖新身份/范围，旧有有效内容的保留语义准确。

source 交接：

- 交真实DTO样例、原IDs/digest、窗口与missing边界、main/F实际consumer命令。
- 发布后继续重开/未知整合，不以静态source样例代替完整普通产品流。

### C8 两项目重开、unknown与包二完整交付

实现范围：

- 组合C5–C7，包含回到项目/对话、草稿保持、原工作历史、浏览来源/观察和正常错误恢复。
- post-record未知结果沿同commandId/body重试/reconcile，取消只读不创建，不宣称跨reload exactly-once。
- 原新的currentrevision、撤销/替代和history在持续普通数据中可解释，非空多次操作不串项目。

实际 consumer：

- main/F真实App与currentHTTP为用户入口；C数据consumer支持整条链而非另建测试coordinator或UIdemo。
- 原12用户实例不参与测试，只用明确自有隔离资源；G/H/I/J不接管mainauthority。

验收正负：

- 两项目不同工作/问题/检查/审阅/接受/来源/观察return实际可复现，未知/重复/迟到/错scope准确。
- 模型/native自动调用0，非业务previewPOST与真实业务命令分开计数，副作用来自明确原操作。

source 交接：

- 发布包二整链source/actualconsumer/原始事实/范围，不能用多份孤立PASS拼成未跑全链。
- 直接进入包三准确RC/successor恢复与同事指南，不等下一轮小派工。

## 交付包三：冻结RC与R2 successor的准确包恢复交付

结果是在同一实际artifact完成双格式原数据恢复、manifest/proof/HTTP读取/STOPPED或正确未知保留，并有独立失效与支持指南。
`829RC` 不可变；新R2 source/依赖/consumer必须产生独立准确successor，不重贴旧RC结果。

### C9 锁定不可变RC与准确R2包输入

实现范围：

- 记录829RC与候选successor各自source/tar/hash/build/schema/ABI/mode/entry，保持旧bytes和历史verdict。
- 新main J/window/export/runtime source是否实际在包里通过准确closure与consumer确认，不靠晚报告或静态关键词推断。
- 当前C/A正式proof/history依赖闭包需包内可用或显式公开输入，不能要求同事拥有私有Agentcheckout。

实际 consumer：

- D提供准确不可变artifact，C用现有单driver/公开ports消费，E独立required/installed/browser判断。
- main精确B七源/原guard接入不等于原Work恢复已准入，C不合成live数据证明。

验收正负：

- 正确RC/successor身份可读且分层，错误source/hash/mode/缺closure准确拒绝而不切fixture掩盖失败。
- docs-only更新不重冻，真实运行bytes变化必须新subject后再最终验收。

source 交接：

- 交准确包输入与actualconsumer/依赖范围，旧1fba/1ba/ce64保留原scope而不泛称全部包不可用。
- sourcecheckpoint后继续双格式原manifest恢复，不以打包文件存在当包三完成。

### C10 同一manifest双格式真实restore与包内HTTP

实现范围：

- 同一原Store数据分别默认v1/显式v2的真实snapshot/verify/restore到不同新根，原expectation/inventory/content准确。
- 同一个准确包执行prepare/start/原manifest+targetproof/原HTTPread/readonly/verifiedstop，root只按正式proof映射。
- 原Q/A/native_applied/Work/完成历史/context/evidence来源一致，恢复不继承旧批准/credential或writer静止结论。

实际 consumer：

- 单Cconsumer实际调用A正式数据/proof与包内mainHTTP，source和packagebyte身份各自准确。
- mainbody/current/accept/原nativeguard继续唯一，data/readiness/proof不能授权新target或发送。

验收正负：

- 两根正确数据/coverage/原IDs可读，业务readonly、provider/heldqueue无增，STOPPED或unknown资源事实准确。
- wrongsnapshot/root/subject、消息/业务eventdrift、缺/换artifact和不完整清单独立拒绝，合法narrow只隐藏原文。

source 交接：

- 交准确同package双format数据/proof/命令/exit/原IDs与资源终态，E可独立复现。
- 发布checkpoint后继续故障/原恢复支持，不将旧包与新source拼为一个结果。

### C11 高风险故障与未来原事实恢复支持

实现范围：

- 对实际包consumer的prepare/identity/manifest/proof/start/HTTP/status/stop做相关有界故障、容量与总预算处理。
- 身份/lease/transport/auth/current变化的迟到回调不可进入新主体，unknown保留材料，不按共享路径/端口认领资源。
- 未来B/I原Work回调仅在main准入后复用原A事实/result/完成ports；不新coordinator/ledger/grant，不用normal新Work替recovered。

实际 consumer：

- main/A/H/E按同原IDs/资源事实获得可审计结果，I只通信、B生命周期/dispatch、main批准authority不重叠。
- 支持说明区分包恢复数据、物理静止、livebusiness恢复和native执行，不用一个verified标签认证全部。

验收正负：

- silent/partial/早退/crash/未知停止/过期identity有合法对照和有限退出，每次信号先独立出生全资源proof并fresh重核。
- 原十二实例/其他Agent不动，unknown不删根，旧receipt/结果幂等不重发或重复接受。

source 交接：

- 交可操作fault/consumer与原始材料，准入未到准确NOT_REACHED，短序列不声称长期native稳定。
- checkpoint后继续指南与独立包交付，不把纯helper faultmatrix当整个支持子系统。

### C12 同事指南、完整consumer接口与三包交接

实现范围：

- 提供普通/readonly/双格式恢复/历史/来源/撤销/观察导出/unknown支持的真实指南与正式consumerAPI。
- public类型/版本/coverage/错误/exit语义准确，独立用户不需改内部表、猜路径或复制nativeprofile。
- C不改mainroot/UI/HTTP/A SQL/E断言，真实模块共享调整通过最小可编译调用交main整合。

实际 consumer：

- 同事使用同一artifact和现有入口完成普通流与恢复审阅，main/F界面与C数据consumer一致。
- E独立验同tar及实际用户旅程，H原始材料不替代其required verdict，旧RC与R2分开。

验收正负：

- 三包实际consumer和相关strict/build/有限真实正负通过，partial/unknown/legacy与故障有可执行支持路径。
- liveB/I/private/target/native/value/长期soak未达准确标未达，不填合成结果或以报告DONE结束。

source 交接：

- 写 `packages/context/reports/wave31-status.json`，按三包/十二outcomes记录source/consumer/命令/exit/原scope。
- 显式stage自有路径推原origin，不upstream/reset/清历史；整个三包实际完成才结束wholegoal。

## 独立备选队列

- A/publiccontract未到：先修sourcecoverage传播并交typed实际consumer，继续普通两项目/审计/故障，不复制SQL。
- 新R2包未到：保留829RC及旧准确范围，准备新source闭包/数据，晚能力标未达不借checkout补包。
- B/I原恢复未准入：live层准确未达，历史/普通流/只读restore/指南继续，不造批准或平行ledger。
- vendor/model/native自动调用0；Bcap4UNKNOWN不可花，E原pilotBLOCKED不重置、不退款、不补样。
- 保留十二服务5180–5191/8796–8807与allstate/profile/tar/ledger/dirty，仅独立出生完整proof且fresh资源可受信号。

## 整包完成条件

- 三包是连续完整历史产品、日常两项目、同包恢复支持成果，不是把旧microphases改成十二个名字。
- source早交后持续独立工作，缺外部准入不计wholecomplete，旧A/F/canonical/proof已关范围保持。
- main保留root/API/UI/authority、A唯一迁移、E独占断言；无新Driver/CAC/桌面壳/autoaccept/动态DAG或第二lifecycle。
