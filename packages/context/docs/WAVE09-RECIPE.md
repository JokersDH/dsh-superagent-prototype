# Agent C：种类绑定与命令绑定的接线说明（wave-09）

Branch `codex/g3-assistant-context`，base `origin/main` `531c6b6`（merge `5f021b1`）。

## 1. 组名只能读自己的 kind 家族

`validateComposedGroups(groups)` 在**任何 provider 调用之前**执行：

| 组名 | 允许的 source kind |
| --- | --- |
| `contract` | contract, work |
| `decisions` | decision |
| `project_facts` | project_metadata, verification, delivery |
| `conversation` | conversation_message |
| `artifacts` | artifact |
| `files` | document, source_file |

拒绝并抛 `ContextError('composition_invalid')`：未知组名、重复组名、重复 priority、priority 非正整数、
空/重复 kind、kind 不属于该名字的家族、`share` 非 `[0,1]` 的有限数（NaN/±Infinity/负数）。
`group_kind_alias` 反例（artifact-only grant + `decisions` 组）因此读到 0 条；正对照仍读取 1 条。

## 2. 命令绑定（历史，wave-10 已移除辅助入口）

wave-09 的 `confirmWithCommand` 辅助入口已删除：main 从未使用它，且同一 effect id 配不同 plan 会返回
新命令，不能作为幂等证明。唯一权威路径是 main 的 `planProposalCommand + commit + prepareCommand/
commitPrepared`，其 receipt 覆盖完整命令 body；C 的 `commit` 另要求确认重放携带精确 reviewed digest。

## 3. context 产品消费 adapter

`packages/knowledge/test/main-context-consumer.case.ts` 是可直接复制的 recipe：

```ts
const composer = new ContextComposer({
  port: new LocalProjectSourcePort({ rootDir, projectId, baseline }),
  decisions: decisionContextProvider(governance),
  conversation: { recent: ({ conversationId, limit }) => store.product.messages.page(conversationId, { limit }) ... },
  artifacts: { recent: ({ limit }) => ports.index.listArtifacts({ limit }).artifacts.map(...) },
})
const composition = await composer.compose({ requestId, projectId, purpose, query, grant, budget, conversationId, workId? })
const manifest = buildSourceManifest(composition)      // 稳定来源/摘要/截断/trust
const preview = buildCompositionPreview(composition)   // 网页预览
```

## 4. 当前产品入口状态

main 尚未发布 context 组合/预览 HTTP（`grep -c 'v1/context' apps/coordinator/http/app.ts` = 0）。
提案/决定 HTTP 已发布并已由 C 的独立消费者验证（真实 HTTP 与真实 SQLite）。C5 的 UI 断言保持
owner=main，已记录复现与所需输入；C 不写 HTTP/UI/SQL。

## 5. 证据

```sh
node tools/bootstrap/probe-wave09-context-proposal.mjs "$PWD"  # PASS_CONTEXT_AND_PROPOSAL_BINDING
node tools/bootstrap/probe-wave08-context-grant.mjs "$PWD"     # PASS_CONTEXT_GRANT_BOUNDARY
pnpm --filter @personal-agent/context test                     # 59/59
pnpm --filter @personal-agent/proposals test                   # 30/30
pnpm --filter @personal-agent/knowledge test                   # 71/71
node packages/context/examples/composition-performance.mjs     # PASS (bounded, deterministic)
```
