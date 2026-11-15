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
  onPrepareRecipe={draft => {
    // Re-read current configuration/facts first, then prefill the original NewWorkForm with all fields:
    // draft.goal / draft.projectId / draft.scope / draft.criteria / draft.profileId
    // The user still confirms in the original form; do not dispatch directly.
  }}
/>
```

- `TrialRecipeSuggestion` / `TrialRecipeDraft` 来自 `./trial/index.ts`（`recipes.ts`）。草案是**只读展示输入**，由 J/main 映射。
- 适用性按当前配置项目判断：项目存在且被选中、草案属于该项目、检查在项目默认验收标准且已注册、执行器绑定到该项目且已准入、声明的范围原子已在项目范围内（不把前缀当权限）。
- `onPrepareRecipe(draft)` 不是第五个导航动作，也不发 HTTP；`draft` 已含 goal/scope/criteria/profileId，main 必须用当前配置重新核验后再预填原表单。F 不自动加检查、加权限或提交。
- F 显示所有声明（含 foreign/unknown/缺失），但只对合格草案启用按钮；同一草案 300ms 内重复点击只回调一次。用户取消或编辑后是否被新草案覆盖由 main 决定。

### 2.2 真实观察（main 已实现，F 为消费者）

main 的 `useUsageObservation` 已读取 `GET /v1/insights`（当前固定 7 天、当前项目），并把 `UsageObservation` 直接传给 `insights`；它与 F 的 `TrialInsightsView` 结构兼容（`windowLabel/coverage/coverageState/scope/sampleCount/unknownCount/metrics/layer/unit/limitations`）。

F 新增的可选窗口/状态输入（main 决定是否接）：

```tsx
<TrialWorkspace
  insights={usageView}
  insightWindow={usageDays}                 // 7 | 30，与 insights.days 不一致时 F 先隐藏旧窗口数字
  onSelectInsightWindow={setUsageDays}      // 只回调，不发请求；main 重新读取
  insightsLoading={usage.loading}           // 读取中提示；同一窗口保留现有行
  insightsError={usage.error}               // 脱敏错误 + 可选重试
  onReloadInsights={usage.reload}
/>
```

- 要支持 30 天，main 把 `useUsageObservation` 的 `days: 7` 改成可选 state 并在变更时重读；F 不直接调用 HTTP。
- F 的准入门仍然生效：缺 scope/window/coverage、范围不含当前项目、`truncated` 却宣称 complete、窗口不一致，都隐藏指标并说明原因；F 不补 0、不合计币种/层。
- `UsageObservation` 的 `details/unit/layer/sampleCount` 原样展示；`null` 保持未知。

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
node --test test/trial/*.case.ts        # 18 项：状态/actions/准入/配方/文案
npx tsc -p tsconfig.json --noEmit
npx tsc -p e2e/trial/tsconfig.json --noEmit
node e2e/trial/run-all.mjs              # 10 套件，全部 exit 0（含两项目日常与 7 天观察回归）
```

main 自有真实 App 浏览器测试在本包改动后重跑 8/8 PASS；main 的真实观察浏览器测试 6/6 PASS（含项目范围、late、503/404）。

## 6. 明确未达

- main 已接入真实 7 天观察；`recipes` 仍未接入，默认不显示。30 天窗口与加载/错误 props 需要 main 扩展其观察 hook。
- J/G 模块未进入本仓库默认产品；F 只有 typed consumer、fixtures 与校验。
- 真实 vendor/model/native 0；`app-daily-flow` 使用 controlled fixture（固定 scratch 写入），不是原生或安装包证明。
- 非 Chromium、人工屏幕阅读器、真实服务端会话中途过期未测。
