# G：可直接使用的效率观测模块与只读 CLI

2026-11-14。新工作目录 `/Users/hh/Desktop/joker/superagent-agent-g`，分支 `codex/g4-usage-insights`，由 main 建立后使用；不自行另建嵌套仓库。
先读根 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0064](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)、[0065](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md)。
仅拥有 `packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`。根 workspace/deps/lock 与共享 contracts 由 main 集成，不直接修改。
不写 SQL、不读私有 DB、不改 runtime/HTTP/UI、A 迁移或 E 断言；本包是现有事实的只读分析与采集，不是执行账本、调度器、native admission 或新 benchmark。
本轮 A–H 八个外部 agent 加 main 并行；F 在独立 UI 目录消费 G 的稳定纯类型输出，G 不实现第二套页面或绕过 main 接入前端。

目标是可运行的纯分析 API、只读 collect/analyze/report CLI、稳定 summary 和可追溯报告，帮助用户看到耗时、待办与人工介入在哪里。
基于已有 ExecutionOutcome、ReviewTiming、AttentionPage、WorkEvidence/History 及明确 operator baseline 输入；数据缺失保持 null/unknown，controlled/native/operator 不混层。
主线新 `GET /v1/readiness` 仅是 configuration-only/authorization none；不证明收益、厂商可用或 native 执行。G 不依赖它才开工，指标从已有读取 API 或明确验证文件取得。
建立或沿用整个结果包 goal，不设 token 预算。16 阶段，G4/G8/G12/G16 四个完整可运行结果，发布后继续下一阶段，不交静态文档后停工。

## G1 输入地图与明确测量口径

核对实际共享 schema/已有 read API，列哪些字段能取得、如何限定 project/work/attempt/candidate/time window；字段未暴露就准确记 unavailable。
复用现有 ExecutionOutcome/ReviewTiming/AttentionPage/WorkEvidence 解析与精确身份，不复制一个更宽松的私有 schema；原 source/provenance/layer 一直保留。
定义 G 自有派生 `usage-insights/1` 输入/summary 类型与纯 API，这是只读统计结果，不赋予接受、路由、预算或执行 authority。
协议包含输入来源/摘要/采集时间、观察窗口、时区、记录数量、coverage/limits、metric 单位/样本数/unknown 原因和分层范围。
main 管理任何 workspace/dependency 注册；优先复用现有工具链和标准 Node API，不为初始模块新增重依赖或改 root lock。
验收：完整合法样例、缺数据样例与不可测项目地图可运行；同一结构能供 CLI 和 F 使用，不只输出选型文档。

## G2 验证、去重与 subject 边界

按项目、Work、合同 workId/revision/digest、attempt、profile identity 和候选 generation 绑定记录；禁止只凭相似文本、Work 标题或时间接近来 join。
同一事实/receipt/outcome 重放只统计一次；同 ID 不同 body 报冲突并隔离，跨页重复和跨文件重叠不增加人工次数/usage。
把验证文件当明确输入材料，保存原文件 digest、来源描述和验证范围；文件自写 actual_native 标签不是原生证据，operator baseline 不升级成产品事实。
已知记录范围与缺失字段分开：空完整集合、受限空页、来源缺失和未采集不是同一个状态，不能都解释成没有等待或没有人工介入。
严格验证 finite safe counts、日期/时区、负耗时、倒序区间和异常单位；非法数据拒绝或显式 quarantined，不静默修成 0。
验收：真实共享 schema 下的完整正对照、错 subject/layer、重复/冲突、部分覆盖和非法时间负例，输出可解释且无副作用。

## G3 纯指标 API 与未知值

计算排队耗时只使用同 subject 的真实 queued/dispatch 时间；缺任一端点为 null，不能将 ExecutionOutcome.durationMs 直接改名排队时间。
候选就绪到人工接受优先使用合法 ReviewTiming.readyToAcceptanceMs 与两个时间戳，校对一致性；unknown acceptance 或缺 timing 保留 null。
人工审阅时间使用 activeReviewMs 原 observed UI visibility proxy，保留 partial/unknown/source；不称真实专注时间、人类工时或质量证明。
人工介入用可追溯的独立问题/明确人工回答/接受事实定义计数；没有相关事件时 unavailable，不把所有 assistant 消息、模型建议或 repeated receipt 算人工操作。
usage 只汇总记录中已知 token/cost，未知部分单列；不补查价格、假设订阅免费、把缺 reasoning usage 当 0 或混加不同币种。
验收：纯函数确定性、输入不变、缺数据不零、分母/样本数/分层/单位准确；有界 operator baseline 比较必须标观察性而非节省工时因果证明。

