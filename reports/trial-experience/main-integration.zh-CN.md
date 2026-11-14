# TrialWorkspace：main 接入与包内交接（wave-26）

本文件描述当前真实挂载（main `a302ddc`）与 wave-26 增量。F 不修改 `App.tsx`、transport、根 CSS、contracts、HTTP 或授权。

## 1. 当前挂载状态（已实现，不是待接）

main 已导入 F 六源原字节（`fad070f`）并在 App 中接线：

- 导航“试用准备”（`App.tsx` rail）；
- 仅在认证 ready 且视图可见时 `useTrialReadiness(transport, boolean)`；
- props：`readiness/loading/error/unavailable/configuration/activeProjectId/activeConversationTitle`；
- 四个回调：模型设置、项目导入（先 `openView('conversation')` 再打开表单/工作列表）、执行器目录、主对话；
- `onReload`：`trial.reload()` + `refreshConfiguration()`。

本包不要求 main 重写这些；只提供以下增量。

## 2. Hook 增量：稳定 identity

```ts
import { useTrialReadiness } from './trial/index.ts'

const trial = useTrialReadiness(transport, {
  enabled: auth === 'ready' && workspaceView === 'trial',
  identity: sessionGeneration, // 稳定 string | number，例如认证会话代次或 API 基址
})
```

- `identity` 变化：立即隐藏旧观察、取消旧请求、只读取新服务一次；旧响应晚到不会覆盖。
- 不传 `identity`：沿用现有 `useTrialReadiness(transport, boolean)`，约定同一活期内 transport 实例稳定；替换实例必须 remount（React key）或传 identity。
- inline 对象 props 不会造成请求循环（以 capability 布尔 + identity 依赖，transport 用 ref）。
- `enabled` 在请求途中变 false：loading 立即结束，迟到响应忽略，重新启用只发一次新请求。

**只读语义**：仍只经 `ConsoleTransport.readiness`，一次加载/刷新一请求；不发命令、不调用模型、不消费队列。

## 3. 组件增量（无需 main 改动）

- 新增“当前项目”事实行：有筛选显示项目名，无筛选显示“全部项目”，名称未读取时明确提示。
- 观察区增加准入校验：必须声明 `scope.projectIds`、`windowLabel`、`coverage`；范围不含当前项目时拒绝展示。当前 main 不传 `insights`，因此默认不显示。
- 观察行支持 `unit`、`layer`、`sampleCount`、`null`（未知）；不合并币种/层。

## 4. 建议（不阻塞）

- 导航后焦点：`openView` 后可把焦点移到目标视图标题（`tabIndex=-1`）或保留触发按钮；当前实现焦点落回文档。
- 若将来支持同一页面切换后端/认证会话，请传 `identity`，否则依赖 remount。

## 5. 包内交接（D/E，不把测试装置带入产品）

产品运行需要的自有源码（六文件，全部在 `apps/console/src/trial/`）：

```
index.ts  TrialWorkspace.tsx  useTrialReadiness.ts  trial-view.ts  insights.ts  trial.css
```

- 运行时依赖：现有 React 18 / lucide-react / `@personal-agent/contracts`、类型引用 `../transport.ts` 与 `../configuration-labels.ts`；无新增依赖、无根 lock 改动。
- `TrialWorkspace.tsx` 自行 import `trial.css`（Vite 打进 console bundle）；不需要改 `main.tsx` 或根 CSS。
- **不要打包**：`apps/console/e2e/trial/**`、`apps/console/test/trial/**`、任何 harness/fixtures、截图或临时状态。
- 安装包中出现体验的唯一判据是真实 console bundle 与 App 导航，而不是测试文件或截图；最终同包验收由 E 对同一 artifact 独立执行。

## 6. 验证命令（本包实际运行）

```sh
cd apps/console
node --test test/trial/trial-view.case.ts        # 11 项纯映射/准入/文案
npx tsc -p tsconfig.json --noEmit
npx tsc -p e2e/trial/tsconfig.json --noEmit
node e2e/trial/run-all.mjs                       # 9 套件：hook async/状态/HTTP/app 目标/两项目
```

main 自有真实 App 浏览器测试（`tests/integration/trial-workbench-browser.mjs`）已在本包改动后重新运行并通过。

## 7. 明确未达

- G 的完整指标未准入；观察区只在有合格 scope/window/coverage 时显示。
- 真实登录中途过期、native 执行、安装包独立 E 验收、屏幕阅读器人工走查、非 Chromium 浏览器不在本包范围。
- 两项目 journey 使用私有真实 runtime（真实导入/会话/草稿），execution unavailable，模型是 no-send stub；不是 vendor/native 证明。
