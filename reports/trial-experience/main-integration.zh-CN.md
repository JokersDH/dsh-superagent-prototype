# TrialWorkspace：main 接入与包内交接（wave-27）

当前真实挂载：main `967dc0c`（导入 F `3037cbe` 四源与测试）。F 不修改 `App.tsx`、transport、根 CSS、contracts、HTTP 或授权；以下只是增量与最小消费说明。

## 1. 已由 main 完成、无需重做

- 导航“试用准备”；仅认证 ready 且视图可见时读取 readiness。
- `useTrialReadiness(transport, { enabled, identity })`，`identity` 为 `newId('trial-client')`（随 transport/auth 变化）。
- 四回调：模型设置、项目导入（先 `openView('conversation')` 再打开表单/工作列表）、执行器目录、主对话。
- `onReload`：`trial.reload()` + `refreshConfiguration()`。
- 默认主对话与未发送草稿保持。

本轮 F 只新增可选输入，不要求修改现有四动作。

## 2. 本轮新增可选输入

### 2.1 项目声明草案（J）

```tsx
const [recipeSuggestions, setRecipeSuggestions] = useState<readonly TrialRecipeSuggestion[]>()
const [recipesLoading, setRecipesLoading] = useState(false)
const [recipesError, setRecipesError] = useState<string>()

<TrialWorkspace
  /* ...existing props... */
  recipes={recipeSuggestions}
  recipesLoading={recipesLoading}
  recipesError={recipesError}
  onPrepareRecipe={suggestion => openWorkDraft(suggestion.goalPreview, suggestion.projectId ?? projectFilter)}
/>
```

- `TrialRecipeSuggestion` 来自 `./trial/index.ts`（`recipes.ts`），是**只读展示输入**；J/main 负责把 `packages/project-recipes` 的草案映射进来。
- `onPrepareRecipe` 不是第五个导航动作，也不发 HTTP；它只把草案数据交给 main 的原委托表单。main 可决定只填目标/项目，检查与执行器仍用原表单默认值；**不得**由 F 自动加检查、加权限或提交。
- F 会按当前项目过滤（其他项目的草案不显示），并对缺输入、未注册检查、未准入执行器、非 `authority:none` 的草案禁用“准备草案”。
- 同一草案 300ms 内重复点击只回调一次；用户已编辑原表单后是否覆盖由 main 决定。

### 2.2 可信观察摘要（G）

当前 main 不传 `insights`，观察区不显示。接入时最小形状：

```ts
{
  status: 'ready' | 'insufficient_data' | 'unavailable',
  scope: { projectIds: string[], aggregation: 'single_project'|'declared_multi_project'|'cross_project', label?: string },
  windowLabel: string,
  coverage: string,
  coverageState?: 'complete'|'partial'|'unknown',
  truncated?: boolean,
  sources?: { known: number|null, unknown: number|null },
  sampleCount: number|null,
  unknownCount?: number|null,
  metrics: { id, label, value: string|null, unit?, currency?, layer?: 'observed'|'controlled'|'native'|'operator'|'unknown', sampleCount?: number|null, detail? }[],
  limitations: string[]
}
```

- 缺 `scope`/`windowLabel`/`coverage`、范围不含当前项目、`truncated` 且宣称 complete、`status` 非 ready，都会隐藏指标并说明原因；F 不补 0、不合计币种/层。
- 旧 compact G projection 不能直接当兼容输入；main 在 Node 侧用授权 public DTO 重新限定范围/窗口/覆盖后再映射。

## 3. 建议（不阻塞）

- 导航后焦点：`openView` 后可把焦点移到目标视图标题（`tabIndex=-1`）或保留触发按钮；当前实现焦点落回文档。
- 身份切换：main 的 `trialIdentity` 已满足；若将来在同一 transport 内切换后端，请更新 identity 或 remount。
- 配方/摘要加载失败时，原表单与主对话仍可用；F 只显示有限错误，不自动重试或读取私有数据。

## 4. 包内交接（D/E）

产品运行需要的自有源码（七文件，均在 `apps/console/src/trial/`）：

```
index.ts  TrialWorkspace.tsx  useTrialReadiness.ts  trial-view.ts  insights.ts  recipes.ts  trial.css
```

- 运行时依赖：现有 React 18 / lucide-react / `@personal-agent/contracts`，类型引用 `../transport.ts`、`../configuration-labels.ts`；无新增依赖、无根 lock 改动。
- CSS 由 `TrialWorkspace.tsx` import；无需改 `main.tsx` 或根 CSS。
- **不要打包**：`apps/console/e2e/trial/**`、`apps/console/test/trial/**`、harness/fixtures、截图、临时状态。
- 安装包是否包含体验，只看真实 console bundle 与 App 导航；最终同包验收由 E 对同一 artifact 独立执行。

## 5. 验证（本轮实际）

```sh
cd apps/console
node --test test/trial/*.case.ts        # 16 项：状态/actions/准入/配方/文案
npx tsc -p tsconfig.json --noEmit
npx tsc -p e2e/trial/tsconfig.json --noEmit
node e2e/trial/run-all.mjs              # 10 套件，全部 exit 0
```

main 自有真实 App 浏览器测试在本包改动后重跑 8/8 PASS（pageerrors 0、POST 0、model 0）。

## 6. 明确未达

- main 尚未接入 `recipes`/`insights`；默认产品不显示这两段。
- J/G 模块未进入本仓库默认产品；F 只有 typed consumer、fixtures 与校验。
- 真实 vendor/model/native 0；`app-daily-flow` 使用 controlled fixture（固定 scratch 写入），不是原生或安装包证明。
- 非 Chromium、人工屏幕阅读器、真实服务端会话中途过期未测。
