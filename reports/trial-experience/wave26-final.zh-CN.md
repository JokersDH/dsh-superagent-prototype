# F 包 wave-26 最终报告：真实试用工作台与日常流程

日期：2026-11-14 · 分支 `codex/g4-trial-experience` · 基线 main `6787bd0`（已合并），真实 App 接线 `a302ddc`，本包最终源码提交 `dac5577`（之后仅有文档/状态更新）。

## 结果概要

四个可运行结果均在本轮真实 App / 真实 runtime 上完成：

1. **实际挂载后的可靠入口**：main 已导入 F 六源并接线；本轮修复 hook 的 transport 身份边界、禁用中途 loading 泄漏、身份切换时的旧数据覆盖，并补“当前项目”事实行。main 自有真实 App 浏览器测试在本包改动后重跑 **8/8 PASS**。
2. **两项目日常旅程**：私有真实 runtime 上，真实导入第二个 Git 项目（`POST /v1/projects`），两个真实会话、两份未发送草稿、委托草稿、项目/会话/草稿身份全部保持；页面只发 `/v1/projects` 这一次写请求，模型 0、命令 0。
3. **可选观察的安全接入**：观察区准入要求声明项目范围、观察窗口、覆盖；缺失/空范围/范围不含当前项目/样本不足/不可用都不展示指标，`null` 保持未知，币种与层分行不合计。移动/键盘/长文/错误/迟到响应一并验证。
4. **当前用户指南与交接**：五章正文更新到真实入口（新增帮助交接为第六章），移除“用 harness 试用”的旧指引；包内交接清单明确哪些是运行源码、哪些测试/截图不得进产品包。

## 真实挂载与回归（F1/F4）

- 入口：导航“试用准备”；认证 ready 且视图可见才读取 `GET /v1/readiness`。
- 默认主对话与草稿保持；四回调打开原模型设置、项目导入（先关抽屉再开表单）、执行器目录、主对话。
- 审计记录：`f1-real-app-audit.zh-CN.md`（含 App.tsx 行号与 8 项修正清单）。
- main 测试重跑：8/8 PASS，`pageerrors 0 / POST 0 / modelCalls 0 / eventDelta 0 / readinessReads 14`。

## Hook 身份与异步（F2）

`useTrialReadiness(transport, boolean | { enabled?, identity? })`：

- `identity` 变化：立即隐藏旧观察、取消旧请求、读取新服务一次；A 的迟到结果不会显示成 B 的状态（双向验证）。
- 不传 identity：保持现有 main 调用；约定同一活期内实例稳定，替换需 remount。
- 修复：`enabled` 在请求途中变 false 时 loading 立即结束；迟到响应忽略；重新启用只发一次。
- inline 对象 props 连续重渲染不产生请求循环。
- 只读：一次显式加载/刷新一请求，无轮询、无命令、无模型。

证据：`report-async.json`（6/6），含身份 A→B→A、迟到响应、inline、禁用中途、认证过期保留上次观察。

## 两项目日常旅程（F5–F8）

私有真实 runtime：两个本地 Git 仓库、两个真实会话（`conv-alpha-daily`、`conv-beta-daily`）、execution unavailable、对话模型为 no-send stub。

实际执行：

- 默认会话不被替换；打开试用准备前 readiness 读取 0 次。
- 会话 A 输入草稿 → 切会话 B 草稿为空 → 切回 A 原稿仍在 → 切回 B 原稿仍在（按 conversationId 保留）。
- 项目筛选选 Alpha；试用准备显示“项目 Alpha / Beta 每日会话”；来回试用准备两次，草稿保持，每次打开 readiness 恰 1 次。
- 通过真实导入表单导入 Beta（`POST /v1/projects` 1 次），草稿保持；取消自动打开的委托草稿。
- 试用准备显示两个项目，Beta 为“当前”；执行状态“暂不可用 · 开发执行已关闭”，不伪装就绪。
- 新建委托草稿可编辑但因无准入执行器保持禁用；取消后无 POST，会话草稿仍在。
- 检查执行器往返后项目/会话/草稿仍正确；页面 POST 仅 `/v1/projects`，模型 0，浏览器错误 0。

