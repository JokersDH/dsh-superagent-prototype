# Wave24主线：来源范围说明与只读审阅帮助

源码 `4b42a9001c4040aa6c87c1c6056056d04ea1e9af`，范围见 [0062](../../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md)。用户打开消息来源仍读默认冻结正文，明确点击范围按钮才发opt-in GET；四正文状态、七类原因、正数遮蔽数量和失败/暂不可用/重试已接真实界面。身份、scope、receipt及正文规则由原后端决定，诊断不授权。

组件按完整消息身份隔离，旧响应不能覆盖新记录；失败诊断不覆盖已读正文；范围按钮保留键盘焦点，结果区域polite播报。使用impeccable按现有精密工作台做窄范围实现，DESIGN已记录。桌面1440×900和mobile390×844两批以内截图确认，无文本溢出或重叠。

实际生产A Store/HTTP/React/Playwright最终 [13场景报告](browser-final/browser-report.json) 全通过，sourceWorktreeClean=true；4传输+1CLI帮助测试、console strict/build通过，浏览器错误0、读取新增mock回复0。第一批dirty12场景与截图保留在browser，未贴成最终clean结果。独立狭窄review无实质问题，延迟切记录已补专项测试。

D最小help片段补全`--help/-h/help review-restored/命令--help`，五路径窄测试不创建私有根或调用执行器。没有新迁移、SQL writer、原生/模型、target、私有许可或用户服务重启；A新manifest/B新channel/Cpackage driver/Dlive工具未准入。旧安装包结果不贴本轮新UI。

状态见 [status.json](status.json)，最终截图：[桌面](browser-final/scope-desktop.png)、[手机](browser-final/scope-mobile.png)。[下一主线任务](../../../agent-tasks/product-wave-24/main.zh-CN.md) 继续真实安全attach消费与同包产品收口；A–E按 [转发话术](../../../agent-tasks/product-wave-24/forward-prompts.zh-CN.md) 执行。

现有 [本机工作台](http://127.0.0.1:5191/) 首页与当前ContextSources模块均只读检查200，模块已含新按钮；未重启或重新配置服务，不据此授backend/native/installed准入。任务静态校验通过：六owner、60阶段、33依赖节点、164本地链接，无循环或拥有路径冲突；JSON与diff检查通过。
