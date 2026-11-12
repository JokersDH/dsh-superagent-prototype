# 从这里开始：仓库、代码位置和并行开发

**上下文历史与原始正文已可用：[http://127.0.0.1:5189/](http://127.0.0.1:5189/)。** main e97e65a/eea5fa2接通真实A18历史、签名分页、原bundle正文、消息来源审阅、跨会话筛选与返回原会话。A7a8e099的work一致性修复已按路径接入，恢复源扫描仍单列。505项非浏览器及8+9项网页场景通过，三项界面审阅修正均resolved。新5189/8805是独立personal state；原九组服务/历史不迁移、不重启，自动真实模型/native0。[实际范围](reports/releases/wave12-context/README.zh-CN.md)与[读取接口](docs/rfcs/WP-16/0038-context-history-and-frozen-source-reader.md)。A–E继续既定第十二轮十阶段整包，无需重新派工。

**当前派工：[第十二轮产品交付长包](agent-tasks/product-wave-12/README.zh-CN.md)。** A修逻辑快照/历史三反例并收口持久数据；B做真实生产控制/独立进程恢复；C做来源检索到候选完整数据链；D先关所有权P1再交当前安装；E改为动态真实字节验收。每人十阶段，三次checkpoint后继续，见[五段转发话术](agent-tasks/product-wave-12/forward-prompts.zh-CN.md)和[0037独立验收](docs/rfcs/WP-16/0037-wave-12-admission-and-product-delivery.md)。

**实际持久回复已接入main530085c/schema18。** 原HTTP测试已换真实A结果表；新增四个真实产品进程SIGKILL/损坏用例证明原结果只补一次、unknown不重发，主线本轮288项回归及9项真实A18网页复跑通过。A新source/history及B/C/D剩余阻断没有被整包放行。D新schema16 tar确含context-use，E旧schema15结论不能代表它；下一当前安装要用新schema18准确字节。原九组服务未更新，5188仍4140cac/schema16，真实模型/native0。[代码/测试范围](reports/releases/wave12-integration/README.zh-CN.md)。

**第十一轮主线真实消费者已交：[0036完成回复与配置固定](docs/rfcs/WP-16/0036-completed-reply-consumer-checkpoint.md)。** 源码31ddd26保存真实返回的回复artifact/result后再发布消息，原effect重试可核对补齐而不再发模型；SDK本次model/config固定，切换配置不误绑。71项主线回归及strict通过。A生产replyResults尚待实现接入，目前结果port测试是明确fixture，不宣称持久恢复准入；原5188运行预览/九组服务未更新。A/E继续本轮整包，直接消费该入口。

**当前派工：[第十一轮十阶段长任务整包](agent-tasks/product-wave-11/README.zh-CN.md)。** A做源逻辑快照/历史/完成回复数据，B做实际持久控制，C做可靠来源检索与候选数据，D做多实例隔离和当前源码个人安装，E做当前用户流程/真实安装独立验收。每人十阶段、三个稳定检查点和独立备选队列，检查点后继续。新验收确认D通用stop跨state的P1；B四项新helper/C九条新模块反例未闭合，现用main能力保留。共享接口98a50ca已交，模型/native0、九组实例/账本保留。见[0035](docs/rfcs/WP-16/0035-wave-11-admission-and-long-run-packages.md)和[分别转发文本](agent-tasks/product-wave-11/forward-prompts.zh-CN.md)。

**所选上下文可以用于对话：[http://127.0.0.1:5188/](http://127.0.0.1:5188/)。** 产品源码4140cac：草稿→上下文预览→预览消息→明确发送→原流式回复与逐消息来源审计，已接A schema16真实持久化。clean source网页9/9及新后端95/95通过，模型为mock；新个人预览复用已有私有配置，原八组实例和历史保留。D真实材料与main/A空目标组合7/7通过，仍不授恢复启动权；恢复激活/当前安装包分层推进。实际接口/证据见[0034](docs/rfcs/WP-16/0034-context-use-and-target-preparation.md)与[新版指南](docs/ASSISTANT-GUIDE.zh-CN.md)。

**当前派工：[第十轮六阶段大颗粒整包](agent-tasks/product-wave-10/README.zh-CN.md)。** 已重新审视A–E最新固定source：A三项库存反例未修，B新公共模块strict76错误，D材料/多state进程归属六反例FAIL；C新增问题限未消费helper/recipe，现有main上下文路径通过。E旧schema13安装不能代表D新schema15或当前main。下一包并行做“所选上下文用于单条对话”与“恢复/普通个人安装”，普通安装不再等恢复或研究。共享binding接口已在677cf26发布，主线负责真实HTTP/provider/目标组合；见[0033验收与分工](docs/rfcs/WP-16/0033-wave-10-admission-and-product-closure.md)。八组实例保留、模型/native0、不刷新预算。

**上下文与交付记录已接通：[http://127.0.0.1:5187/](http://127.0.0.1:5187/)。** 主线 `32fc7ae` 提供顶栏“上下文预览”：选择项目、原会话内工作、来源与预算，查看内容、摘要、遗漏和过期状态；工作详情新增交付记录、历史分页及部分可见活动计时。14项真实HTTP/SQLite网页流程在干净源码复跑通过，无模型调用。新预览使用独立state；原5180–5186服务和历史保留。A恢复验库三个反例仍FAIL，D目标准备尚无可集成的固定检查点，未开放恢复激活。接口、证据和精确限制见[0032](docs/rfcs/WP-16/0032-context-evidence-product-checkpoint.md)及[本轮记录](reports/releases/wave09-integration/README.zh-CN.md)。

**当前派工：[第九轮恢复目标/context/托管升级整包](agent-tasks/product-wave-09/README.zh-CN.md)。** 已独立复验A备份与C旧授权反例，分范围接入；B资源/token、C种类/命令绑定、D孤儿进程、E费用实际链与安装来源仍有阻断。共享RecoveryTarget port及配置binder已交，A/D可立即做真实目标读验/准备，main承担context网页与最终授权激活。详细source/反例/范围见[0031](docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)，不新增预算/Driver，不把旧安装结果当当前个人版通过，七组实例保留。

**提案网页已接通：[http://127.0.0.1:5186/](http://127.0.0.1:5186/)。** 用户消息旁“转为提案”可预览并明确确认创建工作、修订合同或记录决定，支持拒绝、来源漂移和刷新后核对原请求。8项真实HTTP/SQLite网页流程通过；A schema15生产恢复facts已集成，新增只读source记录查询，仍固定not_granted/startupAvailable=false。新个人开发预览使用独立私有state，原5180–5185未重启/迁移，本批没有触发真实模型任务；不是恢复target/安装/原生控制准入。源码与消费约定见[0030](docs/rfcs/WP-16/0030-wave-08-proposal-workbench-and-source-audit.md)及[限定证据](reports/releases/wave08-proposal-workbench/README.zh-CN.md)。

**2026-11-11 当前派工：[第八轮可用个人版整包](agent-tasks/product-wave-08/README.zh-CN.md)。** A对齐生产激活事实/历史迁移，B现有运行诊断/恢复支持，C关闭上下文授权边界，D保留personal模式的升级/失败进程一致性，E同源网页/安装/恢复独立验收；main承担实际网页与target激活。审视及精确候选见[0029](docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)。旧决定复活已修；composer新反例未通过，未整体启用。当前Codex试点封存BLOCKED，不再重复费用上界调查、不刷新预算、不阻断产品，原六组服务保留。

**提案后端已接通：[0028](docs/rfcs/WP-16/0028-wave-07-proposal-http-and-admission.md)。** 源码627ef0d增加只读签名预览及明确confirm/reject，支持新建工作、修订合同和记录决定，提案状态/原业务效果/回执同事务。46项HTTP/恢复、33项受控产品/流式/设置通过。页面尚待接线，旧服务未重启；A/C/D新候选仍有明确准入反馈，不宣称恢复启动或安装Alpha完成。

**第七轮首批实现：[事务命令与恢复意图接口](docs/rfcs/WP-16/0027-wave-07-command-and-recovery-checkpoint.md)。** A/C最新消费者已按路径集成；应用支持异步prepareCommand与同步commitPrepared，A可消费恢复意图fact port，main source事务消费者已交。七包回归与4项恢复意图组合通过；C有效列表复活旧项另有独立FAIL，已列入本轮修复。恢复commit/目标启动与提案网页仍未交，不改变旧服务或预算。

**2026-11-11 当前派工：[第七轮六阶段整包](agent-tasks/product-wave-07/README.zh-CN.md)。** 已审视A d3207d8、B 6890fe8、C 119bb96、D 4a0ea7f、E 3cfe445候选；下发A恢复持久事实/历史证据、B统一实际adapter准入与有限费用可行性、C上下文/提案组合、D真实双binary升级、E预算拒绝与独立安装/产品验收。main承担恢复commit/激活、提案事务/网页及同源版本集成；[0026](docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)为待实施边界。每包先交可运行checkpoint，再连续推进；预算不刷新，pilot不阻断独立产品工作，原六组服务保留。这是新计划，不表示恢复激活、试点或安装Alpha已经通过。

**主线第二检查点：[接受Outcome与恢复只读预检](docs/rfcs/WP-16/0025-outcome-projection-and-recovery-preflight.md)。** 已接A最新接受投影，新增GET工作证据、GET恢复inspect和POST恢复prepare。后端61、契约211、storage75/workflows23通过；预检不改旧queue/marker/项目绑定。恢复commit和新授权仍未实现，返回not_granted/commitAvailable=false，不能当成恢复已可执行。旧5180–5185服务未重启，新接口在新源码部署后可用；见 [限定证据](reports/releases/wave06-outcome-recovery/README.zh-CN.md)。

**第六轮主线新检查点：[http://127.0.0.1:5185/](http://127.0.0.1:5185/)。** 已接A v13持久port、C决定事务/共享待办优先级和B精确profile解析。用户消息可预览并明确记录为项目决定，顶栏可查/撤销，响应未知保留原命令；本批未启动模型，也未自动注入上下文或执行。决定网页4、待办网页6项及后端51项通过。新私有state与原5180–5184历史分开，未重启旧服务；接口/消费者见 [0024](docs/rfcs/WP-16/0024-wave-06-decisions-http-checkpoint.md) 与 [限定证据](reports/releases/wave06-main-checkpoint/README.zh-CN.md)。

**第六轮历史派工：[大颗粒整包](agent-tasks/product-wave-06/README.zh-CN.md)。** A持久消费者/计时迁移，B现有Codex控制与试点运行，C共享排序/决定事务，D个人Alpha发行恢复，E前置价值初筛与独立准入，main公共接口和产品接线。保留原目录/分支/候选和已测结果；未完成项按第七轮继续。共享语义与依赖见 [0023](docs/rfcs/WP-16/0023-wave-06-alpha-and-value-boundaries.md)，修订01仍约束后续轮次。

**跨项目待办预览：[http://127.0.0.1:5184/](http://127.0.0.1:5184/)。** 原“待我决定”入口已增加跨项目/会话的问题、当前候选及明确阻断，支持筛选、分页、回原会话和逐项审阅；每项仍单独回答/接受。当前按本页等待时间排列，C优先级候选尚待准入。新实例使用独立`.local-state/attention-preview`，原5180–5183及其历史保留，未自动迁移。后端43、前端18及22条分范围浏览器场景通过，非模型/复核收益证据；详见 [0022消费说明](docs/rfcs/WP-16/0022-attention-inbox-consumer.md) 与 [限定交接](reports/releases/attention-inbox/README.zh-CN.md)。

**第五轮修订01优先：[价值试点、密封副本与注意力工作台](agent-tasks/product-wave-05/AMENDMENT-01.zh-CN.md)。** 先用当前Codex做不复核/续会话自查/全新会话复核三arm初筛；E独立小额grant不挤B，第二Driver投资等初筛结果。main/C先交无需模型的注意力视图；新推荐/复核在R0未准入前仅实验、默认关闭。采集代码开始记录候选等待和部分UI审阅活动代理，见 [0021](docs/rfcs/WP-16/0021-value-first-review-amendment.md)。

**当前派工：[第五轮任务包](agent-tasks/product-wave-05/README.zh-CN.md)，先读上面的修订01。** A必要证据与计时，B现有控制/session/胶囊边界，C决定闭环与注意力规则，D个人发行迁移，E独立复核初筛和验收，main注意力UI与公共集成。公共记录和恢复项目绑定修复已交；接口见 [0020稳定输入](docs/rfcs/WP-16/0020-wave-05-dispatch-and-shared-inputs.md)。沿用原目录/分支，旧缺口先闭合；第二Driver等价值闸门，不竞速、不自动接受，旧预算不刷新。

**A/C第四轮源码已继续集成：** 会话目录改用持久成员索引；C原三项准入问题已通过。实际SQLite提案/决定联调6项通过、同一决定重放1项失败，完整助理功能保持关闭；详见 [0018联调](docs/rfcs/WP-16/0018-assistant-storage-consumer.md) 与 [C接线补充](agent-tasks/product-wave-04/c-integration-followup.zh-CN.md)。

**新项目设置预览：[http://127.0.0.1:5183/](http://127.0.0.1:5183/)。** 主线已接通项目名称/检查/离线缓存策略的版本化编辑、历史与归档/恢复，旧任务按原合同检查和环境快照执行，设置不会改写在途工作。使用独立`.local-state/project-settings-preview`；原三个实例保留。见 [0017设置接线](docs/rfcs/WP-16/0017-versioned-project-settings.md)。

**下一轮开工：[第四轮 A–E 完整助理与发行准入](agent-tasks/product-wave-04/README.zh-CN.md)。** 五个Agent沿用原目录/分支，合并最新main后执行各自五阶段整包。主线已交A/C共用持久接口和恢复只读启动，C/B/D/E的独立准入缺陷与消费方式见 [0016](docs/rfcs/WP-16/0016-wave-04-interfaces-and-admission.md)。这替代第三轮新派工，不覆盖旧实测范围或刷新模型预算。

**当前新后端预览：[http://127.0.0.1:5182/](http://127.0.0.1:5182/)。** 主线已接通持久会话管理：A 的存储/工作流和 C 的模块源码已进入 main；网页新增历史目录、搜索、重命名、归档/恢复及会话草稿隔离。四项实际 HTTP 网页闭环通过。该实例使用独立 `.local-state/workflow-preview`，没有自动迁移旧实例历史。C 的来源失效准入 probe 失败，生产上下文/决定保持未启用；A–E 实测状态与下一消费约定见 [会话集成检查点](docs/rfcs/WP-16/0015-workflow-catalog-integration.md)。

**主线新增可操作验证恢复：** 验证异常有限重试后显示持久故障原因，允许用户明确重新检查当前候选；不会重新编码或绕过机器 FAIL。独立 HTTP schema、组合方式及 A–E 消费说明见 [验证恢复检查点](docs/rfcs/WP-16/0014-verification-recovery-checkpoint.md)。用户正在使用的 5180/5181 服务未重启；后端新入口在下次正常重启后生效。

**新版工作台：[http://127.0.0.1:5181/](http://127.0.0.1:5181/)。** 已实现主对话、工作/交付、集中问题、执行器四视图，石墨/白色/青绿设计系统及手机互斥抽屉。12 项前端单测、8 项界面交互、11 项既有 HTTP 浏览器流程通过；当前会话内的搜索/筛选可用，服务端历史目录等仍按 A–E 包补齐。见 [UI 检查点](docs/rfcs/WP-16/0013-product-workbench-wave-03.md) 与 [设计规范](apps/console/DESIGN.md)。

**当前执行入口：[第三轮 A–E 五 Agent 产品化任务](agent-tasks/product-wave-03/README.zh-CN.md)。** 主线负责新版 UI 和公共集成；A 会话/项目工作流，B 原生控制恢复，C 上下文/提案/明确决定，D 本机发行迁移，E 独立端到端验收。每包五阶段连续执行，先交检查点后继续整包。完整能力现状、优先级和内部试用/CAC 路线见 [产品路线图](docs/roadmap/product-wave-03.zh-CN.md)。下文旧派工仅供追溯，不覆盖本轮归属。

**2026-11-10 新版带依赖预览：[http://127.0.0.1:5181/](http://127.0.0.1:5181/)。** A 的环境模块已通过八项独立准入并接入 Runner、验证和工作台。导入普通 pnpm 单包项目时，可选择授权缓存离线准备；原 5180 实例保留。首次真实任务发现并修复 Git 忽略文件的冻结问题，之后复用同一候选完成完整交付。源码/测量与后续限制见 [本批集成](docs/rfcs/WP-16/0012-environment-product-integration.md)，下文“未接入”等段落保留为历史。

最终冷启动验收：干净源码提交 `76ca85e` 上，一个全新真实 Codex 任务从导入到接受/重开六项全通过。当前受控工作台 434 项、Runner 132 项通过；主线模型任务合计两个，已达本轮预算。完整 G2、真实运行中原生停止/审批仍保持单独范围。见 [精确发布证据](reports/releases/environment-mvp/integration.json)。

**2026-11-10 当前派工：[带依赖项目收尾批次](agent-tasks/native-mvp-02/release-closure.zh-CN.md)。** A 继续环境模块准入与恢复/消费，B 继续验收工具修复与真实执行/浏览器/稳定性矩阵；主线负责环境进入独立 Runner、验证和工作台。先交单包可用预览，再继续扩展。目录和分支保持，下文旧派工消息改以该收尾批次的 A-R/B-R 优先级执行。

**当前派工入口：[Native MVP 第二轮整包](agent-tasks/native-mvp-02/README.zh-CN.md)。** A 负责环境准备准入，B 负责可执行的真实原生与故障验收，主线负责环境、验证及工作台集成。两人保留原目录和分支，先合并最新 main。native-mvp 首轮及 wave-02 仅作历史参考。

**持续执行扩展：[A1–A6 / B1–B6 / M1–M6 队列](agent-tasks/native-mvp-02/extended-run.zh-CN.md)。** 用户离开期间，提交稳定检查点后继续下一阶段；遇阻先留复现，再做独立任务，不逐项等回复。A 增加只读诊断/恢复样例/受限 workspace，B 增加故障矩阵/浏览器/有界稳定性/接入工具，主线继续产品接线与自助诊断。

主线新增 [环境接口与自助诊断检查点](docs/rfcs/WP-16/0010-main-environment-operations-checkpoint.md)：`pnpm doctor` 可只读核对当前实例，启动复用会核对真实进程/监听和私有接口；可信环境排除 interface 已通过真实 Git 回归。整包受控回归 387 项通过，依赖准备的生产接线仍未启用，不把该 interface 当作安装已完成。

本批交付清单新增完整 patch 的 artifactId/sha256/bytes/format，HTTP 下载后可直接验证并 apply 到基线 clone，无须依赖执行器 commit。A/B 最新提交的准入、可重跑证据和剩余修复见 [扩展复核](docs/rfcs/WP-16/0011-extended-checkpoint-review.md)：A 原五项已修好但三项仍失败，B 验收工具还有过早 PASS 与非法继续命令；两者未整包准入。当前服务不自动重启，后端新行为在下次正常重启后生效。

**本机 Codex MVP 已接入：** 双击 `start.command` 或运行 `pnpm start`，打开 `http://127.0.0.1:5180`。从工作台导入本地 Git 项目，在对话输入目标，点击“委托执行”确认后，真实 Codex 会在独立 worktree 改代码、运行注册检查，供审阅完整 patch 并接受当前交付。无需手动令牌，原项目不自动覆盖。见 [使用指南](docs/ASSISTANT-GUIDE.zh-CN.md) 与 [工作台说明](docs/WORKBENCH.zh-CN.md)。本轮实际范围为 macOS arm64 / Codex 0.164.0 / Node 项目；不是完整 G2 或其它执行器的兼容声明。

最新事实：首次真实 Codex 后端五场景和浏览器六场景通过，完成真实代码、既有测试、当前候选接受、产物下载及重开保留；原 A/B 八项准入阻断已修复。主线回归 367 项、内部运行时回归 262 项及原生零模型安全探针 3 项通过。证据见 [native MVP](reports/releases/native-mvp/) 与 [集成约定](docs/rfcs/WP-16/0008-native-mvp-integration.md)。真实模型审批、澄清、运行中 steer、完整故障矩阵、长期 soak 与依赖准备仍按单列范围推进。以下 G0/G1 历史段落按记录日期阅读，不取代本段最新事实。

2026-11-09 外部交付复核：A `f1d4b1f` 包内 12 项及构建通过，但五项新增环境准入均失败，尚不启用项目依赖安装。B `0e62a3d` 框架八项通过，当前主线只读五项通过，原生七项仍未执行；其 native 分支仍是固定跳过。下一轮从这些实测缺口继续，见 [复核与接线边界](docs/rfcs/WP-16/0009-native-followup-review.md)，不影响上述已验证的无依赖 MVP。

## 1. 唯一交付仓库

最新阶段：G0 已按 darwin/arm64 的限定范围验收通过，详见 [G0 主 Agent 交接](docs/adr/bootstrap/g0-main-report.md)。下表的首轮工作目录/分支用于追溯 G0；下一轮各自从集成 main 新开 G1 分支，A 转 WP-02，B 转 WP-03，主 Agent 转 WP-01/16。

G1 进度：正式 core/公共契约和 workspace 已交付，core 178 项及契约 183 项测试通过；[G1 核心交接](docs/adr/core/g1-core-handoff.md) 明确接口与剩余联调。整体 G1 尚未通过，等待 A 的存储和 B 的运行时接线。

历史恢复检查点（2026-11-08）：主线持久登记、恢复编排和队列接线 **56 项通过**，含 6 个真实 SIGKILL 窗口。其完整范围见 [登记恢复交接](docs/adr/core/g1-registered-recovery-handoff.md)。本轮已进一步复验并接入 A/WP-04，旧任务单仅保留历史追溯；当前仍执行 wave-02 整包。新增产品 SIGKILL 场景证明“不重复 begin、保留不确定状态”，没有将其当成独立 Runner 存活重连证据。

[JokersDH/dsh-superagent-prototype](https://github.com/JokersDH/dsh-superagent-prototype) 是后续方案 B 的交付仓库。架构、试验和正式实现都提交到这个仓库。

- `origin`：你的 fork，用于 fetch/push。
- `upstream`：DeepSeek 官方仓库，仅用于跟踪原型更新。
- `main`：主 Agent review 后集成的基线。
- `codex/g2-workspaces-verification`：Agent A 当前开发分支。
- `codex/g1-runtime`：Agent B 当前开发分支。
- 两个 `codex/g0-*` 分支保留为历史试验证据，不作为当前开发入口。

分支是同一仓库的开发线；本机 worktree 是各开发线的独立目录。它们共享 Git 对象和远程地址，各有自己的工作文件。修改不会自动出现在另一个目录，必须通过 commit 和集成流转。

## 2. 代码在哪里

| 路径（相对仓库根） | 内容 | 当前状态 |
| --- | --- | --- |
| `src/` | 原始 DeepSeek superagent 原型源码 | 已有，不作为新产品直接运行宿主 |
| `src/core/` | 待验证提取的 Ticket/Assignment 领域核心 | 已有；G0 先证明独立提取 |
| `tests/` | 原型测试，包含 core baseline | 已有 |
| `docs/`、`prompts/`、`skills/` | 上游原型文档和模型资产 | 已有 |
| `product-spec/` | 完整架构、契约草案、17 个任务包、83 条验收要求 | 已有设计，不等于产品已实现 |
| `agent-tasks/` | 当前三人的直接开工指令 | 已有 |
| `tools/reuse-spike/core-extraction/` | Agent A 的隔离提取源码、测试、lock、报告 | CORE-01 已独立复核通过 |
| `tools/reuse-spike/platform/` | Agent B 的运行时/SQLite 探针和报告 | 补齐漏交 helper 后，G0 平台探针独立复核通过 |
| `packages/contracts/` | 公共运行时 schema/生成类型/JSON Schema/版本哈希 | G0 v1 已实现，183 项测试和独立 package 检查通过 |
| `apps/coordinator/runtime-ingress.ts` | 事实严格准入、身份/去重和单事务 interface | 已通过 25 项测试；生产 binding/IPC 仍待接线 |
| `apps/coordinator/stored-ingress.ts` | 实际仓储/事实回执/core 的组合适配 | 新增 5 项受控进程集成测试通过；完整恢复待下一批 |
| `apps/coordinator/recover-facts.ts` | 原载荷恢复、严格预检、幂等事实重放 | 恢复 9 项通过（含两个 SIGKILL）；不重启原生业务 |
| `apps/coordinator/runner-link.ts`、`resource-barrier.ts` | 本机认证查询/取消，可信完整资源清单与事务屏障 | 17 项通过（含独立进程重连）；生产 Runner daemon/注册仍待接线 |
| `apps/coordinator/runner-registry.ts`、`reconcile-runner.ts`、`recovery-effects.ts` | 持久可信登记、稳定取消意图、恢复编排、现有队列接线 | 合计 56 项通过，含 6 个 SIGKILL；实际 AttemptRunner daemon 接入待完成 |
| `packages/orchestrator-core/` | 正式提取及最小扩展后的 core | 已实现第一批：legacy 144 + 新守卫 34 项测试 |
| `packages/storage/`、`effects/`、`execution/`、`driver-kit/`、`testing/` | 持久化、队列、运行时基础与受控测试 | 已有实现与分范围验收；完整运行时/产品数据仍在推进 |
| `packages/workspaces/`、`verification/` | 可信交付模块 | A `8f1e60a` 后端已复验并接入；30 项测试及既有准入探针通过 |
| `packages/questions/`、`application/` | 问题中心和确定性应用 | 已有 SQLite/API 接线和受控产品集成；分别 14/11 项模块测试 |
| `packages/catalog/`、`policy-preparation/`、`drivers/` | 执行器接入 | B 候选独立验收；不能将协议 fixture 当作已安装原生 agent 兼容证据 |
| `apps/coordinator/product/` | 真实受控子进程、问题和验收组合入口 | 新增 14 项集成场景；真实 loopback HTTP 可通过 smoke 脚本执行 |
| `apps/coordinator/`、`apps/runner/` | 新产品组合适配与受控运行基础 | 组合模块已实现；真实产品进程入口本轮接线 |
| `apps/console/`、`apps/cli/` | 网页工作台、CLI | 工作台本轮启动；CLI/发行后续推进 |

**落点已确定：新产品在这个仓库根目录增加 `packages/`、`apps/`、`tools/`，不再另建产品仓库。** 根 workspace/package 配置由主 Agent 单独集成；G0 试验使用自己的子目录 package，不先改原插件运行方式。

## 3. 本机三个工作目录

| 角色 | 本机目录 | 当前分支/目标 | 当前整包 |
| --- | --- | --- | --- |
| 主 Agent（当前会话） | `/Users/hh/Desktop/joker/superagent` | `main` 为集成目标，实施用 `codex/*` | 问题中心、确定性应用/API、独立集成 |
| Agent A | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g2-workspaces-verification` | `packages/environment-preparation/` 环境准备准入 |
| Agent B | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g1-runtime` | `tests/native-acceptance/` 真实原生和故障验收 |

这三个是同一个 fork 的三个 checkout。没有把你的 CAC 仓库搬进来，也没有将本机的 node_modules、凭据或模型会话作为共享材料。

## 4. 如何让另外两个 Agent 开始

在 Agent A 的工具里打开 `/Users/hh/Desktop/joker/superagent-agent-a` 作为项目/工作目录，然后发送：

```text
继续 Native MVP 第二轮 Agent A 整包。工作目录 /Users/hh/Desktop/joker/superagent-agent-a，分支 codex/g2-workspaces-verification。
保留已有改动，fetch 并合并最新 origin/main，读取 AGENTS.md、agent-tasks/native-mvp-02/README.zh-CN.md 和 agent-tasks/native-mvp-02/agent-a-environment-admission.zh-CN.md。
仅修改 packages/environment-preparation/：修复五项主线复现，交付可信环境凭证、复验/清理、进程注入接口和离线 pnpm 验收。先交稳定接口检查点，然后连续完成整包。
再读取 agent-tasks/native-mvp-02/extended-run.zh-CN.md，继续 A4–A6 的只读诊断、跨进程恢复/样例和受限 pnpm workspace，不在首个交接点停止。
不要重交旧 workspace/console/Runner 实现；只提交拥有路径并 push 自己分支，根 lock 和公共接口由主线集成。
```

在 Agent B 的工具里打开 `/Users/hh/Desktop/joker/superagent-agent-b`，然后发送：

```text
继续 Native MVP 第二轮 Agent B 整包。工作目录 /Users/hh/Desktop/joker/superagent-agent-b，分支 codex/g1-runtime。
保留已有改动，fetch 并合并最新 origin/main，读取 AGENTS.md、agent-tasks/native-mvp-02/README.zh-CN.md 和 agent-tasks/native-mvp-02/agent-b-native-acceptance.zh-CN.md。
仅修改 tests/native-acceptance/：修正共享契约和严格退出，实现真实 native 分支，在私有实例完成交付、机器失败、停止和重启四组验收。按任务限制最多四个模型任务，不操作用户正在使用的服务。
先交可执行检查点，再连续完成整包；产品缺陷给主线复现，不改产品或降低期望，只 push 自己分支。
再读取 agent-tasks/native-mvp-02/extended-run.zh-CN.md，继续 B3–B6 的故障矩阵、浏览器、有界稳定性和新执行器验收工具；总模型任务上限仍为四个。
```

两人可立即并行。B 先验无依赖真实项目，无需等待 A；主线按 [环境产品化与独立验收消费](agent-tasks/native-mvp-02/main-integration.zh-CN.md) 推进接线，A 准入通过后再启用依赖准备。转发任务入口即可，无需复制历史对话。

## 5. 每个人怎么上传

每人按实际改动显式暂存拥有文件，提交前用 `git diff --cached --name-only` 核对范围。不要将根 lock 的临时安装差异、凭据、DB、依赖和未交接代码带入提交。Agent A 只 push：

```sh
git push -u origin codex/g2-workspaces-verification
```

Agent B 只 push：

```sh
git push -u origin codex/g1-runtime
```

主 Agent 消费检查点 commit，复验后分段集成 main。A/B 提交检查点后继续各自整包内的独立工作，不等待每个小修复的确认，也不自行合并彼此分支或改别人路径。

## 6. 本轮交付出口

- A：环境准入复现闭合，准备结果可跨重开复验，清理有可信归属，受控安装进程可接入现有 Runner。
- B：真实原生流程可执行，交付、检查失败、停止和重启有独立证据，未执行必需用例不能绿色退出。
- 主 Agent：真实带依赖单包项目从 UI 导入，经环境准备、Codex 编码、检查到完整 patch 和接受/重开；保留现有无依赖 MVP。

完整要求、接口、检查点和后续范围见 [本轮排程](agent-tasks/native-mvp-02/README.zh-CN.md)。旧 G0 材料在 [bootstrap 交接](docs/adr/bootstrap/g0-main-report.md)；历史设计分工保留在 product-spec，不再作为本轮开工模板。

## 7. 其他机器上的 Agent

同机可以直接使用已准备的两个 worktree。其他机器先 clone 你的 fork，再 checkout 对应远程分支；以该机器的 clone 目录为工作目录，读取相同任务文件。

```sh
git clone https://github.com/JokersDH/dsh-superagent-prototype.git
cd dsh-superagent-prototype
git switch --track origin/codex/g2-workspaces-verification
```

Agent B 使用 `origin/codex/g1-runtime`。已有 checkout 保留当前工作并合并 main，不重新执行示例 checkout 覆盖工作。提交/push 使用该机器自己的正常 GitHub 权限，不复制本机 token。
