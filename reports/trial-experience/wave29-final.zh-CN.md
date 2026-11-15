# F 包 wave-29 最终报告：当前状态下可用的模板入口与日常体验

日期：2026-11-15 · 分支 `codex/g4-trial-experience` · 基线 main `79525b6`（已合并，含 0073 原表单模板与 18f 真实观察），本包最终源码提交在 `wave29-status.json` 记录。

## 六个结果

1. **当前状态下可用入口（F1–F4）**
   修复两个展示 P2：`dispatchAllowed=false` 的项目即使执行器已准入也不再 applicable；声明遗漏项目原始排除项时不再产生选择。现在项目必须存在且被选中、可派工、非讨论项目、未过期；排除项必须全部保留（可增加、不可遗漏），allow/external 只能收窄，`expiresAt` 不被延长。未知来源、跨项目、删除项目、全部项目视图仍只解释、不启用。

2. **两项目实际日常（F5–F8）**
   真实 App + 两个本地 Git 项目 + controlled fixture：Alpha 委托 → 权限问题 → 回答 → PASS → 证据 manifest/4 artifacts → 人工接受；Beta 委托 → PASS → 接受。两项目会话与草稿保持；整页重开后已交付工作与证据仍在且不重复，未发送的内存草稿不会被伪造保留。

3. **建议到原表单（F9–F12）**
   F 不再构造 goal/scope/criteria/profile 草稿，只回调 `TrialRecipeSelection {suggestionId, projectId, kind, allowedPaths, profileId}`。main 0073 的原 NewWorkForm 负责真实 `POST /v1/projects/:id/recipes/preview`、完整字段、编辑 goal、应用草稿、配置/facts 变化重验、原 commandId 重试与原 `create_work` 确认。F 的 applicable 只是展示判断，不是授权。

4. **真实观察（F13–F16）**
   main 18f 的 `GET /v1/insights` 已接试用准备（7 天、当前项目）。F 展示 scope/window/coverage/coverageState/样本/未知/层/币种；准入门拒绝缺范围/窗口/覆盖、范围不含当前项目、truncated 却称 complete。7/30 天分段控件与 `insightWindow/onSelectInsightWindow/insightsLoading/insightsError/onReloadInsights` 已提供；窗口不一致先隐藏旧数字，切换只回调 main。

5. **精密工作台与移动键盘（F17–F20）**
   局部 trial token、紧凑表头/按钮、长中文与路径换行；桌面与 390px、键盘、错误/加载/只读、recipe 与 insights 同批审计，控件高度 ≥34px、无横向溢出。

6. **指南与交接（F21–F24）**
   用户指南写明项目内规则、blocked/expired/exclusion 处理、受限选择与原表单确认、7 天真实观察；交接列七个运行源文件、`onOpenRecipe` 最小接线、必须由 main/J 负责的完整字段与重验、禁止打包目录；source/controlled/installed/native 分层。

## 证据

`node e2e/trial/run-all.mjs`：**10/10 套件 exit 0**——纯映射/项目内选择 19、hook 身份/异步 7、浏览器状态 31、真实 HTTP 6、真实 App 四目标 6、两项目导入/草稿 8、两项目委托/问答/证据/接受/重开 6，加上两套 strict 与 build。视口 1440×900 / 390×844。

main 自有测试在本包改动后重跑：
- `trial-workbench-browser.mjs` **8/8 PASS**
- `usage-observation-browser.mjs` **6/6 PASS**
- `project-recipes-browser.mjs` **6/6 PASS**（previewPosts 13、两模板工作到原候选/人工接受、错误/legacy 回退、桌面手机）

如实记录：受控每日流程仍有 2 次 main-owned `/v1/works/:id/review-activity` 409 遥测冲突，不影响工作/证据/接受。

## 未达与分层

- **source** 已交付；**controlled** 两项目 fixture 与 main 0073 模板流程已实际运行；**installed** D 1ba 只有统计、没有 J/模板，E 的准确包验收 NOT_REACHED；**native/vendor/model** 0；**value/activation** 未涉及。
- main 仍需把 `onOpenRecipe` 的受限选择接到原 NewWorkForm 的初始模板模式；F 不修改 App，也不直接 POST。
- 30 天真实观察需 main 把 `days` 变成状态并传回调；F 只提供控件与旧窗口隐藏规则。
- 安装包/E 最终同包验收、非 Chromium、人工屏幕阅读器、200% 缩放/强制色彩、真实服务端会话中途过期未测。
- 本会话不能读图，视觉门是程序化几何/对比度审计；截图供 E/人工复核。

## 资源与所有权

只改 `apps/console/src/trial/`、`test/trial/`、`e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/`；未编辑 App/transport/根 CSS/contracts/HTTP/授权。临时根/端口已清理，十二用户实例与 state/profile/tar/ledger 未触碰，所有等待有界。

完整字段见 `wave29-status.json`。
