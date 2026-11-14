# F 包最终报告：试用入口与日常工作台体验

日期：2026-11-14 · 分支 `codex/g4-trial-experience` · 基线 main `fdb3f160b1d867f7167fb034d96a5c13bd16cdfb`

## 结果

四个可运行结果均已交付（F4 源码检查点 `8ffa083` 已推送，后续文档/测试合并入最终提交）：

1. **F4 早期组件**：`TrialWorkspace` 可直接被 main 接入，typed props 消费真实 `TrialReadiness` 与现有 `ApplicationConfiguration`，四个 `onAction` 导航回调，严格编译通过；状态矩阵、响应式、键盘、错误与测试装置同批交付。
2. **F8 真实输入**：组件经真实 `ConsoleTransport.readiness` 读取隔离产品演示的 `GET /v1/readiness`，页面值与直接鉴权 API 读取逐项一致；四个回调目标在**真实 App shell** 中被验证可达（模型设置、项目导入、执行器目录、主对话）。
3. **F12 日常工作台**：13 个受控状态 + 20 组浏览器断言在桌面 1440×900 与手机 390×844 成立；状态、动作、长文本、加载/重试/只读/未知与可选观察汇成一个入口。
4. **F16 交付**：组件、样式、hook、纯映射、单元/浏览器/HTTP 测试、5 份用户指南与本文；状态见 `wave25-status.json`。

## 真实输入与权威边界

| 项目 | 值 |
| --- | --- |
| 端点 | `GET /v1/readiness`（只读、鉴权、无 query）、`GET /v1/configuration`、`POST /v1/session` |
| 合同 | `packages/contracts/src/trial-readiness.ts`：`TrialReadiness`、`TrialNavigationAction` |
| 传输 | `apps/console/src/transport.ts`：`ConsoleTransport.readiness`（10s deadline、公共 schema） |
| 组件输入 | `readiness / loading / error / unavailable / configuration / activeProjectId / activeConversationTitle / insights` |
| 回调 | `configure_model`、`import_project`、`inspect_executor`、`open_conversation` |
| 授权 | `authorization` 恒为 `none`；组件不写配置/项目/数据库，不触发模型或命令 |
| 配置语义 | `configuration_present` 固定标注“配置事实，非连接验证”；fixture/unknown/readonly 分别呈现 |

组件没有私有 DTO、私有 HTTP client、第二条项目/会话目录或第二个确认 authority。`insights` 是展示输入；实际映射由 main/G 完成。

## 状态与动作矩阵（实现并测试）

| 观察 | 状态条 | 主动作 | 允许的次动作 |
| --- | --- | --- | --- |
| 模型未配置/服务异常 | 未配置/服务异常 | 配置对话模型 | 打开主对话；执行缺口时检查执行器 |
| 执行不可用 | 暂不可用 + 实际原因 | 检查执行器 | 打开主对话 |
| 执行状态未知 | 未知（琥珀，不用绿） | 检查执行器 | 配置对话模型（如未观察/未配置）、打开主对话 |
| 需要项目 / 零项目 | 需要项目 | 导入项目 | 检查执行器、打开主对话 |
| 固定流程 | 固定流程 + 非原生执行器 | 打开主对话 | 检查执行器 |
| 配置已具备 | 配置已具备 + 配置事实标注 | 打开主对话 | 无（保持克制） |
| 只读恢复 | 只读恢复 | 打开主对话 | 检查执行器；不出现导入/批准/恢复授权 |
| 尚未读取/接口未提供 | 未观察 | 打开主对话 | 检查执行器；不推断导入 |
| 读取错误 | 保留上次结果 + alert | 重试（重新读取） | 原有导航 |

## 设计与可访问性

- 继承 `apps/console/DESIGN.md` 与既有 surface brief：石墨导航、白色主区、青绿动作、细分隔线、平面分区；未改 `DESIGN.md`、根 CSS 或全局主题。
- 签名元素是顶部三段“准备状态条”（`<dl>`），与工作阶段条同族；无卡片网格、无嵌套卡片、无阴影、圆角 ≤ 8px（状态点为圆形）。
- 桌面 ≥961px 两列（项目｜执行器与能力），≤960px 单列，≤720px 状态条纵排、动作换行；按钮最小高 34px，图标 15–16px。
- 所有状态“圆点 + 文字”；未知为琥珀、固定流程为蓝灰、只读为琥珀、不可用为红。
- 键盘：Tab 顺序为刷新 → 主动作 → 次动作；`:focus-visible` 可见；Enter 触发一次；快速双击同一动作 300ms 内只导航一次；状态更新不移动焦点。
- 错误用 `alert`，加载/刷新/接口缺失用 `status`；图标按钮均有中文 accessible name；`aria-busy` 只在加载时。

