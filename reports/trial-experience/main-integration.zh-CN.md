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

### 2.1 项目声明草案（J）——只传受限选择

main 0077 已把试用准备的真实 server-preview 建议接到原 NewWorkForm（`initialRecipe`/`useProjectRecipe`）。F 只把受限选择交给 main；完整字段由 main 原表单 preview/apply/revalidate 提供。

```tsx
<TrialWorkspace
  /* ...existing props... */
  recipes={recipeSuggestions}
  recipesLoading={recipesLoading}
  recipesError={recipesError}
  onOpenRecipe={selection => {
    // selection = { suggestionId, projectId, kind, allowedPaths, profileId }
    // main: open NewWorkForm with this initial recipe selection and let its own
    // useProjectRecipe read POST /v1/projects/:id/recipes/preview, then the user
    // previews/applies/edits goal and confirms the original create.
  }}
/>
```

- `TrialRecipeSelection`/`TrialRecipeSuggestion` 来自 `./trial/index.ts`（`recipes.ts`）。F 的 applicable 只是展示判断，不是授权；main 仍重读 config/facts、服务端 preview 和原确认。
- 适用性按当前配置项目：项目存在且被选中、可派工、未过期、非讨论项目；检查在该项目 `defaultCriteria` 且已注册；执行器绑定该项目且已准入；选择的 allowedPaths 是项目 atoms 的子集；声明的排除项必须保留项目全部排除（可增加、不可遗漏）；外部动作只能收窄。
- `kind` 只能是 `regression_fix|scoped_change|verification_followup`；完整 goal/scope/criteria 由服务端 `ProjectRecipePreview.fields` 给出，F 不复制。
- 选择范围必须同时是项目 atoms 与声明模板范围的子集；项目排除项必须保留，且额外排除项因受限选择无法携带而被拒绝。
- 同一草案 300ms 内重复点击只回调一次；取消/编辑/stale/未知 commandId 重试由原表单负责。

### 2.2 观察导出与支持（main 已实现，F 为消费者）

main 已通过 `onDownloadInsights/insightsDownloading/insightsDownloadError` 接入 `POST` 后的下载副作用。F 的组件只负责：明确点击、显示-only 说明、下载中状态、失败重试和旧包隐藏；真实文件生成/鉴权/取消仍由 main `useObservationDownload` 与 transport 完成。支持摘要通过可选 `support={{packageLabel, sourceLabel, note}}` 传入；缺少标签时显示“未提供/未声明”，不要伪造包身份。

### 2.3 真实观察（main 已实现 7/30，F 为消费者）

main 的 `useUsageObservation`/App 已实现 7/30 天真实读取并向 F 传 `insightWindow/onSelectInsightWindow/insightsLoading/insightsError/onReloadInsights`；它与 F 的 `TrialInsightsView` 结构兼容（`windowLabel/coverage/coverageState/scope/sampleCount/unknownCount/metrics/layer/unit/limitations`）。

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

- 30 天切换已由 main 实际实现；F 只渲染控件并遵守窗口不一致隐藏规则，不直接调用 HTTP。
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
node --test test/trial/*.case.ts        # 19 项：状态/actions/项目内准入/受限选择/文案
npx tsc -p tsconfig.json --noEmit
npx tsc -p e2e/trial/tsconfig.json --noEmit
node e2e/trial/run-all.mjs              # 10 套件，全部 exit 0（含两项目日常与 7 天观察回归）
```

main 自有测试在本包改动后重跑：trial App 8/8、真实观察 6/6、0073 模板浏览器（J 61/工具与两项目预填/创建/接受）通过。

## 6. 明确未达

- main 已接入 0077 原表单模板与 0076 7/30 观察；D 的 1fbaf94 包未包含这些入口，installed 验收 NOT_REACHED。
- J/G 模块未进入本仓库默认产品；F 只有 typed consumer、fixtures 与校验。
- 真实 vendor/model/native 0；`app-daily-flow` 使用 controlled fixture（固定 scratch 写入），不是原生或安装包证明。
- 非 Chromium、人工屏幕阅读器、真实服务端会话中途过期未测。
