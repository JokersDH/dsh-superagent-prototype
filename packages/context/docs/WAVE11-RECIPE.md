# 第十一轮 Agent C 组合配方：可靠来源、审阅、检索与候选数据

2026-11-12，基线 `8d8ac6e`（合并 `origin/main` `b466bc7`），早检查点 `480c5ee`。
只涉及 `packages/context`、`packages/proposals`、`packages/knowledge`、`packages/routing`。
无 HTTP/UI/SQL/签名授权/新模型循环；真实模型与 native turn 均为 0。

## 1. 来源选择（main 私有 adapter 的可替换导出）

```ts
import {
  createScopedConversationProvider,
  createPublishedArtifactProvider,
} from '@personal-agent/context'

const conversation = createScopedConversationProvider(mainMessagePageReader, {
  projectId, conversationId, workId?,           // workId 省略时任何 work 补充都不进入
}, { pageSize: 100, maxPages: 8 })
const artifacts = createPublishedArtifactProvider(mainArtifactMetadataLookup, {
  publishedArtifactIds,                          // main 已验证的已发布集合，绝不全registry枚举
}, { maxIds: 32, maxArtifactBytes: 8 * 1024 * 1024 })
```

边界与 `apps/coordinator/product/context-preview.ts:137-140` 一致：

- `anchor.questionId` 一律排除，与 provenance/role 无关；
- work 补充只在选中的同一 work 下可用，未选 work 时全部排除；
- 仅 `user/trusted_user` 与 `assistant/reasoner_reply` 可复用；
- 分页游标必须严格回退，重复页不重复入列，未走完即 `coverage.complete = false`；
- artifact `maxIds` 限制**尝试 lookup 数**，返回数另受请求 limit 限制；缺失、替换身份、超byte均计数。

`coverage()` 必须在每次 `recent()` 后读取；不要把 `complete=false` 当作完整会话。

## 2. Manifest 身份、预算与比较

```ts
const manifest = buildSourceManifest(composition)   // 含 selection / budget / coverage / sources
const comparison = compareSourceManifests(before, after)
```

- sourceId 变化、同路径替换 → `replaced`；baseline commit 变化 → `baseline`；
- 真实解析后的预算变化（不仅 clamp 标签）→ `budget`；遗漏集合变化 → `omitted`；
- 任一侧扫描不完整 → `incomplete`，绝不 `unchanged`。

## 3. 有界 prompt 数据

```ts
const projection = projectPromptData(composition, { maxItems: 12, maxBytes: 32 * 1024, maxTokens: 8000 })
```

- bytes/tokens 覆盖 header、正文与每条块尾 newline；
- `totals.tokens` 是整段序列化文本的保守估计，永不低报；
- 上游 `slice.truncated` 会传播到 reference 与整体 `truncated`。

## 4. 人可读来源审阅（冻结 bundle）

```ts
const review = projectSourceReview(composition, { maxItems: 32, maxBytes: 16 * 1024, maxExcerptBytes: 1024 })
// item: sourceId/kind/category/title/citation/excerpt/status/truncated/digests/trust
```

- title 只来自受信 descriptor 或净化后的相对路径 basename；
- citation 形如 `decision:decisions/x.json@aaaaaaaa`；绝对/父目录/反斜杠路径改为 `redacted/<sourceId>` 并记 note；
- 不产生 actor/tool/permission/command 字段，不返回 host 路径。

## 5. 单项目确定性检索

```ts
const candidates = [
  ...await createConversationRelevanceCandidates(conversationProvider, { projectId, conversationId }, { limit: 400 }),
  ...createDecisionRelevanceCandidates(effectiveDecisions, { supersededIds }),
  ...createReadIndexWorkCandidates(mainReadIndex, projectId, { limit: 64 }),
]
const selection = selectRelevantSources(candidates, {
  projectId, query: 'payment timeout retry', allowedKinds, workId?, maxItems: 16, maxBytes: 32 * 1024,
})
```

先授权后打分：跨项目、未授权 source 族、question anchor、非可复用 role/provenance、superseded 决策先被排除；
排序为 score 降序 + sourceId 升序，输入顺序变化不影响结果。数据集在
`packages/context/test/relevance.case.ts`：403 条会话 + 63 个 work，8 个期望命中全部入选、6 个禁止项零混入，
会话只读 4 页、read index 只列举 1 次。

## 6. 历史与已完成回复视图

```ts
const view = collectContextHistory(store.workflows.assistant.contextHistory, {
  projectIds, conversationId?, workId?, limit: 100, cursor?,
}, {
  now, workId?, contract?, scope?,
  replyResults: store.workflows.assistant.replyResults,
})
```

- 过期绑定仍作为历史出现（`state: 'expired'`）；合同/scope/work 漂移分别标记；
- `requiresExplicitReauthorization` 恒为 true，`authorization: 'none'`；
- 已完成回复只投影 digest/artifact 引用，`replyUnknown=true` 表示只有 before-send receipt；
- 游标不前进即停止并 `complete=false`。

## 7. 回复候选的纯校验

```ts
const review = reviewReplyCandidates(assistantReplyBody, {
  projectId, sourceMessageId, conversationId, grantId, grantScope, currentContract?,
})
```

- 非法/越界 body → `status: 'invalid_body'`，不重试、不补模型 call；
- 无合法候选 → `no_candidates`，保留普通回复文本；
- 支持项给出 `needs_user_input`（精确缺项）或 `requires_explicit_confirmation`（现有命令种类 + payload digest）；
- 全部 `executable: false`、`requiresUserConfirmation: true`、`trust: 'untrusted_data'`；不创建 Work、不写决定、不接受交付。

## 8. 主线消费者证据

`packages/knowledge/test/main-context-use-consumer.case.ts` 用 mock `AssistantModelPort` 驱动真实
`/v1/assistant/context/prepare|send` 与 `/v1/messages/:id/context`：

- provider 收到独立 `user-selected-context/1` untrusted 层，最后一条是用户文本；
- audit 的 requestId/sources/bundleDigest 与 prepare preview 一致；
- prepare 后追加的消息不进入冻结 bundle，新 prepare 才可见；
- 原 token 重放返回同一 receipt 且不再调用模型；撤销后历史 audit 仍可读，新 prepare 不再含该决定；
- 自然过期与 provider 离线都在任何模型请求前落为 rejected。

## 9. 命令与结果

```sh
node tools/bootstrap/probe-wave11-context.mjs "$PWD"     # 17/17 PASS
(cd packages/context  && node --test test/*.case.ts)      # 101 pass
(cd packages/proposals && node --test test/*.case.ts)     # 32 pass
(cd packages/knowledge && node --test test/*.case.ts)     # 79 pass
(cd packages/routing  && node --test test/*.case.ts)      # 44 pass
```

未测：main 用这些导出替换其私有 adapter（归 main）；A 的持久 `contextHistory`/`replyResults`
（本工作树只有契约与 binding store）；历史/候选 UI（未接线，归 main）。
