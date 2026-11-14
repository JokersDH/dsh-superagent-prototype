# TrialWorkspace：main 接入说明（最小接线）

组件只消费公开数据并把四个导航动作交回 main。它不创建 transport、不发命令、不读写配置或项目。

## 1. 导入

```tsx
import { TrialWorkspace, useTrialReadiness } from './trial/index.ts'
```

`TrialWorkspace.tsx` 自身 import `./trial.css`，样式随组件进入 bundle，**不需要修改 `main.tsx` 或根 CSS**。

## 2. 视图与状态

```tsx
const [workspaceView, setWorkspaceView] = useState<
  'conversation' | 'works' | 'decisions' | 'executors' | 'trial'
>('conversation')

// 仅在视图可见时读取，避免应用启动多一次请求；已有有效值在刷新时保留。
const trial = useTrialReadiness(transport, workspaceView === 'trial')
```

## 3. 导航按钮

在 `App.tsx` 的 `workspace-rail` 中，于“执行器连接”之后加入一个按钮（建议图标 `ClipboardCheck` 或 `ListChecks`，`lucide-react` 已在用）：

```tsx
<button
  type="button"
  className={`rail-button${workspaceView === 'trial' ? ' active' : ''}`}
  aria-current={workspaceView === 'trial' ? 'page' : undefined}
  title="试用准备"
  aria-label="试用准备"
  onClick={() => openView('trial')}
>
  <ClipboardCheck size={19} />
</button>
```

`openView` 已负责关闭抽屉与模型面板；无需新增行为。

## 4. 视图渲染

放在与 `executors` 视图同级的位置（`App.tsx` 的 `<section className="conversation">` 内）：

```tsx
{workspaceView === 'trial' && (
  <TrialWorkspace
    readiness={trial.readiness}
    loading={trial.loading}
    error={trial.error}
    unavailable={trial.unavailable}
    configuration={configuration}
    activeProjectId={projectFilter ?? undefined}
    activeConversationTitle={conversationTitle}
    onReload={trial.reload}
    onAction={action => {
      if (action === 'configure_model') {
        setWorkspaceOpen(false)
        setModelPanelOpen(true)
      } else if (action === 'import_project') {
        setProjectImportOpen(true)
        setWorkspaceOpen(true)
        openView('works')
      } else if (action === 'inspect_executor') {
        openView('executors')
      } else {
        openView('conversation')
      }
    }}
  />
)}
```

四个动作就是 `packages/contracts/src/trial-readiness.ts` 的 `TrialNavigationAction` 全集；分支是穷尽的，没有默认字符串入口。若 main 选择把 `import_project` 指向 `works` 视图之外的原入口，回调内容可改，但**不得**新增动作名或在此处写项目/配置。

## 5. 数据语义（不要在 App 里二次推断）

- `readiness` 缺失（`undefined`）表示“尚未读取/接口暂不可用”，不是“未配置”。组件会显示“未观察”。
- `development: 'configuration_present'` 是配置事实，组件固定加注“配置事实，非连接验证”。不要把它渲染成“已连接/已测/可授权”。
- `fixture_only`、`unknown`、`readonly` 分别呈现固定流程、未知、只读；`authorization` 恒为 `none`，组件只把它作为页脚事实。
- `loading` 为 true 且已有 `readiness` 时是刷新态：旧值保留，header 显示“正在刷新…”。
- `error` 不清空旧值；`onReload` 只允许 main 重新读取 readiness（以及 main 自己决定是否重读 configuration），不得触发模型、命令、agent 或旧队列。
- `configuration` 只用于项目/执行器/能力明细；缺失时显示“未读取”，不填 0。

## 6. 可选观察数据（G）

G 的 summary 由 main 映射成 `TrialInsightsView` 后传入 `insights`；组件不计算花费、节省时间、质量或审批效率。未传时整段不渲染。`status` 不是 `ready` 时不展示任何指标；`value: null` 显示“未知”，不填 0。

## 7. 验证

```sh
cd apps/console
node --test test/trial/*.case.ts        # 纯映射/动作矩阵（9 项）
npx tsc -p tsconfig.json --noEmit
npx tsc -p e2e/trial/tsconfig.json --noEmit
node e2e/trial/trial-states.mjs         # 真实浏览器状态/键盘/响应式/视觉审计（21 项）
node e2e/trial/trial-http.mjs           # 真实 HTTP readiness journey（隔离端口/状态）
```

## 8. 当前未达

- `App.tsx` 尚未接线（main 拥有）；在此之前 `trial-http.mjs` 通过 `e2e/trial/harness.html` 使用真实 `HttpTransport`，不是 app shell。
- G 的 `TrialInsightsView` 仅是展示输入需求，实际映射由 main 完成。
- 组件不提供项目选择、会话创建、批准、恢复授权或自动接受入口；这些仍属 main 既有流程。
