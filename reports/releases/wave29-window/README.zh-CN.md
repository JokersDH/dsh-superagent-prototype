# 工作台7/30天窗口实际接线

2026-11-15，source `84b34c2507159526e519e793750f5f7127707bc8`。沿wave29 main M9继续，没有新增派工轮次。原GETinsights本来支持7/30，本轮把App选择、useUsageObservation身份/配置/project/days/timezone隔离、F窗口/加载/错误片段接成实际用户操作。范围切换立即隐藏旧行，abort/额外schema及范围核对阻止旧结果误写；同范围失败才保留上次观察。

F输入固定f7d80b9a3c31c47ef97cbb1c8031d64f27a2135f，只取window/error/loading/admission/CSS片段，保留主线原work样本header、selected可focus且重复选择无额外GET；没有引recipes.ts或模板建议，也没有修改F候选工作树。G分析/原backend/SQL/contracts/根lock没有改。详见[0076](../../../docs/rfcs/WP-16/0076-main-observation-window-controls.md)与[交接输入](../../../agent-tasks/product-wave-29/main-window-checkpoint.zh-CN.md)。

验证：15条纯state/admission/两个transport通过，console strict/build通过，main目标机械扫描无发现，既有bundle>500KB提示保留。独立窄review未见实质阻断。准确干净source[实际App9场景](clean-browser/browser-report.json)覆盖服务端rolling168/720小时、keyboard重复选择无读、old-window行即时隐藏/晚回拒绝/new-window失败不复用olddata+重试、项目隔离、同key dated错误、legacy和desktop/mobile；pageerrors0，POST/event增量0，模型/native0。

已查看[桌面](clean-browser/desktop.png)/[手机](clean-browser/mobile.png)，当前窗口清楚可读、两项可聚焦，长覆盖说明不挤短标题，未见横向溢出。首次修改中截图在browser目录，最终clean截图单独保存，不修改旧报告标签。

原[模板实际用户流6场景](recipe-regression/browser-report.json)也在同一source独立通过，含服务端已创建后丢响应、同ID重试只有一个Work、两明确创建/两人工接受。模板业务动作与只读统计的0POST/0event结论分开，均是私有controlled fixture，不是恢复/native/installed准入。

这批数据只有当前三条受控工作，不声称真实操作者30天历史或已证明效率收益。没有新model/native配额、持久preview、旧十二服务重启或新tar；D/E后续准确运行字节freeze/验收，其他十位继续原整包。本轮M9完成不等于main24阶段whole goal完成。
