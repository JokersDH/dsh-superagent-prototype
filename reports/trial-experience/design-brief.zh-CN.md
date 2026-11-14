# F1：真实工作台现状与试用入口局部设计

日期：2026-11-14。范围：`apps/console` 现有工作台与本轮新增 `src/trial/`。本文只描述已存在代码与已发布合同，不把计划写成已实现。

## 采用的既有视觉世界

- `apps/console/DESIGN.md` 已确立“精密工作台”：石墨导航、白色主区、克制冷青绿动作色、固定字号、细分隔线、平面分区、按需展开详情。
- `apps/console/.impeccable/surfaces/src-app-tsx.md` 已记录主工作台方向：主对话领先，项目/任务/决定/交付是可见上下文，工作屏而非落地页。
- 因此本组件属于“既有表面内的新增视图”，继承既有世界：**不新建视觉身份、不改 `DESIGN.md`、不做概念竞赛**。唯一新增的签名元素是一条与工作阶段条同族的“准备状态条”。（Impeccable 的结构化访谈因本轮为无人值守的长包执行而跳过，判断依据为上述已冻结文档与真实代码；此替代在交付说明中明示。）

## 当前真实交互缺口（定位到组件）

1. **没有回答“我现在能做什么”的单一位置**。`App.tsx:867-883` 的导航只有主对话/工作与交付/待我决定/执行器连接；模型配置在执行器目录之外，项目导入藏在侧栏 `App.tsx:916-928` 的图标里。首次试用者需要自己拼出模型→项目→执行器三段状态。
2. **执行不可用提示只存在于主对话内**。`App.tsx:1044-1048` 的 `execution-state` 只在对话视图可见，切到工作/决定视图后原因消失；只读恢复也没有跨视图的统一说明。
3. **完全没有消费 readiness**。仓库内 `TrialReadiness` 只有传输与测试（`apps/console/src/transport.ts:530`、`test/trial-readiness-transport.case.ts`），UI 没有任何使用点；`executor-readiness`（`App.tsx:1408`）只是单个 profile 的徽标。
4. **项目可派工状态分散**。侧栏项目筛选（`App.tsx:930-950`）只显示名称；`dispatchAllowed`/`blockedReason` 只在新建委托表单里逐一出现。用户无法一眼看到“几个项目可真派工”。
5. **阻断语义不统一**。模型未配置、执行器不可用、只读恢复、接口未知分别出现在顶栏、对话横幅、执行器视图，颜色与措辞不连续；`unknown` 容易被读成“还没加载完”。
6. **刷新只对快照生效**。顶栏刷新（`App.tsx:776-784`）刷新快照/助手状态，没有刷新配置与 readiness 的入口，用户遇到暂不可用只能整页刷新。

## 局部设计方向（只在本视图内）

- **形态**：复用现有视图语法 `workspace-view` / `view-header` / `view-content`（`workbench.css:262-277`），新增 `trial-*` 前缀类；不覆盖根样式、不引入第二主题。
- **签名**：顶部一条“准备状态条”（`<dl>`，三段：运行模式 / 对话模型 / 开发执行），与工作阶段条同族的平面横条，不是卡片网格。
- **层级**：一条状态句 + 一个主动作 + 至多两个次动作；动作全部是导航，不是命令。
- **信息**：项目、执行器计数、功能入口配置、观察时间与配置 revision；全部来自 `TrialReadiness` 与 `ApplicationConfiguration` 公开字段。
- **边界**：页脚常驻一句“只读配置观察 / 授权 none / 不含路径凭据模型端点”。`configuration_present` 追加“配置事实，非连接验证”，避免把配置读成已测或已授权。
- **响应式**：≥961px 两列（项目 | 执行器与能力，中间 1px 细线）；≤960px 单列；≤720px 状态条改纵向行、动作换行、按钮保持 34px 高。
- **可访问性**：原生 button，`aria-labelledby` 分区，状态条用 `dl`，加载/刷新 `role="status"`，错误 `role="alert"`，所有图标按钮有中文 accessible name；状态永远“颜色 + 文字”，未知不用绿色。

## 动作契约

只允许四个导航回调：`configure_model`、`import_project`、`inspect_executor`、`open_conversation`（`packages/contracts/src/trial-readiness.ts:29`）。映射到 main 既有动作：

| 动作 | main 既有入口 |
| --- | --- |
| `configure_model` | `setModelPanelOpen(true)`（`App.tsx:721`、`App.tsx:784`） |
| `import_project` | `setProjectImportOpen(true)` + 打开侧栏（`App.tsx:952`） |
| `inspect_executor` | `openView('executors')`（`App.tsx:877`、`App.tsx:1053`） |
| `open_conversation` | `openView('conversation')`（`App.tsx:869`） |

组件不持有 transport，不自行 POST、不写配置、不选项目、不建会话。只读恢复下不提供 `import_project`，因为导入是写入。

## 状态映射（与 0064 投影一致）

| readiness 字段 | 显示 | 语义色 |
| --- | --- | --- |
| `discussion: configuration_present` | 已配置 | 绿 |
| `discussion: not_configured` | 未配置 | 琥珀 |
| `discussion: provider_error` | 服务异常 | 红 |
| `discussion: unknown` | 未知 | 琥珀 |
| `development: configuration_present` | 配置已具备（附“配置事实，非连接验证”） | 绿 |
| `development: needs_project` | 需要项目 | 琥珀 |
| `development: blocked` | 执行不可用原因（取自 `execution.reason`） | 红 |
| `development: fixture_only` | 固定流程 / 非原生执行 | 蓝灰 |
| `development: readonly` | 只读恢复 | 琥珀 |
| `development: unknown` | 未知 | 琥珀 |
| `mode: fixture/product/personal` | 固定流程 / 产品模式 / 个人模式 | 中性/蓝灰 |

`authorization` 恒为 `none`，只作为页脚事实展示，不生成任何按钮。

## 本阶段实现清单

- `apps/console/src/trial/trial-view.ts`：纯映射（状态文案、语义色、动作派生、时间/revision 格式）。
- `apps/console/src/trial/TrialWorkspace.tsx`：受控组件，props 接收 readiness/loading/error/unavailable/configuration/可选观察。
- `apps/console/src/trial/useTrialReadiness.ts`：有界只读调用 `ConsoleTransport.readiness`，含 reload、卸载保护、旧响应丢弃、暂不可用区分。
- `apps/console/src/trial/trial.css`：`trial-*` 局部样式与 960/720 断点。
- `apps/console/src/trial/index.ts`：稳定出口。
- 测试：`test/trial/`（纯映射/动作矩阵），`e2e/trial/`（真实浏览器状态、键盘、响应式、真实 HTTP journey）。

## 明确未做

- 未修改 `App.tsx`、`transport.ts`、根 CSS、contracts、HTTP、provider 或授权；main 负责真实 App 接线。
- 未新增项目选择/会话创建/执行授权；四个回调之外没有第二个 authority。
- 未触发模型、agent、命令或队列；所有样例数据在测试装置内显式标注。
