# Wave26主线：试用准备进入真实工作台

源码a302ddc1963e9d20ada2cbba4f5cf317f041e78f，见 [0066](../../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)。按Ffad070f原字节导入六个trial源和一个测试；main接App导航、按auth/可见性hook、四原导航和导入guard。默认主对话与旧草稿保持，G指标/H工具不导入。

最终 [干净source八场景](browser-final/browser-report.json) 覆盖实际App/HTTP/SQLite：按需readiness、原模型/导入/执行器/会话动作、草稿、刷新失败/坏schema、legacy optional absence、readonly/fixture、desktop/mobile/焦点。POST/model/event增量0、页面异常0，12项纯映射/传输和strict/build通过。独立窄review未见实质问题。

截图：[桌面](browser/desktop.png)、[手机](browser/mobile.png)，为与最终相同UI字节的提交前捕获；首报告保留dirty标记，提交后只复验不重复截图。未见横向溢出或导航重叠。一次detector有13条字号/局部颜色advisory，DESIGN已记，旧sidecar不修；真实屏幕阅读器和跨backend transport身份仍未测。

初次测试报告器在Store关闭后读取cursor的收尾错误已修，未改产品行为/守卫。没有新contracts、依赖、迁移、模型/原生、私有许可、target或旧用户服务重启；不认证新安装包、B恢复或G/H。当前状态见 [status.json](status.json)。

[下一主线包](../../../agent-tasks/product-wave-26/main.zh-CN.md) 继续同包体验和可靠交付；A–H按 [转发话术](../../../agent-tasks/product-wave-26/forward-prompts.zh-CN.md) 执行16阶段/四完整结果。

现有 [5191页面](http://127.0.0.1:5191/) 与App模块只读检查200，模块含新入口，但后台readiness仍404，属于旧实例版本；未暗中升级/重启。完整新数据流程以上述隔离真实后端证明，D/E下一准确新包再收口。派工静态核九目录/分支、144阶段、46依赖节点、184本地链接与明确trial路径转授通过，无循环/写入冲突，JSON/diff检查通过，不授发布准入。
