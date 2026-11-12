# 第十四轮 Agent C 默认来源审阅与候选数据契约

2026-11-12，基线 `f0fe429`（合并 `origin/main` `6d24519`）。仅 context/proposals/knowledge/routing。
真实模型/native 0；不写 SQL/HTTP/root lock/私有 LLM loop。

## 1. 可替换 factory（main 默认路径）

```ts
const conversation = createScopedConversationProvider(mainReader, { projectId, conversationId, workId? }, {
  pageSize: 200,
  maxPages: 3,             // main 生产扫描边界：600 条
  maxScannedMessages: 600, // 显式上限；只有显式提高才能走更远
})
const artifacts = createPublishedArtifactProvider(mainMetadataLookup, { publishedArtifactIds }, {
  maxIds: 32,
  maxArtifactBytes: 8 * 1024 * 1024,
})
```

- `mainReader.page(id, { before, limit })` 仍由 main 注入 `conversationThrough` cutoff；factory 不猜 cutoff。
- 未选 work 时所有 work 锚点消息排除；question anchor 一律排除；role/provenance 仅
  `user/trusted_user` 与 `assistant/reasoner_reply`。
- **artifact 返回 newest-first**（`createdAt` 降序、artifact id 升序 tie-break），限 1 条时取最新；
  `maxIds` 限制尝试 lookup 数，返回数另受请求 limit 限制；未尝试/缺失/替换身份/超 byte 计入 coverage。
- **source fingerprint**：会话 `message-<sha256(projectId\0messageId)[0..32]>`；artifact
  `artifact-<sha256(projectId\0artifactId)[0..32]>`。与正文、位置、发布时间无关，正文变化不换指纹。
- 两个 provider 都暴露 `coverage()`；`ComposedConversationProvider`/`ComposedArtifactProvider` 的
  `coverage?()` 会被 Composer 读取：不完整→组 `truncated`、composition 非 `sufficient`、manifest
  `complete=false`、比较 `incomplete`。main 外层 Scope、原始消息摘要、最终 `assertCurrent()` 不变。

## 2. 审阅输出真值

`projectSourceReview` 预算维度相互独立：

| 维度 | 上限 | 超额表现 |
| --- | --- | --- |
| items | `maxItems` | `suppressed.items` |
| bytes/excerpt | `maxBytes`、`maxExcerptBytes` | `suppressed.bytes` |
| omission entries | `maxOmissions`（缺省 `min(default,maxItems)`） | `suppressed.omissions` |
| omission detail | 8KiB 固定 | detail 丢弃并记 note |

任一裁剪都会置 `truncated=true`，且 `totals.suppressed = items+bytes+omissions`；
`totals.omitted` 只表示列出的 omission 数，不把“未扫描/被裁剪/源缺失”混成一个数字。

脱敏覆盖所有公开文本（title/detail）：任意 POSIX 绝对根（`/Library`、`/custom`、…）、Windows
盘符（`Z:/`、`C:\`）、UNC（`\\server\share`）、`file://` URL → `<redacted-path>`；相对引用
（`decisions/x.json`、`and/or`）保持可读。

## 3. 候选数据：只接 main 已验证的完成回复

```ts
const completed = new CompletedAssistantReplies(store, store.workflows.assistant.replyResults, principal, projectIds)
const body = completed.read(requestId)            // 原 request receipt + artifact bytes + body 已核对
const result = store.workflows.assistant.replyResults.forRequest(requestId)
const review = reviewVerifiedReplyCandidates(
  { verifiedBy: 'main-completed-reply', body, identity: {
      requestId, replyMessageId: result.replyMessageId, sourceMessageId: result.sourceMessageId,
      projectId: result.projectId, conversationId: result.conversationId, model: result.model,
      principal: result.principal } },
  { projectId, conversationId, sourceMessageId, grantId, grantScope, currentContract?, principal },
)
```

- `verifiedBy` 是 private 注入契约，不是公共证明；raw body/row/手写字符串 → `invalid_body`。
- C 再核对 body↔identity 与 identity↔当前 bindings/principal；任一不符即拒绝。
- main 当前保存 `suggestions=[]`，因此实际结果是 `no_candidates` + 普通回复文本，`modelCallPerformed:false`；
  C 不补模型 call、不自动重试修格式。
- 展示过期候选或 verified 边界不等于执行许可；实际确认仍由原 ProductProposals 当前 Scope 核对。

## 4. 旧 API 变化与迁移

| 变化 | 迁移 |
| --- | --- |
| `collectContextHistory` 删除 `replyResults` / `replyFor` | 提供 `replyReader`（main 验证后返回 `TrustedCompletedReply`） |
| `HistoryView.totals.mismatchedReplies` 新增 | 断言/展示 foreign reply 数 |
| `projectSourceReview` 新增 `maxOmissions`、`suppressed.omissions`、`totals.suppressed` 含 omission | 旧断言按维度更新 |
| `createScopedConversationProvider` 新增 `maxScannedMessages` | main 设 600；规模测试显式提高 |
| `createPublishedArtifactProvider` 排序改 newest-first、`complete` 含 limit 裁剪 | 依赖旧发布顺序的 fixture 需更新 |
| `reviewReplyCandidates` 结果新增 `verifiedBy:'none'`；新增 `reviewVerifiedReplyCandidates` | 生产路径用 verified 入口 |

## 5. 证据与命令

```sh
PA_ADMISSION_REPORT=/tmp/w14.json node tools/bootstrap/probe-wave14-context.mjs "$PWD"  # 6/6
PA_ADMISSION_REPORT=/tmp/w13.json node tools/bootstrap/probe-wave13-context.mjs "$PWD"  # 6/6
PA_ADMISSION_REPORT=/tmp/w12.json node tools/bootstrap/probe-wave12-context.mjs "$PWD"  # 8/8
PA_ADMISSION_REPORT=/tmp/w11.json node tools/bootstrap/probe-wave11-context.mjs "$PWD"  # 17/17
(cd packages/context  && node --test test/*.case.ts)   # 124
(cd packages/proposals && node --test test/*.case.ts)  # 35
(cd packages/knowledge && node --test test/*.case.ts)  # 82
(cd packages/routing  && node --test test/*.case.ts)   # 44
```

规模：600 条扫描边界、10000 消息/10000 历史/10000 候选、5000→10000 omissions 封顶；
冻结历史在 live source 变更后仍返回原 bundleDigest，新 prepare 才读新正文。

## 6. NOT_TESTED / owner

- main HTTP/runtime 用这些 factory 替换私有 preview adapter：main 尚未接线，本包只证明真实
  composer/manifest 中的调用计数、sourceId 与 coverage，不冒充 HTTP 准入。
- 候选 UI/确认入口：main；main 保存 suggestions=[]，故真实链路当前为 no_candidates。
- SSE：未读取 `/v1/assistant/stream`，不宣称 SSE。
- A `history work_id` 派生列：A 修；C 以 `query.workId` 复核。
