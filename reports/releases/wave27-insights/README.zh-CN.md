# 只读观测主线交付

2026-11-14，wave27/main M6–M8。G固定2adeeff原模块在Node侧复用，main补授权公开数据采集、嵌套总上限/唯一映射/quarantine拒绝、认证GETinsights、共享展示schema、HttpTransport和App→F真实组件。不是只发接口或重复分析模块。详见[0070](../../../docs/rfcs/WP-16/0070-main-scoped-observation-composition.md)。

默认主对话无统计读取，打开试用准备后按当前项目取最近7天；API也接受30天与明确IANA时区。未知用量保持null、partial保留，证据层/币种不合并。项目/会话身份切换隔离晚到响应，读取失败可用原刷新重试并保留带日期状态的旧观察。统计不写Store、不发模型、不启动Agent，不提供执行许可。

最终运行source `18f892daab756fb2dbcebc9f591bd808ace686db`（初始组合d6c4f80）。验证：contracts239、8新增集成（含实际两项目Product/Broker/SQLite/check/accept、无G模块的Node闭包与同步超时反例）、原readiness6、trial/transport15、strict/generated/build通过。独立review的2200ms同步reader反例已复验为partial/insufficient_data/null，而不是完整观察；两秒是接受预算，不是抢占同步JS的硬响应SLA。

第一轮[浏览器报告](browser/browser-report.json)为修改中source；第二轮[布局报告](clean-browser/browser-report.json)绑定d6c4f80，当时只有新包生成dist未忽略导致clean=false，原字段保留。已查看其[桌面](clean-browser/desktop.png)/[手机](clean-browser/mobile.png)，紧凑标题、窗口和work样本头不挤压重叠。随后只改后端deadline/测试与生成目录ignore，实际App/transport/F展示源未变；最终[准确干净source确认](confirmed-browser/browser-report.json)绑定18f892d，clean=true，6/6、pageerrors0、POST/event增量0、模型/native0，未重复第三轮截图。

本次不修改F/G工作树、B/I生命周期、A迁移或E断言；不重启十二实例、不增加持久preview、不重冻ce64、不花B/E旧预算。新增统计的installed字节、native成本与效率收益、业务恢复/private/target均未因此准入。D后继需在自有发行build/closure加入usage-insights；普通旧包缺此模块会诚实unavailable，不阻原服务启动。十位外部Agent继续原完整包，无需另派新轮。

可复用输入见[主线检查点](../../../agent-tasks/product-wave-27/main-observation-checkpoint.zh-CN.md)，机器状态见[status.json](status.json)。仍按十位外部开发者加主线架构/契约/集成的方式推进，检查点发布后继续各自大包。
