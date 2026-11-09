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

## 2.5 真实 HTTP 演示（主线的 loopback sandbox）

```sh
# sandbox: apps/coordinator/http/demo.ts --port 8788 --state /tmp/pa-http-demo --console-origin http://127.0.0.1:5174
# console: VITE_CONSOLE_MODE=http VITE_API_TARGET=http://127.0.0.1:8788 VITE_CONVERSATION_ID=conversation-main pnpm --dir apps/console run dev -- --port 5174
node apps/console/e2e/http-demo.mjs          # PASS_CONSOLE_HTTP_DEMO, 8/8
```

覆盖：bootstrap 错误令牌就地拒绝；正确令牌换取 HttpOnly cookie 后 snapshot/SSE 建立；`create_work` 经 ApplicationService/core/真实 SQLite 入库并按 `actions.available` 渲染暂停/停止；聊天消息持久化；`pause_dispatch` CAS 成功；停止后如实显示“已结束”且不宣称交付；刷新后工作与会话仍在；登录后的 console 无错误。证据：`apps/console/e2e/report-http.json` 与 `screenshots/http-*.png`。

sandbox 只排队执行 intent，不启动 Runner/模型，因此该轮没有生成问题、验证或 native 证据；这些面板保持空态并标为 NOT_TESTED，不使用 fake 结果。

## 2.6 受控产品浏览器验收（真实问题/检查/产物）

```sh
# controlled product: apps/coordinator/product/demo.ts --port 8792 --state /tmp/pa-product-demo --console-origin http://127.0.0.1:5174
# console: VITE_CONSOLE_MODE=http VITE_API_TARGET=http://127.0.0.1:8792 VITE_PROFILE_IDS=... VITE_CHECK_DEFINITION=check-fixture-output ...
node apps/console/e2e/controlled-demo.mjs    # PASS_CONSOLE_CONTROLLED_PRODUCT, 8/8
```

覆盖：`profile-fixture-question` 新建工作 → 真实原生权限问题（Allow once/Deny）→ 结构化答案经 QuestionBroker → 注册检查 `check-fixture-output` → 可信 PASS 候选；浏览器经 `/v1/artifacts/:id` 读取**当前候选交付清单**（`controlled-product-artifact/1`，含 candidate/attemptId/artifactDigest）与固定输出字节；接受当前候选后进入已交付且产物引用保留；刷新后会话、交付与产物仍在；`profile-fixture-fail` 产生 FAIL 验证且不提供接受。证据：`apps/console/e2e/report-controlled.json` 与 `screenshots/controlled-*.png`。

产物问题同时在工作区包修复：交付/审计 patch 现包含新增与二进制文件内容；内容寻址 manifest 不再写入 attemptId，改为尝试独立的 per-attempt `manifestRefPath`，两个相同内容的 attempt 共享 manifest 而不会残留旧 attempt 标识（workspaces 10/10）。

## 3. 验收映射（fixture + 真实 HTTP/受控产品演示）

| ID | 结果 | 证据/说明 |
| --- | --- | --- |
| AC-UX-01 | **PASS（fixture + 受控产品）** | 建议不自动执行；受控产品中 `create_work` 才触发执行，权限问题回到浏览器等待用户决定。真实 reasoner 建议路径 NOT_TESTED。 |
| AC-UX-02 | **PASS（fixture）** | 新建、继续、停止、回答问题均确定性完成，不依赖模型；离线时仍可用。 |
| AC-UX-03 | **PASS（fixture + HTTP）** | WorkId 由后端回执给出，phase 只来自 `WorkView`；HTTP 演示中 phase 来自真实 core/SQLite 投影，UI 不维护状态机。 |
| AC-UX-04 | **PASS（fixture）** | project/anchor 上下文可见，工作列表按项目筛选，不串台。 |
| AC-UX-05 | **PASS（fixture + 受控产品）** | 受控产品展示真实权限问题与逐 target 选项，答案经 QuestionBroker 写回；fixture 另覆盖认证/审核表单。安装的 vendor 原生授权 NOT_TESTED。 |
| AC-UX-06 | **PASS（fixture + HTTP）** | fixture 覆盖“停止中 + 写者状态未知”；HTTP sandbox 无 Runner，停止如实显示“已结束”且绝不显示“已交付”；暂停只改派工开关，不宣称暂停当前工具。 |
| AC-UX-07 | **PASS（fixture）** | 过期候选的接受按钮禁用并说明原因；直接提交返回 `stale_candidate`，工作保持验证中。 |
| AC-UX-08 | **PASS（fixture + 受控产品）** | 受控产品完成问题→检查→可信验证→当前候选接受→已交付，交付清单/输出/检查证据可读。 |
| AC-UX-09 | **PASS（fixture + 受控产品）** | 验证按 criterion 分行；受控 PASS 与 FAIL profile 分别呈现，FAIL 无接受入口。安装的 vendor Driver 结果 NOT_TESTED。 |
| AC-UX-10 | **PASS（fixture + HTTP）** | fixture 刷新恢复对话/已交付工作/问题；HTTP 刷新后 cookie 会话、已结束工作与聊天仍在。真实 Runner 恢复链路 NOT_TESTED。 |
| AC-UX-11 | **NOT_TESTED** | 决定/学习控制视图不在本包首批页面；`record_decision` 等命令返回 `unsupported_capability`。 |
| AC-UX-12 | **PASS（部分）** | 桌面/窄屏无重叠或横向溢出；键盘有可见焦点；未做完整屏幕阅读器人工审计。 |

## 4. 未接线与限制

- HTTP/SSE、session bootstrap、认证后 actor 已对接主线 loopback sandbox；验证/投递详情消费 `/v1/verifications/:id` 与 `/v1/questions/:id/deliveries`。执行器 Catalog 仍未发布读取入口（HTTP 模式明确显示未接线）。
- 受控产品已覆盖真实问题、注册检查、验证、产物读取与接受；其 subprocess 是固定 fixture profile，不代表已安装 vendor 兼容性，独立 Runner 恢复仍 NOT_TESTED。
- 不新增 Snapshot 字段，不在页面写 vendor 分支；worker/浏览器不声明 human 授权。
- 关闭页面不停止 daemon；不写产品 SQLite 或 native profile；未执行付费 native smoke。
