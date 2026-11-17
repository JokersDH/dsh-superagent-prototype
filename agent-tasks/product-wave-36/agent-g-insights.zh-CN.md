# G：完整子系统到默认产品的四条交付线

2026-11-17。原目录 `/Users/hh/Desktop/joker/superagent-agent-g`，原分支 `codex/g4-usage-insights`，固定候选 `d09e155d3e8aad74d1238cbafdaec063802221fe`。保留全部dirty/history/state/账本，fetch并merge origin/main，不reset/清状态。

读AGENTS/START-HERE/product-spec/README、本轮[README](README.zh-CN.md)、[0092已交](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093验收](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094整体程序](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。原[九项验收](../product-wave-35/agent-g-insights.zh-CN.md)保留，未闭的实际consumer/集成/维护继续，不把SOURCE_READY自动写完成。

一个whole-subsystem goal覆盖下面四条更大的端到端产品闭环和独立队列；不是九变十二微阶段。早/中/终可运行source交接后继续整个子系统/default consumer/同版本维护，不在某个小fix或文档处等新派工，无工时/时长/同日/token承诺。

## 产品闭环一：可信安装事实到当前运行支持身份

生产实现：延续旧G3。已补inventory核验/声明与运行输入分层，保持25相关测试正向；把D已核manifest、原main启动entry/record与当前实例身份组合为明确可信输入，静态路径/调用者running字段不自证权限。

默认实际消费者与必要正负：用准确W35真实清单和当前main trusted start fact对照，wrongroot/旧build/缺inventory/声明与hash不一致降为unknown；main现有origin:null在缺证时仍可用，不另建身份collector。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 产品闭环二：同范围观察到严格诊断与人工代理事实

生产实现：延续旧G1/G2/G5/G6。完成header/row样本、currency/unit/layer/unknown/partial、总work/nested/bytes/time预算和严格诊断文件及旧格式；ready等待与UI活动代理不当真实人时。

默认实际消费者与必要正负：同一实际main page/export/support/CLI对照原事实，记录0/缺值/重复/冲突/超界与无baseline，拒混scope重hash/额外字段；不新SQL/ledger/浏览器Node分析。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 产品闭环三：真实下载反馈到定位与修复回读

生产实现：延续旧G4。独立消费main实际support/download文件，给H/E/main可定位缺口的最小scope/窗口/版本/码，修复owner拿到可运行复现后再回读当前结果；不自动外发或打包私有state。

默认实际消费者与必要正负：真实首尾文件+独立consumer确认定位或无法定位，不补造用户反馈/价格/收益；支持新工作历史的元数据反馈而不收集原正文。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 产品闭环四：私有operator/CLI到同版本可维护交付

生产实现：延续旧G7/G8/G9。完善显式operator文件的来源/可比性、0600新输出、旧DTO/缺可选模块/readonly兼容，按D稳定source提供包内reader和支持指引。

默认实际消费者与必要正负：H/E独立消费同一准确版本，source/安装/当前进程/真实operator/value分层；无新预算仍可完成工具/兼容产品，不刷试点或重复soak。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 独立队列与整包完成条件

外部依赖只阻对应项：交最小真实RFC/consumer后继续owned兼容/故障保留/日常路径/模块交接，不无限轮询或重复长soak，不复制另一个reader/状态机/执行生命周期。四条线均有生产实现→默认实际消费者→必要正负→同版本维护才完成整goal，旧九点映射延续不清零。

仅owned：`packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`。A唯一append-only生产迁移，E唯一产品断言，I唯一通信，B排除I；共享契约/HTTP/App/root只由main修改。

状态 `reports/usage-insights/wave36-status.json`，显式owned路径推原origin，main HEAD:main，neverupstream/reset。source/controlled/installed/native/recovered/value分别记录，静态/受控不抬安装或研究准入。

自动真实vendor/model/native0；B原cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price-recipe研究。十二5180/8796至5191/8807及全部state/profile/tar/ledger/dirty/history/runs/五用户日志保持。完整originalspawn不可变birth/PID/start/UID/orderedargv/root/config/op/fullresources先验且每signal fresh；UNKNOWN保留全部材料，不全局发现/substringkill/绕产品拒绝清理/真实CLI fallback。完整B/CAC后置，不新Driver/desktop/autoaccept/writer racing/dynamicDAG/第二ledger或生命周期。
