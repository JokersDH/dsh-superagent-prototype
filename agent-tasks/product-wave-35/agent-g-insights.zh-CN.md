# G：可信观察与诊断的三连续工程包

2026-11-16。原目录 `/Users/hh/Desktop/joker/superagent-agent-g`，原分支 `codex/g4-usage-insights`，固定输入 `35fc58957c2768b204a8ce67567d3d5a4ff888ed`。保留dirty/history/state，fetch并merge origin/main，不reset。

先读AGENTS、START-HERE、product-spec/README、本轮[README](README.zh-CN.md)、[0089主线](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090验收](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091工程程序](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。

建立/延续一个覆盖三连续工程包、九个完整生产成果的whole goal；上轮未闭整链在这里继续，不将修一个反例算一个成果。比上轮六成果扩大到九个，每项必须实现+实际consumer+必要正负+source交接。早/中/终source发布后持续全部包/联调/独立队列，不逐小fix等派工，无同日/时长/工时/token承诺。

## 工程包一：可信观察与诊断产品

### 成果 G1：观察来源与样本的完整生产语义

实施：完善原work/header/row样本、层/币种/单位、unknown/partial/source枚举与caller截断的一致性，沿原reader分析，不从formatted反解析数值。

实际消费者与验收：同一当前main scope的page/export/support/CLI消费同一模块；非空、0、缺区间、冲突与超界均有实际输出。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 G2：严格诊断文件与版本兼容边界

实施：完成无秘密的strict投影、byte/count/scope/window/hash一致性、旧格式降级和不可信额外字段策略；generic reader诊断不等产品文件验证。

实际消费者与验收：独立读取main实际下载文件，拒重新hash的混scope/额外secret/错counts；保留同源合法文件和明确unverified。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 G3：可证明的当前安装身份

实施：本次runtime helper仅读声明manifest和扫描关键字：伪manifest/缺inventory/注释文件也得runtime identity与部分capability。先区分自述/静态已核/当前运行，再复用D可信manifest和main原进程启动身份。

实际消费者与验收：main缺证仍origin:null；完整hash正向与改manifest/缺文件/注释/错运行根负向对照，不由输入路径或预期值自证当前运行。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

## 工程包二：真实反馈和数据解释

### 成果 G4：真实问题反馈到定位与复验

实施：从原App当前范围支持下载，经CLI/独立H定位明确缺口，修复owner接收准确复现，再以当前同类scope重读验证；不自动发外部服务或打包state。

实际消费者与验收：一项真实工程问题完整首尾文件/当前版本/独立consumer，不补造操作者意见、native或收益。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 G5：人工等待与审阅代理事实

实施：使用原ExecutionOutcome/ReviewTiming表示ready到accept等待、UI活动代理和缺失投入，处理重叠/时钟/未接受；不把代理变人时。

实际消费者与验收：原持久事实→受权reader→公开DTO/CLI有限对照，保留0与unknown，缺baseline不给提升百分比。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 G6：有界收集与数据完整性

实施：在原50works/10000nested/2MiB/2秒范围统一全局编码/嵌套/时间边界、唯一work映射/冲突隔离，达限明确partial和原因；不加另一collector或SQLledger。

实际消费者与验收：同一实际main reader含多项目/深嵌套/重复/冲突/超界的有限代表路径，错误不拖垮普通启动。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

## 工程包三：日常维护与同版本交接

### 成果 G7：显式操作者数据的私有导入

实施：完善现有operator baseline文件契约/来源标记/缺数和不可比规则，限定私有新输出，不自动采集全局行为或读取其他账号。

实际消费者与验收：CLI消费合法人工文件、错误单位/币种/窗口/来源文件明确拒或不比较；无真实操作者数据则工具可用且价值NOT_MEASURED。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 G8：可维护CLI与旧产品兼容

实施：完成当前/旧download/support文件、缺可选模块、readonly与正常实例、严格参数/私有输出/错误码的一致操作体验。

实际消费者与验收：main真实文件、固定旧文件和包内reader消费，Node不进浏览器；功能缺失不得阻普通工作台。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 G9：同版本集成与支持交接

实施：给D/main提供最小源码和可信身份输入建议，H/E独立消费准确包内报告；区分原W33与当前模型GUI后继，不让E追HEAD。

实际消费者与验收：完整API/exports/构建依赖/版本差异和真实scope证据，installed/native/value分别未达则保留，不扩计费研究。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

## 独立队列与完成条件

外部输入只阻对应项；发最小真实RFC/consumer后继续本owner兼容、错误、数据边界、日常使用和source交接，不无限轮询/重复长soak/复制另一owner状态机。上轮通过的真实正向保留，旧修复不重新派；新反例只是完整结果内部的必要修复。

仅owned：`packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`。A sole生产迁移、E sole产品断言、I sole通信，B排除I；共享contracts/HTTP/App/root只由main修改。

状态 `reports/usage-insights/wave35-status.json`；显式owned路径推原origin分支，main HEAD:main，neverupstream/reset/清状态。九项都有生产行为、真实consumer、必要正负、source交接才结束整goal；source/controlled/installed/native/recovered/value分开，未达不借其他层补齐。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price-recipe研究。十二5180/8796至5191/8807以及全部state/profile/tar/ledger/dirty/history/runs/五用户日志保留。

完整originalspawn/privateimmutablebirth/PID/start/UID/orderedfullargv/root/config/op/fullresources先验且逐signal fresh；UNKNOWN保留全部材料。不globaldiscovery/substringkill/绕产品拒绝清理/真实CLI fallback。完整方案B/CAC后置，不新增Driver/desktop/autoaccept/writerracing/dynamicDAG/第二生命周期或账本。
