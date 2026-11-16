# G：可解释观察、诊断与真实反馈完整工程

2026-11-16。原目录 `/Users/hh/Desktop/joker/superagent-agent-g`，原分支 `codex/g4-usage-insights`，固定提交 `76467c33db3ec068d0521997a4511c2fbf9c9de1`。保留dirty/history，fetch并merge origin/main，不reset。

先读 AGENTS、START-HERE、product-spec/README、本轮[README](README.zh-CN.md)、[0086主线已交](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087验收](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088工程程序](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。

一个whole goal覆盖两个连续工程包、六个完整产品成果。每个成果必须有生产实现、实际consumer、必要正负例和source交接；不是六条测试或六个小修。早交稳定source后继续两包及独立队列，不逐fix等main回复，无工时/同日/token承诺。

## 本轮起点

G support文件/摘要/独立reader有实质代码，15项相关复验通过。main `23d5a98e` 已真正接入当前授权观察→严格metadata DTO→GET `/v1/insights/support`→真实App下载；origin缺证时null/unverified。不得继续把默认支持入口写成未实现。

main没有挂通用上传handler或passthrough reader为公共接口；当前导出无value/formatted/label/detail/私有路径。源级摘要不等安装身份、数值分析或收益证明。G不用改HTTP/App来补第二套入口。

## 工程包一：同一范围的可信观察与诊断产品

### 成果一：完整生产观察语义与数据边界

完成原 analyzer/export/display/support 的一致语义：work样本与行样本分开、来源层/currency/unit独立、unknown不补0、partial与source枚举/调用者截断分开。复核嵌套对象/重复/冲突/无效时间/空数据在实际main reader输出中的表现，补必要生产修复。

每条上限覆盖总编码字节、总nested、总work和时间预算；不能只在每个局部分段限额。达到上限明确partial/omitted，晚到或冲突事实不能恢复旧错误数值。保持当前50work/10000nested/2MiB/2秒主线预算，不通过扩大上限掩盖问题。

实际consumer：main当前授权reader和CLI各消费同一生产模块，比较同scope的header/rows/window/layers/currencies。正例包含非空、缺值和两项目；负例包含冲突、跨范围、超界，给有限复现。

交接：最小源码闭包、source SHA、原DTO差异、实际consumer命令/exit和剩余层；不复制新collector/SQL ledger或默认全库扫描。

### 成果二：诊断文件的完整可信边界

完善通用本地reader的shape/bytes/一致性/缺字段策略。自述metadata和受验证产品文件分别表示，未知字段不能被保留并转发成“无秘密”结论。若保留宽松诊断模式，输出必须严格重新投影，明确不合契约及未验证。

完成观察envelope与text的digest、rows/scope/window/header对照，缺digest保持absent；摘要本身不承诺可重建原数值。负例包括重新hash的混scope、额外secret字段、错counts、未来时间、超长嵌套和错误身份。

实际consumer：独立读取main真实下载文件并找到一个已知缺口/缺证；不能只reader读自己手造样本。保留main严格公共schema，不向浏览器引入Node库或给未授权上传新接口。

交接：稳定Node接口、允许字段与兼容政策、正负文件、H/E可直接运行的只读consumer；不修改E断言。

### 成果三：当前运行身份与支持摘要的有证据组合

与D/main使用同一已验证install/runtime manifest输入，明确来源、archive/build/source、schema/ABI及capability各自证据。只有archive不能证明正在运行它；缺或不一致保持unknown，不由仓库HEAD/路径猜身份。

提供Node纯投影和严格输入契约建议；main负责可信身份读取/公共DTO，F负责呈现。错误build/source/manifest字段、旧安装配新source、missing capability必须保留差异。

实际consumer：固定W33包可以先做受限对照；新main runtime successor必须新subject另记。未安装source留在source层，不能以G的origin字符串授予发行准入。

交接：D/H/E同一文件及准确tuples对照，必要最小集成片段；不要为身份显示制造新状态权威/发行收集器。

## 工程包二：可持续反馈与效率事实

### 成果四：一次完整问题反馈到定位与修复验证

从实际App当前scope下载一个支持摘要，经CLI读取→区分当前source/安装/数据缺口→定位明确问题→由相应owner修复→重读同类当前scope确认差异。公开链路只用脱敏metadata，不自动发送外部服务。

报告应允许同事手动提供summaryId/窗口/版本/错误码；路径/key/目标/patch不进入默认摘要。需要额外数据时明确选定授权，不自动打包整个state。

实际consumer由H或main独立复现，正例定位成功与无法判断的真实案例都保留；不为故事补造native/value事实。

交接：一份可操作反馈流程、实际首尾文件和独立命令，而不是再写一份“以后接入”的runbook。

### 成果五：人工等待和审阅观察的可解释结果

利用原ExecutionOutcome/ReviewTiming已持久事实，区分候选就绪到接受的等待、界面可见活动代理和真正人工投入未知。时间缺失/重叠/时钟异常/未接受不填0，不能从formatted字符串反解析数值。

完善最小纯分析/导出及实际read consumer，按项目/窗口/层/样本给出处与unknown。设计固定的操作者基线导入契约，手工数据必须标operator，不能混成自动采集。

真实收益研究与计费pilot仍BLOCKED，无新数据就交付正确的“不足以结论”和可用记录流程。不得用fixture百分比冒充提升，也不新增price/recipe研究。

交接：实际已有事实的有限分析、必要正负与缺证清单；为今后是否自动接受提供数据而非本轮开启自动接受。

### 成果六：观察子系统长期兼容与可维护交付

完成包exports/CLI/旧DTO/可选缺模块/错误文件的兼容矩阵，支持readonly恢复实例和普通实例。Node工具strict、有限错误消息、私有输出权限与源/包身份不能相互借用。

用真实当前main/download文件、固定旧文件和一个同包独立consumer验证升级读取；旧文件无法完整验证时明确降级，普通工作台不因可选诊断缺失而启动失败。

交接：稳定API、最小依赖、可运行source和支持矩阵，供D冻结/E验收；源码交付后继续联调，installed结论由E保持独立。

## 独立备选队列

等待D身份或H/E外部结果时，继续本owner输入边界、旧格式、CLI输出、unknown/partial语义、生产文档和必要consumer。不新建模块状态机，不反复长soak，不将“等main”当整goal停止理由。

## 所有权与边界

仅 `packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`；状态 `reports/usage-insights/wave34-status.json`。根锁/contracts/HTTP/App/globalCSS由main，E sole assertions，A sole migration。

自动真实vendor/model/native0；B cap4 UNKNOWN不可花、E原24turn/200000token/USD5/oneflight pilotBLOCKED，不重置/补额/退款/借凭据/价格研究。十二5180/8796至5191/8807及全部state/profile/tar/ledger/dirty/runs保留。

不global discovery/substringkill/绕产品拒绝清理。无新Driver/CAC/desktop/自动接受/writer racing/dynamicDAG/第二生命周期。显式owned路径推原origin分支，never upstream/reset。

## 整包完成条件

六成果均有实际生产行为、真实consumer、必要正负、可重现source交接和精确限制。source/受控/安装/native/恢复/value分别汇报；无证保持未达。检查点发布后继续两包及独立队列，不能把六个文档/小测试算六个工程成果。