## G4 可运行 CLI 与第一结果

提供只读 `collect`、`analyze`、`report` 或等价明确子命令，至少能从显式输入文件分析并输出 JSON summary 和可读 Markdown/终端报告。
CLI 有 help、schema/参数错误、缺数据和部分完成的明确 exit/状态，支持项目与时间窗口、时区、记录/页/字节/总 deadline 的有限配置。
文件使用结构化 parser，拒绝非法/过大输入；不自动搜索 home credential、仓库 DB、全局日志或其他 agent 的私有数据。
输出是脱敏派生结果，以 0600 独占创建新路径，不覆盖旧报告；stdout 不打印 token、原文、payload、用户路径或其他秘密。
第一完整结果为 G1–G4：纯 API、输入/输出协议、实际 CLI、完整和部分样例均可运行，四者对同一数据给出一致指标。
发布早期 source checkpoint 给 main/F，继续 G5；不能只交算法说明、mock 报表、协议草图或新的 benchmark 计划。

## G5 有界现有 HTTP 采集

实现基于实际已存在 read API 的 adapter：显式 project/work 列表与观察窗口，依真实 availability 采集 outcomes/evidence/attention，不猜不存在的路径。
必须显式 loopback base URL 与 operator 提供 token/凭据文件参数，精确校验 host/protocol/redirect；禁止把 token 发往非 loopback 或跟随外部跳转。
凭据仅内存使用，不记录到报告、错误栈、argv 回显或 provenance；不读取 home 自动发现凭据，不碰任何其他实例/agent 的 credential。
逐请求 timeout/abort 加整体 deadline，限制页数、记录、响应 bytes 和并发；严格解析 signed/opaque cursor，不自己重签或靠 SQL 补全分页。
GET 读取不启动任务、不写设置、不确认候选/原生批准；readiness 可作独立配置快照，不参与收益或 native layer 判定。
验收：实际私有服务的成功、401/403、404/unsupported、坏 schema、外部 redirect、慢响应与重复 cursor 均有界且不泄露 token。

## G6 真实受控事实与同 subject

使用现有真实产品/A/Broker/verification 产生的已授权受控数据，或其明确 verified file，走与用户相同 adapter；不手写 SQL 或造 outcome 当真实原生执行。
至少闭合一条 Work 的实际 evidence/outcome/ReviewTiming 与 attention 读取，原项目/合同/候选和 profile identity 必须精确一致。
原 API 未提供人工事件、排队端点或完整 usage 就标该指标 unavailable/partial，给 main 最小字段事实，不私造新持久 ledger。
将采集来源、准确 source/包身份、时间窗、层、原 evidence refs 和完整/截断边界写入报告，不把另一个包/fixture 的数据混入当前 subject。
保持原回复/接受时序幂等，重复采集重放不会新增计数；仅分析输入副本，不修改来源集合使结果更好看。
验收：已有实际 HTTP 数据与同字节 verified file 分析结果一致，错误 subject/层拒绝，真实缺失指标依然 null。

## G7 baseline 与时间窗口比较

operator baseline 必须显式提供来源、定义、时段、项目/样本、单位和 coverage；手填工时/预期节省都留在 operator_note，不与实测合并为事实。
只比较相同口径/层/单位和可解释的窗口，展示实际样本数、已知/未知数与限制；不能把不同任务复杂度差异包装成 agent 的提升率。
没有 baseline 时正常输出单窗口观察；baseline 不全、0 分母或不可比时输出 null/不适用及原因，不生成 Infinity、100% 节省或虚假成本收益。
区分累计窗口和单次运行，按明确时区展示日期但保留原 UTC/offset；不按机器当前时区静默改分桶。
对观察窗口之外的事实保留来源但不计入该窗，跨窗口同 outcome 不能因多次采集重复计量。
验收：可比正对照、不同层/单位/时区/覆盖、零分母、缺 baseline 和边界日期均产生准确可解释结果。

## G8 同输入完整流程与第二结果

