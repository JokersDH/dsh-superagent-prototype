# F1：真实 App 挂载审计与修正清单（wave-26）

审计对象：main `a302ddc1963e9d20ada2cbba4f5cf317f041e78f`（本分支已合并），导入 F 六源 `fad070f` 原字节。以下结论来自实际源码与 main 已发布的干净浏览器报告，不来自截图想象。

## 已确认的真实挂载（不再是缺失）

| 事实 | 位置 |
| --- | --- |
| 试用准备导航（带 tooltip/accessible name） | `apps/console/src/App.tsx:882-883` |
| 视图类型含 `trial` | `apps/console/src/App.tsx:167` |
| 仅在认证 ready 且视图可见时读取 readiness | `apps/console/src/App.tsx:661` |
| 真实 readiness/configuration/当前项目/当前会话传入 | `apps/console/src/App.tsx:1059-1061` |
| 配置模型 → 原模型面板 | `App.tsx:1064-1065` |
| 导入项目 → 先 `openView('conversation')` 再开原表单/工作列表；readonly/无 registerProject 明确拒绝 | `App.tsx:1066-1071` |
| 检查执行器 / 打开主对话 | `App.tsx:1072-1073` |
| 默认主对话与草稿保持；readiness 不进入默认视图 | `App.tsx:1053+`（Conversation 持续 mounted）、main 报告 8 场景 |
| 旧接口/坏 schema/错误重试/readonly/fixture 实际浏览器覆盖 | `tests/integration/trial-workbench-browser.mjs`（main-owned） |

结论：F 不再把 main 入口列为未实现；后续只在本轮真实 App 上做身份、状态、两项目 journey、可访问性与文档收口。

## 真实用户目标与当前可判断性

首次试用与每日返回，用户需要回答四件事：**当前项目/会话是谁、配置缺什么、执行是否可用、下一步打开哪里**。当前挂载已能回答前三件（项目行“当前”、三格状态、四动作），但有两处不够明确：

1. 项目筛选为“全部项目”时（`activeProjectId=undefined`），试用准备没有任何“当前范围”文字，用户只能从“没有当前标记”推断。需要显式“当前项目：全部项目”。
2. 导航离开试用准备后焦点落回文档，键盘用户不知道去了哪个视图。F 不改 App，只交最小建议（见文末）。

## 修正清单（本轮直接实现，不交纯建议）

| # | 问题 | 证据 | 本轮处理 |
| --- | --- | --- | --- |
| 1 | hook 只依赖 capability 布尔值：同为启用状态的 transport A→B 替换不会取消 A、读取 B（0066 已列为残余边界） | `useTrialReadiness.ts` effects 依赖 `[enabled, attempt, available]` | 增加稳定 `identity` 契约：身份变化立即隐藏旧数据、取消旧请求并读取新身份；无 identity 时保持“稳定客户端 + remount”契约并测试 inline props 不产生请求循环 |
| 2 | `enabled` 在请求途中变 false 时，finally 被取消，`loading` 永远为 true | 同文件 `if (!enabled) return` 未清 loading | 禁用时显式结束 loading；测试禁用/重启只产生一次新请求 |
| 3 | 旧请求晚到可能覆盖新身份 | 仅靠 attempt/cleanup，无身份标记 | observation 按 identity 标记；渲染只暴露当前身份的结果（A 的迟到结果不显示为 B 的状态） |
| 4 | “全部项目”没有当前范围文字 | `activeProjectId={projectFilter}` 可为空 | 新增“当前项目”事实行：解析 config 名称；无筛选显示“全部项目”；名称未读取时明确“未读取” |
| 5 | G 未准入：任何 `status=ready` 的指标都可能缺少项目/窗口/覆盖说明，直接展示会误导 | G 审计 3PASS/7FAIL，默认指标未准入 | 观察区增加“准入门”：必须同时有声明范围、观察窗口、覆盖说明；否则只显示“缺少范围说明，不展示指标”；当前项目不在 scope 内时拒绝展示 |
| 6 | 只读导入、unknown 配色、零值/未观察文案已有，但缺少本轮真实 App 回归 | main 8 场景 + F 组件测试 | 保留并新增负例：readonly 不出现导入/批准/恢复；unknown 不变绿；零项目显示真实 0；未读取显示“未观察/待读取” |
| 7 | 错误文案可能泄露原始 transport 文本 | `trialProbeError` 已映射 code | 保持通用文案；错误只保留“上次读取结果（时间）”，测试断言不含 token/绝对路径/stack |
| 8 | 文档仍写“main 未接线 / 用 harness 预览” | `docs/user-guide/*` | 改为真实入口与当前能力，harness 只作为开发证据，不再教试用者使用 |

## 交付给 main 的最小接线需求（不编辑根文件）

1. **transport identity**（推荐但非阻塞）：`useTrialReadiness(transport, { enabled, identity })`，`identity` 用稳定字符串/数字，例如认证会话代次或 API 基址；当前 `useTrialReadiness(transport, boolean)` 保持兼容。没有 identity 时约定“同一活期内 transport 实例稳定；替换实例必须 remount 或传 identity”。
2. **导航后的焦点（建议）**：在 `openView` 后把焦点移到目标视图标题（`tabIndex=-1`）或返回触发按钮；F 不修改 App。
3. **G 指标**：只有当 G 修复并给出 scope/window/coverage 时才传入 `insights`；当前不传是正确行为，核心页面不依赖它。

## 范围声明

- 保留 main 已测的 HTTP/desktop/mobile/failure/readonly/四回调范围；本轮只回归受本次改动影响的路径。
- 不把候选 harness 的通过写成 main App 通过；两项目真实 App journey 见 F5–F8。
- 真实 vendor/model/native 调用 0；无第二授权路径。
