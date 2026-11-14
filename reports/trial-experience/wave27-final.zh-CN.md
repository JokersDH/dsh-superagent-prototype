# F 包 wave-27 最终报告：身份稳定的日常体验、两项目闭环与草案预览

日期：2026-11-14 · 分支 `codex/g4-trial-experience` · 基线 main `ca01e17`（已合并），main 实际 App `967dc0c`，本包最终源码提交 `d6823f2`（之后仅有文档/状态更新）。

## 五个结果

1. **身份稳定的真实入口（F1–F4）**：main 已用 `{ enabled, identity }` 接实际 App，`identity` 随 transport/auth 生成。本轮补充同一 transport 内 identity 变化的隔离测试：旧观察立即隐藏、旧请求取消、只读新身份一次；A 的迟到响应不会填进 B。`enabled` 在请求途中关闭不再留下永久 loading。main 真实 App 测试在本包改动后重跑 **8/8 PASS**。
2. **两个项目日常闭环（F5–F8）**：私有真实 runtime、两个本地 Git 项目、两个真实会话、controlled fixture 执行。Alpha 完成委托 → 原生权限问题 → 回答 → PASS 验证 → 证据 manifest/4 artifacts → 接受；Beta 完成委托 → PASS → 接受；两轮后试用准备显示正确项目/会话，未发送草稿保留。全程模型 0，页面 POST 只有 `/v1/commands`（工作/回答/接受）与既有 review-activity 计时；未出现隐藏写。
3. **J 配方草案只读预览（F9–F12）**：新增 `recipes.ts` typed consumer。草案按当前项目过滤；缺项目、缺输入、未注册检查、执行器未准入/缺失、非 `authority:none`、非 draft 都禁用并逐条说明；长文本有界显示。`onPrepareRecipe` 是可选数据回调，只交回原表单，不发请求、不创建 Work、不运行脚本；同一草案 300ms 内只回调一次。J/main 尚未接入，默认产品不显示。
4. **G 可信范围与移动体验（F13–F16）**：观察区要求 `scope.projectIds`、`windowLabel`、`coverage`；范围不含当前项目、缺声明、`truncated` 却宣称 complete 都拒绝展示。`sources.known/unknown`、`coverageState=partial`、`null` 未知、layer/currency 分列；不合计币种或层。移动 390、键盘、长文、错误与 late/identity 同批验证。
5. **指南与交接（F17–F20）**：用户指南更新到真实入口、每日流程、配方草案、观察范围与错误处理；包内交接列七个运行源文件、CSS/依赖方式与禁止打包目录；状态与证据在 `wave27-status.json`。

## 证据

`node e2e/trial/run-all.mjs`：**10/10 套件 exit 0**

| 套件 | 结果 |
| --- | --- |
| 纯映射/配方/文案 | 16 PASS |
| strict（App + e2e）与 build | exit 0 |
| hook 身份/异步 | 7/7 |
| 浏览器状态（含 recipes/insights） | 27/27 |
| 真实 HTTP readiness | 6/6 |
| 真实 App 四目标 | 6/6 |
| 两项目导入/草稿 | 8/8 |
| 两项目委托/问答/证据/接受 | 5/5 |

main 自有真实 App 测试：8/8，`pageerrors 0 / readinessReads 14 / POST 0 / model 0 / eventDelta 0`。

视口：1440×900、390×844。截图在 `apps/console/e2e/trial/screenshots/`（新增 recipes、insights-partial、daily-alpha/beta、two-projects 等）。视觉门是程序化几何/对比度审计；本会话不能读图，**未做像素级人工判断**，截图供 E/人工复核。

## 发现与如实记录

- 受控每日流程里出现 2 次 `/v1/works/:id/review-activity` 409 console 冲突。这是 main 的审阅计时遥测在受控流程中的既有行为，未影响工作/证据/接受；已作为 main-owned 观察记录，不计入 F UI 失败，也没有改 main 代码。
- 两个项目的检查/执行器均为固定流程；页面写“固定流程/非原生执行器”，未把 164 required/238 PASS 的 ce64 普通安装结论外推到本轮 UI。
- `identity` 只是 UI 观察键；切换 transport/auth 时 main 必须更新 identity 或 remount，F 不推断 token、项目名或私有路径。
- J 与 G 都未进入默认产品：F 只有 typed consumer、fixtures、准入门和准确未提供状态。

## 未达

- 真实 vendor/model/native 调用 0；固定流程 scratch 写入不是原生或安装包证明。
- 安装包/E 最终同包验收、非 Chromium、人工屏幕阅读器、真实服务端会话中途过期未测。
- J 的 `packages/project-recipes/` 与 G 的 Node→F 适配尚未由 main 接入；对应 UI 段落默认不显示。

## 资源与所有权

- 仅改动五个自有路径；`git diff --name-only origin/main...HEAD` 已核对。未编辑 App/transport/根 CSS/contracts/HTTP/授权。
- 私有端口/临时根均在 `/tmp`，测试后清理；十二用户实例、state/profile/tar/ledger 未触碰。
- 所有 waits 有界，未做全局进程扫描或真实 CLI 回退。

完整字段见 `wave27-status.json`。