证据：`report-two-projects.json`（8/8）、`screenshots/two-projects-trial.png`、`two-projects-page.png`。

## 观察区准入（F9–F12）

- 未传 insights：整段不渲染（当前 main 即如此），核心流程完全可用。
- `status=insufficient_data/unavailable`：只给说明，无指标。
- 缺少 `scope` / 空 `projectIds` / 缺窗口 / 缺覆盖：明确“暂不展示指标”，不显示完整的假象。
- 摘要范围不含当前项目：拒绝展示，并保留当前项目身份。
- 合法 scoped summary：展示范围名、聚合方式、未知数量、窗口/覆盖；`null` 显示未知；单位/层分行（受控/原生/界面观察/人工输入），不合计币种或层；限制逐条列出。
- 纯逻辑 11 项 + 浏览器 24 项覆盖；错误/空态/长文本/移动与键盘同批验证。

## 可访问性、移动与长文（F14）

- 状态条 720px 以下纵排；动作换行；390×844 无横向溢出（8 个状态实测）。
- Tab：刷新 → 主动作 → 次动作；焦点可见；刷新中控件保持可聚焦（aria-disabled + 守卫），不抢焦点。
- 状态永远圆点+文字；unknown 琥珀、readonly 琥珀、不可用红、固定流程蓝灰；错误 `role=alert`，加载/缺失 `role=status`。
- 程序化视觉审计（重叠/裁切/溢出/控件尺寸/圆角阴影/字号字距/6 组对比度）通过；**本会话无法读图，未做像素级人工判断**，截图供 E/人工复核。

## 文档（F13）

- `docs/user-guide/README.zh-CN.md`：入口、能力矩阵、边界；试用准备标为已接入。
- `01`：启动/模型/执行器区别、试用准备入口；不再教用户使用测试装置。
- `02`：项目导入、当前项目/会话、主对话与委托。
- `03`：状态条、当前项目/会话、四动作、加载/错误/只读、观察区准入、键盘/手机。
- `04`：按症状处理，新增“范围/窗口/覆盖被隐藏”“当前项目/会话不对”。
- `05`：审阅/接受/交接，证据指向 wave26。
- `06`：帮助与交接材料（收集什么、不要发什么、谁能处理什么）。

## 包内交接与错误边界（F15）

- 运行源码仅六文件；CSS 由组件 import；无新依赖/根 lock 改动。
- 明确禁止打包 `e2e/trial/**`、`test/trial/**`、harness/fixtures/截图/临时状态；安装包存在与否看真实 bundle 与导航，由 E 对同一 artifact 独立验。
- 错误边界覆盖：认证过期（保留上次观察、有限文案、无原始 stack/path/token）、storage/无效请求/schema/unsupported 映射、旧接口 404、坏 schema（main 测试）、迟到响应、禁用/卸载。
- 所有测试使用私有端口/临时根并清理；未操作十二用户实例、state/profile/tar/ledger。

## 未达与依赖（不得外推）

- G 完整指标仍未准入：观察区只有准入校验与 fixtures，没有真实统计；不宣称效率收益。
- 真实 vendor/model/native 0；两项目旅程是 execution-unavailable + no-send stub，不是原生或交付验收。
- 安装包/E 最终同包验收、非 Chromium、人工屏幕阅读器、200% 缩放/强制色彩、真实服务端会话中途过期未测。
- 跨 transport 替换需 main 传 identity 或 remount；当前稳定实例接线无需改动。

## 命令与退出码

```sh
cd apps/console
node e2e/trial/run-all.mjs        # 9/9 suites exit 0（unit11 / async6 / states24 / http6 / app-targets6 / two-projects8 + 两套 typecheck + build）
node --test test/trial/trial-view.case.ts
npx tsc -p tsconfig.json --noEmit
npx tsc -p e2e/trial/tsconfig.json --noEmit
node ../../tests/integration/trial-workbench-browser.mjs --output <tmp>   # main App 8/8 PASS
```

完整字段见 `wave26-status.json`。
