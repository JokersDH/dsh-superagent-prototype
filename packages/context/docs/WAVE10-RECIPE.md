# Agent C：来源闭环与对话上下文投影（wave-10）

Branch `codex/g3-assistant-context`，base `origin/main` `f99ca39`（merge `e80526b`）。
Owned paths: `packages/context`, `packages/proposals`, `packages/knowledge`, `packages/routing`。
本文件只描述库契约与消费方式；HTTP/UI/SQL/签名确认由 main 拥有。

## 1. 移除未入 main 的辅助确认入口

`confirmWithCommand`（连同 `ConfirmWithCommandInput/Result`、`plan_mismatch`）已删除。它允许同一
effect id 配不同 plan 返回新命令，main 从未使用。唯一权威路径是 main 的
`planProposalCommand + commit + prepareCommand/commitPrepared`：命令 receipt 覆盖完整命令 body；
C 的 `commit` 另要求确认重放携带精确 reviewed `expectedDigest`。

`node tools/bootstrap/probe-wave10-context.mjs <checkout> --helper-only` → `PASS_OPTIONAL_HELPER_IDENTITY_ONLY`。

## 2. 受限消息与已发布 artifact adapter（C2）

```ts
import { createScopedConversationProvider, createPublishedArtifactProvider } from '@personal-agent/context'

const conversation = createScopedConversationProvider(
  { page: (id, options) => store.product.messages.page(id, options) },
  { projectId, conversationId, workId },            // workId 可选
)
const artifacts = createPublishedArtifactProvider(
  { get: id => store.artifacts.get(id) },           // metadata only
  { publishedArtifactIds: verifiedPublishedIds },   // main 已验的发布集合，绝不全量枚举
)
```

- 消息：有界分页（默认 50/页、最多 8 页），只保留同一 project+conversation、`trusted_user`、
  非 `question_answer_display`、非 system 的消息；选了 workId 时排除锚定到其他 work 的消息。
  `coverage()` 返回 scanned/returned/complete 与各排除计数——不完整扫描不会被当成完整会话。
- artifact：仅对已验 published id 调用 `get`，去重并受 `maxIds` 限制；缺失计数不臆造；
  `coverage()` 报告 requested/returned/missing/complete。不含文件字节或绝对路径。

## 3. manifest 双摘要与变化比较（C3）

`buildSourceManifest(composition)` 每项新增 `wholeSourceDigest`、`visiblePreviewDigest`、
`digestScope`；manifest 新增 `selection`（project/conversation/work/contract）与 `coverage`
（complete/groups/omitted/truncated/budgetClamped）。`complete` 表示“扫描完整且至少有一条来源”：
预算截断、组不可用、无来源都会是 false；`missing`/`stale` 是确定观测，不算扫描不完整。

```ts
const comparison = compareSourceManifests(previousManifest, currentManifest)
// status: unchanged | changed | incomplete
// changes: content | preview | truncation | budget | selection | contract | missing | added | replaced
// incompleteReasons: previous_incomplete | current_incomplete | selection_changed | contract_changed
```

同一 `sourceId` 换 path/kind → `replaced`；whole 变化 → `content`；仅可见预览变化 → `preview`；
截断变化 → `truncation`。比较只报告数据变化：不签 grant、不保存确认、不承诺来源在时间窗内不变。

## 4. 有界 untrusted prompt 数据投影（C4）

```ts
const projection = projectPromptData(composition, { maxItems: 12, maxBytes: 32768, maxTokens: 8000 })
// projection.text 为纯参考数据；references 报告每项 included-text digest 与 truncated
```

- 只产生数据文本：无 system 角色、无 tool/permission/command 字段；注入式文本原样保留为数据。
- 条数/UTF-8 字节/CJK 感知 token 估算三重上限（硬上限 `PROMPT_DATA_CEILINGS`），超限逐条标注。
- 不发送模型请求、不自动附加到对话；main 决定是否把它交给现有 `AssistantModelPort`。

## 5. main 实际入口状态

- `POST /v1/context/preview` 已发布（`context-preview/1`，含 sourceDigest/previewDigest、
  budgetClamped、injectionFlags、issues、5 分钟有效期与读取后重验）。C 的真实 HTTP 消费者见
  `packages/knowledge/test/main-context-http.case.ts`：项目/会话过滤、决定撤销后消失、新消息出现、
  budget 夹紧、未认证 401、恢复只读 422、非法 selections 400。
- **context-use（把选来源绑定到单条消息并交给模型）尚未发布**：C5 对其标 NOT_TESTED，owner main；
  C 已交 `projectPromptData` 作为该入口的库级输入，不自写 HTTP 或绑定表。
- 旧 wave-10 全量 probe 的两条 recipe 用例是针对历史实现哈希的固定复现，不会因新 adapter 自动转绿；
  新 adapter 由 main 追加实际导出消费者后再准入（`--helper-only` 用于动态 helper 检查）。

## 6. 证据

```sh
node tools/bootstrap/probe-wave10-context.mjs "$PWD" --helper-only   # PASS_OPTIONAL_HELPER_IDENTITY_ONLY
node tools/bootstrap/probe-wave09-context-proposal.mjs "$PWD"        # PASS_CONTEXT_AND_PROPOSAL_BINDING
node tools/bootstrap/probe-wave08-context-grant.mjs "$PWD"           # PASS_CONTEXT_GRANT_BOUNDARY
pnpm --filter @personal-agent/context test                           # 78/78
pnpm --filter @personal-agent/proposals test                         # 26/26
pnpm --filter @personal-agent/knowledge test                         # 75/75（含 4 项真实 context HTTP）
pnpm --filter @personal-agent/routing test                           # 44/44
node packages/context/examples/composition-performance.mjs           # PASS
```