**视觉验收方式说明**：本会话模型不支持读取图片，因此没有声称“已看截图通过”。交付的视觉门是浏览器内程序化审计（重叠、文字裁切、横向溢出、控件尺寸、圆角/阴影/transform、字号/字距、6 组色彩对比度 ≥4.5、语义圆点颜色取自 token），覆盖桌面与手机；17 张元素截图随仓库提交，供 E/人工独立审阅像素。

## 证据（本机实际运行）

`node e2e/trial/run-all.mjs` 串行 7 个套件全部 exit 0：

| 套件 | 结果 | 内容 |
| --- | --- | --- |
| unit-mapping | 10 项 PASS | 状态/动作矩阵、未知不绿、只读无导入、无 readiness 不猜测、insights 空态 |
| typecheck-app | exit 0 | 组件、hook、测试与现有 console 一起严格编译 |
| typecheck-e2e | exit 0 | 测试装置 + main 接线示例（真实 `ConsoleTransport` 类型）编译 |
| build | exit 0 | Vite 生产构建（组件样式随 bundle） |
| browser-states | 22/22 | 13 状态、回调、双击保护、键盘、桌面/手机、视觉审计、迟到响应、卸载后响应 |
| http-journey | 6/6 | 真实 readiness/configuration 与 API 逐项一致；请求预算 `session/readiness/configuration` 各 1；导航 0 请求；刷新只多 1 次 readiness；390px |
| app-targets | 6/6 | 真实 App shell：四个回调目标（含模型面板、导入表单、执行器目录、主对话） |

真实 HTTP 观察（隔离 fixed-fixture 演示）：`mode=fixture`、`development=fixture_only`、`discussion=unknown`、`projects 1/0/1`、`profiles native0 controlled4（已准入4）`、`authorization=none`、`configurationRevision=1c957869…`；UI 与其逐项一致，且页面不含私有 state 路径。

视口：1440×900（桌面）、390×844（手机）。浏览器：Chromium（Playwright 1.65）。截图：`apps/console/e2e/trial/screenshots/`（含 4 张手机与 1 张真实 HTTP 页面上下文，另有真实 App shell 截图）。

## 未测与依赖（不得外推）

- **App 挂载未完成**：`App.tsx` 属 main，当前 `workspaceView` 没有 `trial`；接线说明与可编译示例已交（`reports/trial-experience/main-integration.zh-CN.md`、`e2e/trial/integration-example.tsx`）。因此“真实 App 内点击试用准备”尚未发生。
- **G 未到**：`TrialInsightsView` 只是展示输入需求；没有真实 usage-insights 数据，未估算花费/节省/质量。
- **H/E/D 独立结论**：本包不证明安装包、原生准入、模型质量或发布；E 的 required 断言与 H 的观测不由 F 替代。
- **真实 vendor/model/native 调用 0**：没有运行 Codex、模型或 agent；HTTP 演示是 fixture profile。
- 未测：非 Chromium 浏览器、真实屏幕阅读器人工走查、200% 缩放/强制色彩、暗色主题（应用本身为浅色）、真实高延迟/断网（仅受控迟到响应）、大于 5 项目的极端配置。
- 视觉像素级审美判断留给 E/人工；本轮仅程序化几何与对比度门。

## 资源与环境

- 仅使用自有端口：5178（Vite）、5789（真实 HTTP 演示）、5292/8898（真实 App shell 目标验证）、5791（一次性 smoke，已停止）；每次启动前检查空闲，结束后确认无监听、无残留进程。
- 未触碰十二个保留服务 5180–5191 / 8796–8807、用户 `.local-state`、原生 profile、tar、ledger 或历史报告。
- 私有临时状态根位于 `/tmp/pa-f-*`（含演示凭据）；**未提交**，报告中只记录类别。
- 未修改 `App.tsx`、`transport.ts`、`main.tsx`、根/全局 CSS、contracts、HTTP/provider、根 lock 或其他 owner 路径。

## 已知限制（非阻断）

- 讨论模型状态为 `unknown` 时主动作是“打开主对话”，模型设置作为次动作；这是刻意避免把未知当缺口。
- 功能入口（上下文历史/来源/决定/提案）圆点来自配置开关，文案已注明“不代表已实际运行或通过验收”。
- 项目行不可选择；项目/会话选择仍走既有导航，组件不制造第二套路由。