把 HTTP collect、受控事实、verified file、纯 API、CLI analyze/report 连成同一 subject/观察窗流程，保留输入摘要和脱敏输出身份。
验证真实分页/有界 limits 下结果：hasMore、truncated、storage_cap 和 questionCoverage bounded 不得被转换成完整采集。
用户可在本机按明确命令取得一份可读报告，知道等待/介入/usage 哪些有数据、哪些未知；不需要修改 DB 或启动模型。
输出完整成功、有限部分完成与来源不可用的准确状态，不能仅因有 JSON 或 exit0 称指标齐全或价值成立。
第二完整结果为 G5–G8 的真实只读入口与同 subject 全链，不只 mock fixture；actual native 未测仍单列 NOT_TESTED。
发布中期可运行 source 和确切数据流程给 main/F，继续 G9；缺真实 vendor 数据不是停工或申请新预算的理由。

## G9 F 可消费的稳定 summary

给 F/main 纯 export types、稳定 schema 和确定性 summary builder，包含 metricId/value/unit/sampleCount/unknownCount/coverage/layer/limitations/provenance refs 等必要字段。
提供全量、部分、全部 unknown、多个项目、无 baseline、不同币种和来源错误的准确 fixtures，不让 UI 猜 null 的含义或自行算另一套统计。
摘要只携带展示需要的脱敏聚合和有限 drilldown 引用，不内嵌用户原文、私有绝对路径、token、scope 秘钥或任意未验证 HTML。
兼容版本必须明确，新增字段保持既有 consumer 类型可编译；不存在的字段不以默认 0 维持表面兼容。
F 仅在其拥有 UI 路径展示，main 集成 root imports/依赖；G 不编辑 App、HTTP、contracts 或 E required assertions。
验收：同 fixtures 的 CLI/纯 API/F consumer 得到相同数值与状态，strict/exactOptional 和实际 consumer 编译通过。

## G10 可读报告与原证据追溯

可读报告优先呈现项目/观察窗口/覆盖、等待与人工介入、已知 usage 和未知项；密度适合工作，不用大标题声称提升百分比。
每个指标说明采用的原事实、计算口径、样本数和缺失原因，用户能回到明确来源引用；不将 source hash 或 readiness 绿灯当结果质量。
报告按 EvidenceLayer 区分 actual_native/controlled/protocol_fixture/schema/operator_note，不因文件可解析或标签自称 native 就升级证据等级。
不同 currency、profile revision、合同版本和 candidate generation 的数据不能默默合并；跨项目汇总必须保留项目范围和各自覆盖限制。
Markdown/终端内容转义不可信文本，文件名/路径不成为命令，报告不能包含执行指令或用于自动路由/接受的 grant。
验收：真实样例可读、指标可追溯、unknown/partial 显眼且无虚假因果总结，所有输出保持纯观察。

## G11 隐私、输出与错误恢复

对所有输出路径做绝对/明确目标与 exclusive create，0600，拒绝已有文件/symlink/不可信父路径；不得为重跑删除或覆盖旧报告。
采集异常也保持 token/原文/私有路径脱敏，错误只给有限代码/来源引用和可操作状态；私有输入副本不上传外部服务。
批量分析中单个坏 subject 隔离且整体 coverage 反映损失，不吞错变空集；schema 冲突、时间无效和摘要不符不能进入已知指标。
HTTP token 显式传入但不落输出 provenance；不要沿用其他本地实例凭据或读取 `$HOME`/全局配置来自动重试。
对中断/磁盘满/权限不足给明确失败，完成标记在最终安全写入后才产生；临时文件仅清理精确自己创建的资源。
验收：独占创建、已存在/符号链接、无权限、坏输入、脱敏和中断负例有完整成功对照，不操作用户已有报告。

## G12 稳定工具与第三结果

交付稳定 package API、工具命令、输入/output schema、真实 fixtures 与 F/main 集成样例，提供完整/部分/unknown 的最终表现约定。
确认主线 new readiness 仅作配置附录，configuration-only/authority none 不计入任务成功率、收益样本或 native proof。
面向 reviewer 说明每个实测指标的输入条件，不承诺尚未采集的人类时间或模型成本；known total 和 unknown coverage 分列。
第三完整结果为 G9–G12：F 可直接消费的稳定摘要、可读报告、隐私边界和实际 consumer 兼容，不是第二个静态 dashboard/benchmark。
发布第三 runnable checkpoint 后继续 G13；主线 UI 未接入只阻 UI 展示，不阻 CLI 完整可用、数据质量和两项目观察。
验收：跨源/层/窗口错误不会输出假改善，F/main 的实际消费者类型与 fixtures 经过核对。

