# G：可信范围、真实未知值与可使用观测报告

2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-g`、原分支 `codex/g4-usage-insights`，保留历史后同步最新 `origin/main`，记录准确 source。
先读根 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0066](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)、[0067](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)。
仅拥有 `packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`；main 管 root workspace/deps/lock/contracts/HTTP，F 管独立 trial UI，E 管 required assertions。
不 SQL/私有 DB/生产 writer/runtime/UI，不建第二 ledger、统计授权、routing 或自动接受；H 修自己的 preflight/validator 并可做独立合法 consumer/fault，不取得 G 指标权威。

固定起点 `96a9b2678beca2c902a0ccbc410c1aee39fa8f42`，纯核心 33/33、工具 23/23 与 strict 已过；确定性、outcome 去重/层/币种、partial 审阅 proxy、CLI 和独占输出的旧范围保留。
独立复验 3PASS/7FAIL 暴露四类缺口：work/attention 项目与历史事件窗口混入、坏 work 来源变 complete zero、declared limits 不执行、未知长度 HTTP body 整包读后才拒。
默认 UI 完整指标尚未准入，F 正常可无指标运行；不要责怪 main 未接。交付应是可信可使用工具，不再增加一个 benchmark 或统计草案。
建立或沿用 whole-package goal，无 token 预算；16 阶段在 G4/G8/G12/G16 发布四个完整可运行结果，发布后继续后续独立阶段。
readiness 仅 configuration-only/authority none；不证明收益/native/执行权，也不是开始 G 的前置条件，真实数据仍经现有 read API 或明确 verified file。

## G1 所有记录的项目与窗口约束

以准确 project/work/contract/source 映射约束所有记录类，不只过滤 outcomes；WorkEvidence 缺 project 时必须有可验证的原映射，不能凭 workId 猜属于选定项目。
历史 intervention events 按请求窗口过滤 entry.at，保留合同/候选/来源身份；不同版本或窗口不得因同名 Work/时间近而合并。
attention 是明确 current snapshot，遵守 declared projects 与观察时间/新鲜度范围；不能把 foreign project item 混成当前项目 pending 总数。
未映射 foreign work 隔离或记 unknown，不当成已观察的一次问题或完整零；显式文件/项目 override 与 HTTP collector 使用相同规则。
复用独立原完整正对照及四个负例：缩项目后应 1 而非 2 问题、09:30 窗前旧问答不计、未映射 foreign work 不计、foreign attention 不计。
验收：实际 analyze/CLI/collector 同 subject 源都执行这些约束，保留原 outcome 精确身份/去重和层/币种语义，不只测试新数字 helper。

## G2 坏来源、quarantine 与真实零

把 invalid/conflicted/missing work/attention/outcome 的损失传播到正确 source 和 per-metric coverage/unknown，不只降 outcomes badge。
workEvidence=[{}] 不再变 value0/sample0/unknown0/complete；全被拒与混合合法/坏来源分别保留未知数、排除数和可追溯原因。
只有正面证明完整枚举且真空集合时才可测得零；未采集、不可用、项目无法归属、截断和 rejection 后空集不能互相替代。
未知 cost/usage/ReviewTiming/人工事件保持 null 或已知部分加明确 unknown；不因少样本、缺 endpoint 或一条数据失效而补 0。
F summary/Markdown/终端和 exit 状态从同一事实派生，行级 complete 不能掩盖该来源的 quarantine；保留 partial UI 审阅 proxy 而非人类工时。
验收：独立坏 work complete-zero 反例和完整空集正对照同时通过，混合/冲突/来源缺失覆盖与指标一致。

## G3 声明 limits 的实际执行

maxRecords/maxWorks/maxPages/bytes 在昂贵解析/聚合前执行或拒绝，不能在全部分析完后只写 stoppedBy；全量 schema hard caps 与 caller limits 分开。
若允许确定性部分处理，准确标该 source/metric partial、已见/接受/未采数、停止原因与观测范围，不把超限结果声明完整。
独立 maxRecords1 反例不再 accepted2/complete；exact bound 完整枚举时也不要只因 count>=bound 就误称发生截断。
CLI 从文件读取先验证受支持大小/类型，限制 bytes 后才构造 JSON；不先完整读超大文件再检查，不利用 root 私有 DB 补全。
保留 explicit project/window、finite safe counts、opaque cursor、unknown/dedup 和原 immutable source digest，limits 不改变原数据或身份。
验收：正常刚好边界、超限、组合 records/works/pages、大小与非法值的实际 API/CLI 行为有界，失败不会返回假完整 summary。

## G4 流式预算与第一完整结果

HTTP body 按 stream 累计剩余预算，在全量分配前 abort/cancel；无/错误 Content-Length、慢流、错误状态和 redirect 的 body 也有限处理。
复现 maxBytes1024 的未知长度131072响应反例，观察停止/已接字节/错误而非仅最后抛 limits；保留小合法 JSON 正对照。
保持显式 loopback origin/token、拒跨 origin redirect、每请求 timeout 与总 deadline；token 只在内存，不读 home/其他实例 credential。
G1–G4 作为一条真实输入→采集→分析→summary/CLI 流程通过四类七个独立负例和完整 positives，不把小工具单项修复称完整结果。
保留核心33/工具23已验范围，新增必要回归；输入/响应错误不写产品状态，partial/unavailable 精确反映缺失，不覆盖旧输出。
第一完整 runnable source checkpoint 发布后继续 G5–G8，whole goal 未完成；四类失败未关前默认 UI 完整数仍不可用。

## G5 两项目真实受控数据输入

使用现有真实 Product/Application/Broker/verifier 生成的一条隔离受控数据或 A/main/H 的明确原输入；不手写 SQL 或造 accepted 数字当原始事件。
collector 本身仍 GET-only；受控数据生成仅使用现有公开调用的自有测试装置，明确标 controlled，不借用户实例运行或调用真实 vendor。
两项目含同名 Work、不同合同/attempt/profile 和历史/当前候选，保留原 project/work/contract 映射、evidence refs、source/包身份。
接受 source 时验证所有 public schema 与 requested identity，signed cursor 不自签，权限/数据不足记 unavailable/partial 不猜别的 endpoint 或凭据。
readiness 可作为配置附录，不参与样本、native layer、收益或完整性证明；G 不等它或新模型才实施真实读取。
验收：实际同一 HTTP adapter 按显式 scope 取得两项目数据，无产品事件/模型/native 增量，原输入在采集分析后字节不变。

## G6 真问答、接受与 ReviewTiming

消费原真实 Broker question/answer/native_applied 和 verifier/candidate/明确人工 acceptance 的同链读取，subject 不同的问答/接受不得拼入选定 attempt。
排队时间只用真实 queued/dispatched 端点；当前 API 未提供时保持 null，不把 duration、attention age 或所有等待都改名 queue wait。
候选等待采用合法 ready/accepted pair；observed activeReviewMs 保持 UI visibility proxy/partial/unknown，不能称真实人类专注工时。
真实可用 timing 来自现有 UI/生产记录；缺数据保留 null，可用合规 fixture 证明算法但不能给真实记录补写 timing。
usage 使用 recorded known token/cost 和未知成分，不查价格、不把订阅/缺 reasoning 视作 0；不同币种和层始终分行。
验收：同原 subject 的问答/接受/timing 正对照与错来源/缺失/partial usage 负例，指标能追溯真实 evidence，而不是凭 schema 自称 native。

## G7 HTTP 与文件的同源复现

把实际 HTTP 收集的原 bundle 安全写入显式新 0600 文件，再通过 verify/analyze/report 重读；相同字节/窗口得到相同 summary。
来源声明、自写 layer 或文件可解析不成为 native proof；保留 producer 层与 verified 范围，operator baseline 始终独立 operator_note。
篡改 body/digest、project/window override、跨文件重叠、重复 receipt 与冲突身份各有独立控制，不能绕过 G1 范围和 G2 coverage。
文件输出 exclusive create、无秘密，既有 bundle/report 不能覆盖；中断/磁盘满/无权限不得留下假完成标记或删掉旧证据。
自有 API 输入和 CLI 输入一致执行 limits/unknown/quarantine，不因一个走 dist、一个走源码而消费不同旧版本，记录实际 consumer/build。
验收：同源可重复完整链与 changed-file/ref/subject refusals 通过，保留准确 source、输入 digest 和层，不扩大为 release authority。

## G8 第二结果：真实观察流程

将 G5–G7 组成同一两项目受控数据链：实际 public read→有界 collect→verified file→pure API/CLI→可读 report，原问答/接受/timing/usage 同 subject。
准确列每指标哪些真实可得、哪些 fixture-only/unknown，缺 actual native 或 operator production credential 不阻工具交付，也不写成已测收益。
观察窗与 current attention 分开，跨项目汇总保留原项目/层/币种/coverage；项目/窗过滤和坏来源反例在完整流程仍成立。
发生 source_missing/caller_limit/storage_cap 时输出真实 partial/insufficient，而不是仅有 JSON/exit0 就宣称完整采集或日常效率提升。
第二完整可运行结果要求消费者按文档可在私有服务复现该链，不能只交两个孤立项目 fixtures。
发布 G8 checkpoint 给 main/F，继续 G9；主线未上 UI 只阻展示，不阻采集/分析/报告与稳定 types。

## G9 F 可消费的可信 summary

稳定纯 export types/schema/fixtures，保留 status、window/project、metric/unit/value、sample/unknown、coverage/layer/currency、provenance/限制和版本。
toInsightConsumerView 不再把隔离失败的错误数包装为 ready；合法部分观测可以展示但必须说明 partial，unknown 明确可见。
每项行与整体覆盖一致，来源 rejected 不能经“样本0”补成已测零；readiness/configured/authoritynone 仍不参与收益/native 判断。
F 仅呈现可信 summary，main 决定输入/API/root integration；G 不改 trial UI、App 或 transport，不让 F 自行再写过滤器修正 G 的数据。
给完整/部分/全未知/缺来源/错项目/错窗口/多币种/不同层 fixtures，保持真实 shared contracts 和 strict/exactOptional consumer 兼容。
验收：CLI/纯 API/F consumer 对相同原数据含义一致，未经准入输入不展示错误 complete badge，旧 null 语义不变。

## G10 可读报告与隐私边界

报告首先给真实项目/窗口/覆盖与样本、已知和未知的指标；不使用少样本节省工时、质量/审批效率提升等因果表述。
每个数字保留原 fact/subject 来源引用和计算口径，跨项目/层/币种不可默默相加；current attention 不冒充历史工作负载。
脱敏输出不含原 prompt/payload、用户私有绝对路径、token、key 或栈；不可信文字转义为文本，不生成任意 HTML/链接/执行指令。
operator baseline/注释单独展示来源与可比性限制，无 baseline、零分母、不同窗口/任务/单位或 coverage 时不生成伪百分比。
报告 rows/limitations/diagnostics 有限，若 drilldown 被截断标清范围；匿名摘要/截图不当成原生结果或 E 发布通过。
验收：真实完整/部分/unknown 报告可读，秘密和不可信文本负例不外泄，所有数可追溯到准确 source 与有限范围。

## G11 CLI 输出与失败可用性

collect/analyze/report/verify/help 的参数、路径、窗口/时区/limit 和退出状态统一，不依赖隐式 home 配置、环境 key 或私有 DB。
成功/partial/insufficient/source-integrity failure/invalid input 分开；错误不吞成空数据，便于用户知道下一步是补范围、换合法输入还是等待来源。
保持新文件 0600/exclusive/不覆盖，拒绝现存/symlink/不可信输出目标；写入中断只清理本次独立创建的临时文件。
auth 失败或 redirect 不换其他实例 credential 重试；body/error/慢流和磁盘问题都有限，不打印 header/token/raw正文来诊断。
新 source/build 消费路径与 runtime package exports 一致，避免 CLI 默认捡旧 dist 而测试最新 src；依赖/lock importer 需求交 main。
验收：新用户可按一组实际命令取得准确报告或解释清楚的拒绝，输入/旧输出保持不变，所有 request/analysis 等待有界。

## G12 第三结果：稳定摘要与报告交接

交 main/F 稳定 package API、types/schema、真实同源样例、隐私报告、工具调用与有限正负数据；不只提供结构兼容声明。
明确 G 的完整指标获准 scope 与尚未可得字段，F 默认展示由 main 据实际准入决定，不能自行要求 UI 忽略未修数据。
真实来源、typed consumer、partial/unknown、报告与 CLI 对同一数据给出一致结果；没有 actual native/真实 baseline 也能完整交工具。
第三完整结果为 G9–G12 的可信 F consumer、隐私报告和可用 CLI，不是新增静态 dashboard、benchmark 或统计 authority。
发布 G12 checkpoint 后继续 G13–G16；F/main 尚未展示时可在其实际类型/fixture 下先验证消费者并准确记 UI 未达。
验收：任一 scope/coverage/integrity 失败不产生默认 complete 数，依赖路径/版本清楚，main 无须猜未声明的字段语义。

## G13 CLI 日常工作流

把两项目日常采集、重复观察、明确时间窗口和报告历史形成实际操作范例，重复运行不覆盖旧结果或双算上轮 receipt。
支持明确 operator baseline 的可比观察，未提供时单窗工具正常；不把样本多一点当收益已经成立，记录真实适用条件。
观察窗跨日/时区、旧项目/当前项目、同名 Work、空但完整和缺来源的差异可理解，不让用户靠读代码判断状态。
所有读取仍显式 loopback/凭据/项目，不能为了便利扩大到所有实例、发现 home key 或触发模型填样。
验收：一个完整工作流能在私有已授权数据上连续运行并回看准确历史，失败和部分范围的下一步明确且不破坏原数据。

## G14 有界性能与故障回归

按实际 schema 和声明 limits 测有限大集合/多层/多币种/冲突输入，记录环境、输入规模、耗时/内存和每项 cap 的实际触发点。
流式采集覆盖无/错 Content-Length、慢流、非2xx大 body、重复 cursor 与截止时间；不能为了测性能把 limits 临时放开或无限 soak。
大输入在昂贵分配前拒绝/部分处理，quarantine/detail 数有界，source/window/project 不因处理压力而放宽。
只重跑受影响风险与原33/23的必要组合，避免机械凑数量；短观察不称跨机器/长期稳定性保证。
验收：有限场景与完整正常对照，cap/timeout/unknown 都产生可解释结果，不泄露秘密、不污染 source 和已有报告。

## G15 当前文档与包内接口

更新 package/tools/reports README 的真实命令、输入/输出协议、指标定义、window/attention区别、unknown/partial 和 source/layer/币种边界。
给 main/D 精确 runtime exports/build/dependency/CLI 文件清单；root deps/lock/main frozen 包/E final 仍分别由对应 owner 完成。
新运行字节要被相应包包含才称 installed 支持；旧 source/fixture/native scopes 保留，不能将 checkout 通过贴给旧 tar。
source/operator 数据声明不等于 native proof，报告不授预算、质量、路由或接受权；无新 fee/价格/模型/实验 recipe 研究。
验收：独立消费者从显式合法输入复现可信报告，故障排查不要求删 DB/ledger/队列、重置预算或交出家目录凭据。

## G16 第四结果与正式 scope

写 `reports/usage-insights/wave26-status.json`，列 G1–G16、四个结果、固定 source/consumer/输入摘要/原 subject/命令/exit/实际值与限制。
第四结果包括 CLI 日常可用、有界性能/完整故障回归、正式文档与 package handoff；不能以33/23或新增测试数替完整 scope。
4/8/12/16 检查点提交后继续 whole goal，外部真实数据未到时准确保留对应未达/unknown，不自动生成 native 样本或终止整包。
显式 owned paths 推 `origin` 的 `codex/g4-usage-insights`，不 upstream/reset/改 root lock、main/F UI、A SQL、B runtime 或 E 断言。
真实 vendor/model/native 0，B cap4 UNKNOWN 不可花，E 原 24turn/200000token/USD5/单在途 pilot BLOCKED，无 reset/top-up/refund/补样。
十二用户实例及全部 state/tar/profile/ledger/dirty 保留；不新 Driver/CAC/桌面/autoaccept/routing学习/第二 ledger 或执行生命周期。

## 独立备选队列

缺一个生产字段先完成 G1–G4 的实际 API/CLI/流式边界与 null/partial，再用已有 public DTO/明确 verified file 推进，不查私有 SQL。
F/main 未挂真实指标时交可信 types/fixtures 和准确最小需求，继续两项目/隐私/CLI/性能/文档，不责怪主线未展示未准入数据。
没有 operator baseline/actual native/原 ReviewTiming 时如实未知或 NOT_TESTED，不把受控 fixture、readiness 绿灯或少量样本冒充收益。
H 可在其独立路径提供原 source/consumer/fault 观测，G 消费数据不取得 authority；全部验证/等待有限，不无限轮询或跨 owner 修源码。
