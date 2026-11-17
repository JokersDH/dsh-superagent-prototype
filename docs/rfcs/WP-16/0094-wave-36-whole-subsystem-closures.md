# 0094：完整子系统长任务与四条端到端交付线

2026-11-17。用户继续要求任务更大、减少交互。本轮不把旧九项机械增加为十二阶段，而是每位一个whole-subsystem goal，四条更大的端到端产品交付线，覆盖原九项与默认消费者、同版本集成、维护交接。原验收点不清零，SOURCE_READY不自动算完整工程完成。读[本轮总览](../../../agent-tasks/product-wave-36/README.zh-CN.md)与[0093实测边界](0093-wave-36-reviewed-architecture.md)。

## 连续推进

早/中/终交可运行源码，main持续审入实际consumer，随后继续整个子系统和独立队列；不在一个fix/报表/green停工等新任务。外部依赖只阻相应项，交最小实际port/RFC后做其他已授权工程，不复制另一owner的server/ledger/状态机。无同日/时长/工时/token承诺，不用重复长soak填执行时间。

## 四条交付线

| Owner | 一 | 二 | 三 | 四 |
| --- | --- | --- | --- | --- |
| A | 正式历史/原bytes | 两格式授权非空恢复 | 日常查询/同对象故障读回 | main/同版本正式模块维护 |
| B | 原factory/callback/currentcontrol | 原Work/Broker正常交付 | 同Work故障/原2&4资源 | 非空重启/版本诊断交接 |
| C | canonical选定binding/sync治理 | 原create事务/持久ref | 来源治理/draft重开 | 默认API/UI/同版本维护 |
| D | 同安装双原项目/模型配置 | 非空当前target管理操作 | MacM同事私有配置/搬迁 | 唯一closure/runtimeidentity/E交付 |
| E | query UNKNOWN/全集合signal-release | 同cohort全原项目oracle | 非空迁移/当前upgrade/授权held | 独立tier/重复日常维护 |
| F | 多项目日常/错误草稿 | 原证据/新分类历史/决定 | 已接配置完整生命周期 | 访问质量/支持/准确版本 |
| G | 可信当前安装身份 | 观察/严格诊断/人工代理 | 真实反馈到定位复验 | operator/CLI/同版本支持 |
| H | exact默认consumer/正确接受 | 同Work问答故障/原槽证据 | 非空field支持/诊断 | 准确安装重复日常/E交接 |
| I | solechannel lease/guard/RPC | 真实launch返回callbacks | unknown继任/durableACK | bounded背压/版本协同维护 |
| J | 原配置/metadata/明确委托 | 原项目检查修复/交付 | 非空重识别/新授权 | 正式模块/同事工具维护 |
| main | 原run/Broker/原恢复 | history/决定/项目实际确认 | 已交配置/日常支持体验 | 稳定版本/数据/独立交付 |

四条线各要生产实现、默认实际consumer、必要正负和同版本维护；不是四个helper或四组测试。具体包和旧九点映射在dispatch及每位任务书，ownership沿原目录互斥。

## 已供给的输入与依赖

main0092已给A strict三kind metadata/HMAC/128KiB→真实原WorkDetail；旧timeline不重命名、F旧panel不直接吃新协议。原model-save/support/attachCallbacks已供给，不能再等虚构data port。B终态physical finalize兼容和C sync治理正确性先修才能准入相应默认路径。

W35全量静态已通过且main wrapper允许集已更新，E锁准确包独立结果；当前upgrade无成功receipt就HELD，不借W33。必要history后继先D稳定freeze→Efinal，docs/test-only不重包、不追移动main。普通产品闭环不等活动恢复/blocked研究，未测部分保持未达。

## 同一事实源与结束条件

状态沿各owned reports/wave36-status，写完整source/dirty/原IDs/actual consumer/命令exit/余项。source、受控、安装、当前运行、native、恢复和收益分别计；accepted row、人工标准验收、整体Outcome各按原事实。失败保留，新结果追加，不改旧FAIL或凭形状补证。

全部四线及原九验收点闭合才结束整goal；有独立工程可推进就继续，不在候选源码自报完成。跨owner只能消费稳定接口/RFC，main持续集成；A sole迁移、E sole oracle、I sole通信，B排除I/main排除Ftrial。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花/E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price-recipe研究。原十roots/branch/dirty、12服务及state/profile/tar/ledger/runs/五日志保持。originalspawn私有不可变birth/PID/start/UID/orderedargv/root/config/op/全resources先验、逐signal fresh；UNKNOWN保留，不全局发现/substringkill/绕拒绝清理/真实CLI回退。完整B/CAC后置，无新Driver/desktop/autoaccept/writer racing/dynamicDAG/第二生命周期；只推origin/main HEAD:main，neverupstream/reset。四线数量不提高stable76/100或当前B58.6%。
