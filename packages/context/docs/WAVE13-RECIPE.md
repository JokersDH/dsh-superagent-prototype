# 第十三轮 Agent C 可替换来源数据链接入配方

2026-11-12，基线 `669fd4e`（合并 `origin/main` `30ecd70`，产品 `e1e0c97`）。仅四个 owned 包。
真实模型/native 0；无 HTTP/UI/SQL/签名/新 LLM loop。

## 1. main 需要替换的 factory 契约

```ts
// 1) 会话：main 提供 cutoff 受信 reader，factory 只做项目/会话/work/role/provenance 过滤
const conversation = createScopedConversationProvider(mainReader, { projectId, conversationId, workId? },
  { pageSize: 200, maxPages: 8 })
//    mainReader.page(id, { before, limit }) 必须已实现 conversationThrough cutoff；
//    未选 work 时任何 work 锚点消息都不进入；question anchor 一律排除。

// 2) 已发布 artifact：ID 集合由 main 验证，factory 只做 metadata lookup 与预算
const artifacts = createPublishedArtifactProvider(mainMetadataLookup,
  { publishedArtifactIds }, { maxIds: 32, maxArtifactBytes: 8 * 1024 * 1024 })
```

两个 factory 现在都带 `coverage()`。**Composer 会读取它**：`complete=false` 时对应 group 变为
`truncated`，composition `status != sufficient`，manifest `coverage.complete=false`，比较结果为
`incomplete`。main 不要在外层再把不完整扫描提升为 complete。

## 2. 授权贯穿 composer（不只 selector）

- `selectRelevantSources` 对 `decision`/`contract` 要求 `options.scope` 为可信当前 Scope；
  缺失 `scope_unproven`，越界 `scope_escalation`，重复 id 在授权后去重。
- `ContextComposer` 自身按 `grant.scope` 过滤 decision 正文：同项目但 scope 越界的 decision
  以 `excluded_path` 遗漏，绝不进入 slice/manifest。
- 文件组仍由 ContextReader 按 grant scope / denied paths 执行；main 外层 scopeWithin 与
  最终 `assertCurrent()` 保留，C 不移除也不替代。

## 3. 历史与完成回复

```ts
const view = collectContextHistory(store.workflows.assistant.contextHistory, {
  projectIds, conversationId?, workId?, limit: 100, cursor?,
}, {
  now,
  // 必须来自 main CompletedAssistantReplies.read 等已完成“原 request receipt + artifact bytes
  // + reply body 身份”核对的读取者；raw row 不算 verified。
  replyReader: id => {
    const requestId = key('assistant-request', id)
    if (completed.read(requestId) === undefined) return undefined
    const result = store.workflows.assistant.replyResults.forRequest(requestId)
    return result && { result, verifiedBy: 'main-completed-reply' }
  },
})
```

附加条件：`verifiedBy='main-completed-reply'`，且 reply 的 source/project/conversation/principal
与 binding 完全一致；否则 `replyUnknown=true`，不匹配计入 `mismatchedReplies`。历史可读不等于重发权，
`requiresExplicitReauthorization` 恒 true。

## 4. 审阅输出预算（所有字段）

- items：`maxItems`、`maxBytes`、`maxExcerptBytes`。
- omissions：`maxOmissions`（未显式给出时取 `min(default, maxItems)`），超出只留
  `suppressed.omissions` 计数。
- omission.detail 总预算 8KiB；超出的 detail 丢弃并计数。
- item 与 omission 的 path 使用同一 project-relative 规则；所有自由文本（title/detail）经
  `redactText` 把 host/绝对/Windows/file URL 替换为 `<redacted-path>`。
- 不再出现“5000 omissions / 365KB”输出；scale 测试验证 10000 omissions < 4KiB 序列化。

## 5. 候选数据

`reviewReplyCandidates` 先整 body envelope，再逐项 `ReasonerProposalSchema` +
`validateProposalBindings`：foreign revision→`contract_stale`、越界/过期 Scope→`scope_escalation`、
缺输入→`needs_user_input`。全部 `executable:false`，不补 actor/profile/check，不自动执行。

## 6. 证据与命令

```sh
PA_ADMISSION_REPORT=/tmp/w13.json node tools/bootstrap/probe-wave13-context.mjs "$PWD"  # 6/6
PA_ADMISSION_REPORT=/tmp/w12.json node tools/bootstrap/probe-wave12-context.mjs "$PWD"  # 8/8
PA_ADMISSION_REPORT=/tmp/w11.json node tools/bootstrap/probe-wave11-context.mjs "$PWD"  # 17/17
(cd packages/context  && node --test test/*.case.ts)   # 118
(cd packages/proposals && node --test test/*.case.ts)  # 34
(cd packages/knowledge && node --test test/*.case.ts)  # 80
(cd packages/routing  && node --test test/*.case.ts)   # 44
```

共享 probe 报告写 `/tmp`；owned 证据在 `packages/context/reports/wave13-probe.json`。

## 7. NOT_TESTED / owner

- main HTTP 组合入口用这些 factory 替换私有 adapter：main 尚未接线；`factory-consumer.case.ts`
  已证明它们在真实 composer/manifest 中被调用（调用计数、sourceId、coverage），但不是 HTTP 准入。
- SSE：未读取 `/v1/assistant/stream`，不宣称 SSE。
- A 《history work_id 派生列》负例仍由 A 修；C 侧以 query.workId 复核记录，raw history 不整体准入。
- 候选 UI/确认入口：main 所有；C 只交纯数据。
