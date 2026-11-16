# F4 历史与来源紧凑浏览：main 最小接线

日期：2026-11-16。source：`apps/console/src/trial/HistorySourcePanel.tsx`、`apps/console/src/trial/history-source.ts`，从 `apps/console/src/trial/index.ts` 导出。

## 定位

main 的原 `ContextHistoryPanel`/`ContextSources` 已是真实 actual App 浏览器，F 不复制其 fetch、SQL、Scope 或下载逻辑。本组件是 trial 侧可用的紧凑只读呈现：输入 main 已严格校验的 `ContextHistory`/`ContextSources`，输出行/续页/正文摘要，并把选择与“更多记录”作为 callback 交回 main。

## Props

- `history?: ContextHistory`、`scope?: { projectId?, conversationId? }`：项目/会话不匹配时拒绝显示；最多 50 条/页，重复 ID 或不一致 cursor 拒绝。
- `selectedMessageId?`、`sources?: ContextSources`：来源 binding 必须匹配 message/project/conversation，`verified` 的 source ID 必须与冻结 binding 顺序一致，否则拒绝显示。
- `onSelect(entry)`、`onLoadMore()`、`onRetry()`、`onOpenConversation(conversationId)`：组件不自行发请求；`trialHistoryMerge(previous,next)` 供 main 在追加前拒绝重叠/超 200 条/错 scope。
- `loading`/`error:'failed'|'stale'`/`loadingMore`/`sourcesLoading`/`sourcesError`：失败与旧游标保留明确文案，不清成空历史。
- 正文最多展示 1200 字符并标注截断；完整原文、复制与 Scope gate 仍在原来源组件。历史可读不构成 send/execute/approve。

## 必要验证

```sh
cd apps/console
node --test test/trial/history-source.case.ts
node e2e/trial/history-source.mjs
node tests/integration/context-history-browser.mjs
```

受控结果：单元 10/10；浏览器 9/9（非空行、验证来源正文与范围说明、missing/scope_changed 不显示正文、live 续页、错项目拒绝、键盘返回、390 布局）；main 原 actual App history browser exit 0。未把 F 组件挂到 App；main 接线后需再跑同页 journey。