## G13 两项目真实观察

在 operator 明确给出的两个项目/窗口上用现有只读数据实际采集并生成报告；没有权限或真实数据则精确标部分/未达，不自造原生样本。
至少核对项目隔离、同名 Work/不同 contract、历史/当前候选、重复抓取和缺 usage/ReviewTiming；原始业务数据保持不变。
展示真实等待、候选等待、observed review proxy、人工介入中可测项目，缺端点指标为空，不为了“完整”增加未经授权的采集 writer。
不接新模型、不启动任务填样、不创建实验或模型/native budget，不拿受控样本“证明全公司提升”。
验收：两个项目的来源/subject/coverage 可追溯，合并摘要与项目分报告一致，实际缺失和 NOT_TESTED 诚实保留。

## G14 有界性能与数据上限

以已有契约上限和明确 CLI bounds 做有限输入/响应/分页性能验证，记录运行环境、输入量、耗时/内存和完整/partial 状态。
大集合使用有界处理/去重与明确停止，避免 AttentionPage/WorkEvidence 组合爆内存；未知或重复 cursor 终止，不无限采集。
总 deadline 到达可输出准确部分结果和未采集范围，不能把 limit 截断后的比例当全量总计；不让 baseline 扩大请求范围。
测试异常长字段/大量冲突/多币种/多个窗口，不改共享 schema 上限、不扩根依赖以满足自造 benchmark。
验收：纯分析和 CLI 在声明 bounds 内运行，超过上限拒绝/partial 可解释；短性能检查不称长期稳定性或收益验证。

## G15 使用文档与复现实例

给出实际 collect/analyze/report/help 命令、输入文件格式、loopback/显式凭据方式、项目/时间窗口/时区/limits 与安全输出路径。
写清排队时间、ready-to-acceptance、UI visibility proxy、人工介入和 usage 的区别，列数据条件、unknown/partial 解释与层级限制。
附真实脱敏示例和纯 fixture 示例，说明哪个是 controlled/operator/actual_native，不把演示数据的改善写成测得收益。
异常排查不要求用户删 ledger/DB/队列、重设预算或提供家目录凭据；无新价格/fee/模型/实验 recipe 调研。
验收：独立消费者按文档用显式输入生成可追溯报告；没有 model/native 也完整可用，不只留研究结论或接口草案。

## G16 第四结果与最终交接

写 `reports/usage-insights/wave25-status.json`，列 G1–G16、四个结果、准确源码/输入摘要/consumer/命令/exit/实际值/coverage/限制及未达项。
第四完整结果为 G13–G16 的两项目实际观察、有界性能、完整使用文档和全工具交接；actual_native 未测不冒充节省工时或因果收益。
四个检查点在 4/8/12/16 发布后继续整包，目标是可直接使用模块/CLI；未齐保持 goal 未完成，不用测试数量或静态方案代替结果。
仅显式 owned paths 提交并推 `origin` 的 `codex/g4-usage-insights`，不 upstream、不改其他 agent 源码或 root lock，依赖/导出需求交 main。
vendor/model/native 自动调用为 0；B cap4 UNKNOWN 不可花，E 原 24turn/200000token/USD5/单在途 pilot 仍 BLOCKED，无 reset/top-up/refund/补样。
十二组用户服务及全部 state/profile/tar/ledger/dirty 保留；不新 Driver/CAC/桌面/autoaccept/routing 学习/执行生命周期或观测 SQL writer。

## 独立备选队列

实际 API 暂不暴露一个指标时先完成纯 API/显式 verified file/CLI/协议与 unknown 输出，不查询私有 SQL，不让缺 readiness 阻止开工。
F/main UI 未到继续真实 HTTP 采集、同 subject/coverage、隐私/limits、两项目与文档；稳定 fixtures 和纯 types 先交，根依赖由 main 统一。
没有 operator baseline 或真实 native 数据时输出单窗口观察/NOT_TESTED，完成工具，不扩成新 benchmark、研究协议、价格调查或自动接受项目。
缺权限只标该输入受限，不自动借其他实例 credential 或扩大项目范围；所有等待/HTTP/采集/验证有限，不无限轮询等人。
