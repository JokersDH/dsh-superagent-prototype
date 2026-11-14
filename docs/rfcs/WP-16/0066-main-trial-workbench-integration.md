# 0066：F接入体验已进入真实App

2026-11-14。最小导入F固定 `fad070fb1d0a7586ac1059dd7aacba0d869e9658` 的六个trial源文件和一个纯映射测试，原字节保持，CSS由组件import，不增依赖。main负责App导航、hook可见性和四个既有操作组合，未改F组件源或全局CSS。

## 实际用户入口

默认主对话保持；导航增加带tooltip/可访问名称的“试用准备”。只有认证ready且用户打开此视图时才调用已有 `ConsoleTransport.readiness`。面板接真实readiness/configuration/current conversation/project，只报告配置、项目、执行器和已有功能，不自动探测/派工或调用模型。

四个回调分别打开原模型设置、原项目导入表单、原执行器目录和原主对话。导入先执行openView关闭旧抽屉，再打开原表单/工作列表，避免回调把表单抽屉关掉；旧后端无registerProject或当前只读时准确拒绝该导航，不创建另一project writer。配置、派工、问题和接受仍走原可信命令入口。

Conversation保留mounted以保持草稿。readiness失败保留有效观察，legacy optional absence不猜native ready；readonly/fixture使用真实HTTP配置守卫。main没有给组件传G指标，因此尚未准入的统计不进入默认产品；H工具亦未导入。

## 源码与验证

导入 `apps/console/src/trial/{index.ts,TrialWorkspace.tsx,useTrialReadiness.ts,trial-view.ts,insights.ts,trial.css}` 与 `apps/console/test/trial/trial-view.case.ts`。main只改App组合，新增真实应用级 `tests/integration/trial-workbench-browser.mjs`，既有合同/传输不变。

纯映射10、既有readiness transport2、console strict和生产build通过。实际App/HTTP/SQLite/React/Playwright八场景通过：默认视图/按需GET、四原动作、原草稿、失败/坏schema重试、旧接口、readonly/fixture、桌面/手机/焦点/布局。POST/model/event增量均0；独立窄review无实质问题。最终源码与clean-run报告见integration状态。

桌面1440×900、手机390×844截图已人工检查，五个导航图标不重叠、没有横向溢出。impeccable context/已有brief/craft floor及一次机械detector完成，13条皆字号/局部中性颜色advisory，无阻断；DESIGN记录实际组合，旧sidecar不顺带重生。首次报告器在关闭Store后读取cursor的测试收尾问题已修，未改产品守卫。

## 准入范围

只覆盖本次源级实际App导航/只读体验。真实登录中途过期、同实例更换transport的跨backend隔离、snapshot/daemon恢复、原生执行、新安装包独立E验收均未在该浏览器场景证明。当前生产transport为稳定实例，不把F hook缺transport identity依赖外推成已验证能力。

F仍拥有trial子树，main保留App/transport/全局样式/HTTP/授权；后续F在该真实App上继续用户journey和copy/token边界。新运行字节先由D准确freeze再E验；不能把旧3b/a826或独立F harness贴作本次installed结论。十二用户服务、state/profile/tar/ledger、所有native预算保持，真实vendor/model/native0。
