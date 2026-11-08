# WP-11 首版报告：可操作工作台（fixture 级）

- **分支**：`codex/g2-workspaces-verification`（wave-02）
- **范围**：`apps/console/`、`docs/rfcs/WP-11/`
- **结论**：浏览器内可实际操作主对话、委托、问题、派工与当前候选验收；实时/恢复/离线/窄屏场景通过 fixture 级 Playwright。真实产品 HTTP/SSE、生产 Catalog 与原生 Driver 均未接线，**NOT_TESTED**。

## 1. 实现

| 层 | 内容 |
| --- | --- |
| transport | `HttpTransport`（`/v1/commands`、`/v1/snapshot`、`/v1/conversations/:id/messages`、SSE `/v1/events`，解析 `cursor_expired`）；`FixtureAdapter` 与之一一对应，所有返回用 `@personal-agent/contracts` 校验。浏览器仅提交 `UserCommand`，不带 `TrustedActor`。 |
| 状态 | snapshot + cursor；SSE `seq` 去重、断线重连、游标过期重取；页面刷新/标签可见时重取；命令 pending 与 rejected receipt 的可恢复错误。 |
| 页面 | 主对话首页（project/anchor、分页、键盘发送）；工作列表/详情（合同、完成标准、验证结果、派工 revision）；集中问题（choices/form/free_text/url_flow/review）；新建委托；停止/暂停/继续/重试/接受。动作只来自 `actions.available` 与当前引用。 |
| 逐 target | 答案投递状态独立显示；`local_recorded` 明确为“本地已记录（尚未写到原生）”，UI 从不自行升级为 `native_applied`。 |
| 执行器 | `AgentProfile`/`ProbeReport` fixture 组件显示 readiness 与能力矩阵；生产 Catalog 标注由主线接线。 |
| 可访问性/响应式 | 语义标签、`aria-live`、可见 focus；<960px 单列且无横向溢出；长中英混排不撑破布局。 |

## 2. 实际命令与结果

```sh
pnpm --dir apps/console run typecheck        # PASS
pnpm --dir apps/console run test             # 8/8 PASS (fixture adapter contract)
pnpm --dir apps/console run build            # PASS (Vite production build)
node apps/console/e2e/run.mjs                # PASS_CONSOLE_FIXTURE, 20/20
```

开发服务器实际监听 `http://127.0.0.1:5173/`（Vite 8.2.2，`--strictPort`）。E2E 覆盖：首次渲染、执行器 fixture、聊天发送、五类问题的 choice/review/url 回答、验证与接受、重试、过期候选禁用、停止中未知写者、暂停/继续、停止、长文本无溢出、模型离线（拒发聊天但仍可查询/回答）、恢复发送、SSE 断线重连、游标过期重取、刷新后对话与已交付工作恢复、新建委托、键盘发送与焦点、390px 窄屏无横向溢出与表单可用、无 console/page 错误。

证据：`apps/console/e2e/report.json`、`apps/console/e2e/screenshots/*.png`。

## 3. 验收映射（fixture 级）

| ID | 结果 | 证据/说明 |
| --- | --- | --- |
| AC-UX-01 | **PASS（fixture）** | 建议不自动执行；`create_work` 表单提交目标/范围/标准后才出现新工作。模型建议路径未接真实 reasoner。 |
| AC-UX-02 | **PASS（fixture）** | 新建、继续、停止、回答问题均确定性完成，不依赖模型；离线时仍可用。 |
| AC-UX-03 | **PASS（fixture）** | WorkId 由后端回执给出，phase 只来自 `WorkView`；UI 不维护状态机。真实 core 投影 NOT_TESTED。 |
| AC-UX-04 | **PASS（fixture）** | project/anchor 上下文可见，工作列表按项目筛选，不串台。 |
| AC-UX-05 | **PASS（fixture）** | 认证/审核使用独立原生选项表单；答案记录为本地状态。真实 native 授权 NOT_TESTED。 |
| AC-UX-06 | **PASS（fixture）** | 停止显示“停止中 + 写者状态未知（不能视为已停止）”；暂停只改派工开关，不宣称暂停当前工具。 |
| AC-UX-07 | **PASS（fixture）** | 过期候选的接受按钮禁用并说明原因；直接提交返回 `stale_candidate`，工作保持验证中。 |
| AC-UX-08 | **PASS（fixture）** | 当前候选验证通过后接受，工作进入“已交付”。 |
| AC-UX-09 | **PASS（fixture）** | 验证按 criterion 分行，投递按 target 分行，不用单一绿灯代替；真实 Driver 结果 NOT_TESTED。 |
| AC-UX-10 | **PASS（fixture）** | 刷新后对话、已交付工作、待决定问题恢复；旧答案不会唤醒已停止工作（fixture 停止后无动作）。真实恢复链路 NOT_TESTED。 |
| AC-UX-11 | **NOT_TESTED** | 决定/学习控制视图不在本包首批页面；`record_decision` 等命令返回 `unsupported_capability`。 |
| AC-UX-12 | **PASS（部分）** | 桌面/窄屏无重叠或横向溢出；键盘有可见焦点；未做完整屏幕阅读器人工审计。 |

## 4. 未接线与限制

- 生产 HTTP/SSE、认证后 actor、真实 Snapshot/Command 路由由主 Agent 提供；当前 HTTP transport 已实现但未连活服务。
- 验证详情、逐 target 投递、执行器 Catalog 使用 fixture-only 可选方法；主线发布读路由后接入，见 `docs/rfcs/WP-11/0001-console-fixture-boundary.md`。
- 不新增 Snapshot 字段，不在页面写 vendor 分支；worker/浏览器不声明 human 授权。
- 关闭页面不停止 daemon；不写产品 SQLite 或 native profile；未执行付费 native smoke。
