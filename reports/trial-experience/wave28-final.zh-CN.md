# F 包 wave-28 最终报告：项目内建议、两项目交付与真实观察

日期：2026-11-15 · 分支 `codex/g4-trial-experience` · 基线 main `ea82d8f`（已合并，含 18f/623 真实观察），本包最终源码提交在 `wave28-status.json` 记录。

## 六个结果

1. **项目内建议适用性（F1–F4）**：草案不再只按全局 ID 相等判断。必须存在并选中当前项目、草案属于该项目、检查在该项目 `defaultCriteria` 且全局已注册、执行器绑定到该项目且已准入、声明范围原子已在项目范围内（`src/app/` 不会被当作 `src/`）。unknown 来源、未声明项目、删除项目、跨项目、全部项目视图都只解释、不启用“准备草案”；`declared=false` 且 required 的检查明确报“声明与项目检查矛盾”。
2. **两项目实际日常闭环（F5–F8）**：真实 App + 两个本地 Git 项目 + controlled fixture。Alpha 完成委托 → 权限问题 → 回答 → PASS → 证据 manifest/4 artifacts → 人工接受；Beta 完成委托 → PASS → 接受。两项目各自会话与草稿保持；整页重开后已交付工作与证据仍在且不重复，未发送的内存草稿不会被伪造保留。
3. **J 建议到原确认（F9–F12）**：新增 `TrialRecipeDraft`，携带完整预填字段（goal/projectId/scope/criteria/profileId/source/authority=none）。预览直接显示项目、范围、执行器、检查；`onPrepareRecipe(draft)` 只回调，不请求、不创建、不执行；main 需用当前配置重新核验后预填原 NewWorkForm，用户仍在原确认页确认。取消/编辑由 main 决定。
4. **真实观察（F13–F16）**：main 18f 的 `GET /v1/insights` 已接试用准备（7 天、当前项目）。F 消费其 `scope/window/coverage/coverageState/sampleCount/unknownCount/metrics(unit,currency,layer,sampleCount,detail)`；准入门继续拒绝缺范围/窗口/覆盖、范围不含当前项目、truncated 却宣称 complete。新增可选 7/30 天分段控件与 `insightWindow/onSelectInsightWindow/insightsLoading/insightsError/onReloadInsights`：窗口不一致时先隐藏旧数字，切换只回调 main，不在浏览器发请求。
5. **精密工作台与移动键盘（F17–F20）**：局部 `trial-*` token、紧凑表头/按钮、长中文与路径换行；桌面与 390px、键盘、错误/加载/只读、recipe 与 insights 同批审计，控件高度 ≥34px、无横向溢出。
6. **指南与交接（F21–F24）**：用户指南更新到真实 7 天观察、项目内建议规则、两项目日常与重开行为；交接列七个运行源文件、完整 draft 字段、必须由 main 重新核验的边界、禁止打包目录；source/controlled/installed/native/value/activation 分层写明。

## 证据

`node e2e/trial/run-all.mjs`：**10/10 套件 exit 0**——纯映射/草案 18、hook 身份/异步 7、浏览器状态 30、真实 HTTP 6、真实 App 四目标 6、两项目导入/草稿 8、两项目委托/问答/证据/接受/重开 6，加上两套 strict 与 build。视口 1440×900 / 390×844。

main 自有测试在本包改动后重跑：
- `trial-workbench-browser.mjs` **8/8 PASS**
- `usage-observation-browser.mjs` **6/6 PASS**（项目范围、late 旧项目响应、503 保留上次观察、404 隐藏整段）

如实记录：受控每日流程仍有 2 次 main-owned `/v1/works/:id/review-activity` 409 遥测冲突，不影响工作/证据/接受；未改 main 代码。

## 分层与未达

- **source**：组件/测试/文档已交付。**controlled**：两项目 fixed-fixture 流程与观察 fixtures 已实际运行。**installed**：D/E 的准确 tar/bundle 未验（NOT_REACHED）。**native/vendor/model**：0。**value/activation**：未涉及。
- J 的 project-recipes 模块与 main 的 recipes 预填接线仍未进入默认产品；30 天窗口需 main 把 `useUsageObservation` 的 `days` 变成状态并传回调（F 只提供控件与隐藏规则）。
- 安装包/E 最终同包验收、非 Chromium、人工屏幕阅读器、200% 缩放/强制色彩、真实服务端会话中途过期未测。
- 本会话不能读图，视觉门是程序化几何/对比度审计；截图供 E/人工复核，未做像素级人工判断。

## 资源与所有权

只改 `apps/console/src/trial/`、`test/trial/`、`e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/`；未编辑 App/transport/根 CSS/contracts/HTTP/授权。临时根与端口已清理，十二用户实例、state/profile/tar/ledger 未触碰；所有等待有界。

完整字段见 `wave28-status.json`。
