# 第十二轮 Agent C 组合配方：授权检索 → 冻结审阅 → 历史/完成结果 → 明确候选

2026-11-12，基线 `efb2812`（合并 `origin/main` `14688f2`）。仅 `packages/context`、`packages/proposals`、
`packages/knowledge`、`packages/routing`。真实模型/native 0；无 HTTP/UI/SQL/签名/新 LLM loop。

## 1. 可替换 main 私有 adapter 的导出

```ts
// 会话：项目/原会话/可选 work；cutoff 仍由 main 的受信 reader wrapper 提供
const conversation = createScopedConversationProvider(mainReader, { projectId, conversationId, workId? },
  { pageSize: 100, maxPages: 8 })

// artifact：只有 main 已验证的已发布 ID；maxIds 限制尝试 lookup 数，返回数另受 limit 限制
const artifacts = createPublishedArtifactProvider(mainMetadataLookup,
  { publishedArtifactIds }, { maxIds: 32, maxArtifactBytes: 8 * 1024 * 1024 })
```

必须保留的 main 语义：`conversationThrough` cutoff、发布 artifact 集合、最终 `assertCurrent()`。
C 不实现最终同步 guard，也不替代 main 的 preview fingerprint。

## 2. 检索：先 Scope 与来源族，再打分

```ts
const batch = Object.assign(
  [...await createConversationRelevanceCandidates(conversation, { projectId, conversationId }),
   ...createDecisionRelevanceCandidates(effectiveDecisions, { supersededIds }),
   ...createReadIndexWorkCandidates(mainReadIndex, projectId, { limit: 64 })],
  { coverage: { complete: /* AND of the three batches */, returned: /* total */ } },
)
const selection = selectRelevantSources(batch, {
  projectId, query, scope, allowedKinds, workId?, maxItems: 16, maxBytes: 32 * 1024,
})
```

- 缺 `role`/`provenance` 的会话候选默认拒绝（`untrusted_role`），不是“未知即可信”。
- `decision`/`contract` 必须带可信 Scope；缺scope `scope_unproven`，越界 `scope_escalation`。
  project/kind 选择器不等于 Scope 授权。
- 重复 sourceId 在通过授权后去重；被拒绝的副本不能遮蔽合法副本。
- `selection.upstreamComplete` 与 `selection.complete` 分开：上游扫描不完整时输出再小也不完整。
- 候选只返回 digest/大小/命中词，不返回正文。

## 3. 冻结来源审阅

```ts
const review = projectSourceReview(composition, { maxItems: 32, maxBytes: 16 * 1024, maxExcerptBytes: 1024 })
```

- `items.length <= budget.maxItems`；超限只留 `suppressed.items/bytes` 有界计数。
- item 与 omission 使用同一脱敏规则；绝对/宿主/父目录路径不回声。
- 空正文、缺失来源、被预算抑制三者可区分（空正文仍是 item，缺失是 omission 原因）。
- manifest 比较包含 sourceId、kind/path、digestScope、实际预算、baseline、truncation、omission；
  prefix/metadata 摘要无法证明整体相等时 `digest_unverifiable`（incomplete），不判 unchanged。

## 4. 真实 A18 历史与完成结果

```ts
const view = collectContextHistory(store.workflows.assistant.contextHistory, {
  projectIds, conversationId?, workId?, limit: 100, cursor?,
}, {
  now, workId?, contract?, scope?,
  replyResults: store.workflows.assistant.replyResults,
  // main 拥有 assistant request key；C 不猜
  replyFor: id => store.workflows.assistant.replyResults.forRequest(key('assistant-request', id)),
})
```

- 只消费真实 A 端口；组合测试无 Map fallback。
- query 的 project/conversation/work 逐条复核；binding 自身 scope 与 project 不一致时 omission。
- 完成结果只在 source/project/conversation 全部匹配时附加；不匹配计入 `mismatchedReplies`，不展示。
- 过期绑定仍可查看（`state: 'expired'`），`requiresExplicitReauthorization` 恒 true。

## 5. 回复候选

```ts
const review = reviewReplyCandidates(assistantReplyBody, {
  projectId, conversationId, sourceMessageId, grantId, grantScope, currentContract?,
})
```

- 先比较整个 body envelope（project/conversation/sourceMessageId）与可信请求；不匹配即 `invalid_body`，
  不逐项“捞”候选。
- 再逐项 `ReasonerProposalSchema` + `validateProposalBindings`：stale contract、scope 越界逐项拒绝。
- 缺用户输入 → `needs_user_input`；有业务效果 → `requires_explicit_confirmation`（现有命令种类 + payload digest）。
- 全部 `executable: false`，不创建 Work、不写决定、不接受交付、不补模型 call。

## 6. 证据与命令

```sh
node tools/bootstrap/probe-wave12-context.mjs "$PWD"   # 8/8 PASS
node tools/bootstrap/probe-wave11-context.mjs "$PWD"   # 17/17 PASS（回归）
(cd packages/context  && node --test test/*.case.ts)    # 112 pass（含 scale.case.ts）
(cd packages/proposals && node --test test/*.case.ts)   # 33 pass
(cd packages/knowledge && node --test test/*.case.ts)   # 80 pass
(cd packages/routing  && node --test test/*.case.ts)    # 44 pass
```

规模/失效样例：`packages/context/test/scale.case.ts`（5000 条同 timestamp 会话、深分页、跨页追加、
过期/替代决定、重复候选、空/缺失/字节变化区分、中英混合基线）。

## 7. NOT_TESTED 与 owner

- main 用这些导出替换私有 adapter：归 main；本包只交 recipe 与真实 main 入口消费者。
- SSE：本消费者未读取 `/v1/assistant/stream`，**不得**把本结果写成 SSE 准入。
- A history `work_id` 派生列负例：A 未修复前，C 以 query.workId 防御复核记录；raw history 消费不整体准入。
- 历史/候选网页：未接线，归 main。
